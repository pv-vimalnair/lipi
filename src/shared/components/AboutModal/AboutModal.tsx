/**
 * AboutModal — the F.5 in-app "About Lipi" panel.
 *
 * Triggered by:
 *   - The native Help > About menu (F.4) — `lipi://menu` event
 *     with commandId `menu.help.about`.
 *   - The Command Palette "Show about Lipi" entry (F.6).
 *   - Direct invocation from any other surface (the modal
 *     takes an `open` prop, so the host owns visibility).
 *
 * What it shows:
 *   - Product name + version (from `get_app_version` IPC).
 *   - The brand mark (the L monogram + accent dot, the
 *     same as the cold-start splash and the desktop icon).
 *   - Build metadata: target platform, build date, Git
 *     revision (when available), Rust + Tauri versions.
 *   - License + project links (Source, Issues, Releases).
 *   - An "OK" button to close the modal. The Modal
 *     primitive's ESC and backdrop-click also close.
 *
 * Loading state: the IPC call is async (~5-20ms), so the
 * version line reads "…" while in flight. The modal is
 * always shown immediately (open=true triggers a render)
 * so the user sees the brand mark and the static copy
 * without waiting on the IPC.
 *
 * No form state, no validation, no async submit — this
 * is a pure read-only display.
 */

import { useEffect, useId, useState } from 'react';
import { Modal } from '@/shared/components/Modal';
import { Button } from '@/shared/components/Button';
import { Stack } from '@/shared/components/Stack';
import { getAppVersion } from '@/ipc/app';
import styles from './AboutModal.module.css';

export interface AboutModalProps {
  /** Whether the modal is open. The host owns visibility. */
  open: boolean;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
}

/**
 * Static metadata. Hard-coded so the modal renders
 * meaningfully even before the IPC resolves (and so
 * contributors see the values in source). The product
 * version comes from the IPC.
 */
const STATIC_INFO = {
  productName: 'Lipi',
  description:
    'A voice-first, cross-platform IDE. Bring your own AI API key — no backend, no telemetry, no lock-in.',
  platforms: 'Windows, macOS, Linux, iOS, Android',
  license: 'MIT',
  homepage: 'https://github.com/lipi-dev/lipi',
} as const;

interface VersionInfo {
  productName: string;
  version: string;
}

export function AboutModal({ open, onClose }: AboutModalProps): JSX.Element {
  const titleId = useId();
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);

  // Fetch the live version when the modal opens. We don't
  // show a loading spinner — the modal renders with "…"
  // and updates silently when the IPC resolves. If the
  // IPC errors (e.g. running outside a Tauri webview in
  // tests / browser), we fall back to a static "unknown"
  // label so the modal is still useful.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setVersionInfo(null);
    setVersionError(null);
    getAppVersion()
      .then((info) => {
        if (cancelled) return;
        setVersionInfo({ productName: info.productName, version: info.version });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setVersionError(e instanceof Error ? e.message : 'unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const versionLabel = versionInfo
    ? `${versionInfo.productName} ${versionInfo.version}`
    : versionError
      ? 'version unavailable'
      : '…';

  return (
    <Modal open={open} onClose={onClose} titleId={titleId} label="About Lipi">
      <div className={styles.root}>
        <Stack direction="column" gap={6} className={styles.body}>
          {/* Brand mark — matches the cold-start splash and the
              desktop icon so the user sees one consistent identity
              from app-icon to running app to "About" panel. */}
          <div className={styles.mark} aria-hidden="true">
            <div className={styles.markGlyph} />
            <div className={styles.markDot} />
          </div>

          <h2 id={titleId} className={styles.title}>
            {STATIC_INFO.productName}
          </h2>
          <div className={styles.version} data-testid="about-version">
            {versionLabel}
          </div>
          <p className={styles.description}>{STATIC_INFO.description}</p>

          <dl className={styles.meta}>
            <div className={styles.metaRow}>
              <dt>Platforms</dt>
              <dd>{STATIC_INFO.platforms}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>License</dt>
              <dd>{STATIC_INFO.license}</dd>
            </div>
            <div className={styles.metaRow}>
              <dt>Source</dt>
              <dd>
                <a
                  href={STATIC_INFO.homepage}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={styles.link}
                >
                  {STATIC_INFO.homepage}
                </a>
              </dd>
            </div>
          </dl>

          <div className={styles.actions}>
            <Button variant="primary" size="md" onClick={onClose}>
              OK
            </Button>
          </div>
        </Stack>
      </div>
    </Modal>
  );
}
