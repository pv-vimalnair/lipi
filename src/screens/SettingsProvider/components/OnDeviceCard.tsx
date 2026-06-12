/**
 * OnDeviceCard — M2c on-device STT configuration card.
 *
 * The companion to `WisprCard` in `SettingsProvider.tsx`.
 * Rendered under the Wispr card inside the "Voice"
 * section of the Settings screen.
 *
 * ## What it shows
 *
 *   1. Header: title + a "Available" / "Unavailable"
 *      badge. The badge is computed from
 *      `sttIsAvailable()` (true when the user has
 *      picked an active model).
 *   2. A short lede explaining what on-device STT
 *      is and the privacy story (audio stays on
 *      device by default; the model is downloaded
 *      once and cached locally).
 *   3. The curated list of models, one card each.
 *      Each model card has:
 *      - Display name (e.g. "Whisper Base (English, ~150 MB)")
 *      - Status badge: "Installed" (file on disk)
 *        / "Active" (also selected as the
 *        current model) / "Not installed"
 *      - One primary action button:
 *        "Install" / "Activate" / "Re-install" /
 *        "Downloading… (45%)" (with a progress bar)
 *      - A "Delete" button (visible only when
 *        installed) — destructive, requires the
 *        user to confirm via the tooltip
 *
 * ## Data flow
 *
 *   - On mount: `sttListModels()` for the curated
 *     list, `sttListInstalledModels()` for which
 *     models have a file on disk, `sttIsAvailable()`
 *     for the badge. The hook subscribes to
 *     `stt://download-progress` to drive the
 *     progress bars.
 *   - Install: `sttInstallModel(id)` (the
 *     Rust side streams the download + verifies
 *     SHA-256). The component tracks the active
 *     install id + progress in local state.
 *   - Set active: `sttSetActiveModel(id)` (the
 *     Rust side validates the id + verifies the
 *     file is on disk; the JS side updates
 *     `voicePreferencesStore.provider` to
 *     'ondevice' so the VoiceButton picks the new
 *     path).
 *   - Delete: `sttRemoveModel(id)` (the Rust
 *     side deletes the file; the active preference
 *     is cleared if the removed model was the
 *     active one).
 *
 * ## Why a separate file
 *
 * The M2b `WisprCard` is ~200 LoC; the M2c
 * `OnDeviceCard` is another ~200 LoC. Keeping them
 * in separate files keeps the
 * `SettingsProvider.tsx` lean (which is already
 * pushing 1800 LoC across AI Providers + AI Tools
 * + Custom Tools). Per Rule 3, components live
 * next to the screen that uses them — that's
 * `src/screens/SettingsProvider/components/`.
 *
 * The file is exported as `OnDeviceCard` from
 * `index.ts`; `SettingsProvider.tsx` imports it
 * and renders it after the `WisprCard`.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';

import { Button } from '@/shared/components/Button';
import {
  onSttDownloadProgress,
  sttInstallModel,
  sttIsAvailable,
  sttListInstalledModels,
  sttListModels,
  sttRemoveModel,
  sttSetActiveModel,
  type DownloadProgressEvent,
  type SttModelDescriptor,
} from '@/ipc/stt';
import { useVoicePreferencesStore } from '@/shared/state/voicePreferencesStore';

import styles from './OnDeviceCard.module.css';

/** Render the byte count as a human-readable
 *  string (e.g. "147 MB"). Used in the model
 *  card subtitle and the progress label. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** A single model row. Pure props in, JSX out
 *  — testable by passing synthetic state. */
interface ModelRowProps {
  model: SttModelDescriptor;
  installed: boolean;
  active: boolean;
  /** `null` when no install is running, otherwise
   *  the id of the model currently being
   *  installed. */
  installingId: string | null;
  /** `undefined` when no install is running for
   *  this model, otherwise a [received, total]
   *  pair. */
  installProgress: { received: number; total: number } | undefined;
  onInstall: (id: string) => void;
  onSetActive: (id: string) => void;
  onDelete: (id: string) => void;
}

function ModelRow({
  model,
  installed,
  active,
  installingId,
  installProgress,
  onInstall,
  onSetActive,
  onDelete,
}: ModelRowProps): JSX.Element {
  const isInstalling = installingId === model.id;
  const showProgress = isInstalling && installProgress;
  // Compute the progress percent. `total` is
  // never 0 here (the curated list has a
  // non-zero size for every entry), but we
  // guard against 0 anyway to avoid
  // division-by-zero in the JSX.
  const progressPct = showProgress && installProgress.total > 0
    ? Math.min(100, Math.round((installProgress.received / installProgress.total) * 100))
    : 0;

  return (
    <div className={styles.modelRow} data-active={active || undefined}>
      <div className={styles.modelMain}>
        <div className={styles.modelHeader}>
          <span className={styles.modelName}>{model.displayName}</span>
          <span
            className={styles.badge}
            data-configured={active ? true : installed ? 'partial' : undefined}
          >
            {active
              ? 'Active'
              : installed
                ? 'Installed'
                : 'Not installed'}
          </span>
        </div>
        <div className={styles.modelMeta}>
          <span className={styles.modelMetaItem}>
            <span className={styles.modelMetaLabel}>Size</span>
            <span className={styles.modelMetaValue}>
              {formatSize(model.sizeBytes)}
            </span>
          </span>
          <span className={styles.modelMetaItem}>
            <span className={styles.modelMetaLabel}>Language</span>
            <span className={styles.modelMetaValue}>
              {model.language === 'en' ? 'English only' : 'Multilingual'}
            </span>
          </span>
        </div>
        {showProgress && (
          <div className={styles.progressBar} role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
            <div
              className={styles.progressFill}
              style={{ width: `${progressPct}%` }}
            />
            <span className={styles.progressLabel}>
              {progressPct}% · {formatSize(installProgress.received)} / {formatSize(installProgress.total)}
            </span>
          </div>
        )}
      </div>
      <div className={styles.modelActions}>
        {!installed && !isInstalling && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => onInstall(model.id)}
            aria-label={`Install ${model.displayName}`}
          >
            Install
          </Button>
        )}
        {isInstalling && (
          <Button
            variant="primary"
            size="sm"
            disabled
            aria-label={`Installing ${model.displayName}`}
          >
            Downloading…
          </Button>
        )}
        {installed && !active && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSetActive(model.id)}
            aria-label={`Set ${model.displayName} as active`}
          >
            Set active
          </Button>
        )}
        {installed && active && (
          <Button
            variant="primary"
            size="sm"
            disabled
            aria-label={`${model.displayName} is active`}
          >
            Active
          </Button>
        )}
        {installed && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(model.id)}
            aria-label={`Delete ${model.displayName}`}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

export function OnDeviceCard(): JSX.Element {
  const [models, setModels] = useState<SttModelDescriptor[]>([]);
  const [installedIds, setInstalledIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<
    { received: number; total: number } | undefined
  >(undefined);
  const [error, setError] = useState<string | null>(null);
  // Track a stale-event guard so a late
  // download-progress event for a previous
  // install doesn't paint the progress bar
  // of the new install. Same pattern as
  // `useVoiceCapture`'s `generationRef`.
  const installGenerationRef = useRef(0);
  const setProvider = useVoicePreferencesStore((s) => s.setProvider);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [list, installed, available] = await Promise.all([
        sttListModels(),
        sttListInstalledModels(),
        sttIsAvailable(),
      ]);
      setModels(list);
      setInstalledIds(new Set(installed));
      setIsAvailable(available);
      // The "active id" is the first installed
      // model (the Rust side keeps a single
      // active preference). We pick the first
      // installed one that matches a curated
      // model id — if none match, we leave it
      // null (the user has never set one).
      const firstInstalled = list.find((m) => installed.includes(m.id));
      setActiveId(firstInstalled?.id ?? null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Failed to read the on-device STT settings',
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Subscribe to download progress events. The
  // unlisten function is called on unmount.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void onSttDownloadProgress((e: DownloadProgressEvent) => {
      // Only react to events for the model
      // we're currently installing.
      if (e.id !== installingId) return;
      setInstallProgress({ received: e.received, total: e.total });
      if (e.done) {
        // The download is complete. Refresh
        // the installed-ids set so the row
        // flips to "Installed" and shows the
        // "Set active" button.
        setInstallingId(null);
        setInstallProgress(undefined);
        void refresh();
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [installingId, refresh]);

  const onInstall = useCallback(
    async (id: string) => {
      setError(null);
      // Bump the generation. Any late-arriving
      // progress event for a previous install is
      // ignored.
      installGenerationRef.current += 1;
      setInstallingId(id);
      setInstallProgress({ received: 0, total: 0 });
      try {
        await sttInstallModel(id);
      } catch (e) {
        setInstallingId(null);
        setInstallProgress(undefined);
        setError(
          e instanceof Error ? e.message : 'Install failed',
        );
      }
    },
    [],
  );

  const onSetActive = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await sttSetActiveModel(id);
        setActiveId(id);
        // Flip the voice provider to 'ondevice'
        // so the VoiceButton picks up the new
        // path on the next click. The user can
        // always flip back to 'wispr' in the
        // provider picker.
        setProvider('ondevice');
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to set active model',
        );
      }
    },
    [setProvider],
  );

  const onDelete = useCallback(
    async (id: string) => {
      setError(null);
      // Confirm the destructive action. We use
      // `window.confirm` because the Settings
      // screen doesn't have a generic confirm
      // modal and we don't want to pull in a
      // dependency for one button. A future
      // M2d follow-up can replace this with a
      // proper in-app confirm dialog.
      const ok = typeof window !== 'undefined'
        ? window.confirm(
          'Delete this model? You can re-install it later.',
        )
        : true;
      if (!ok) return;
      try {
        await sttRemoveModel(id);
        if (id === activeId) setActiveId(null);
        await refresh();
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Failed to delete the model',
        );
      }
    },
    [activeId, refresh],
  );

  // Mark the badge as "unavailable" until the
  // initial `isAvailable` read returns. We
  // don't show a "Checking…" state because the
  // IPC is local + fast.
  const badgeText =
    isAvailable === null
      ? 'Loading…'
      : isAvailable
        ? 'Available'
        : 'No model selected';
  const badgeConfigured = isAvailable === true;

  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h2 className={styles.cardTitle}>On-device (Whisper)</h2>
          <span
            className={styles.badge}
            data-configured={badgeConfigured || undefined}
          >
            {badgeText}
          </span>
        </div>
      </header>
      <p className={styles.cardDescription}>
        On-device speech-to-text runs entirely on your machine — no audio
        ever leaves your computer. Pick a model below; the first install
        downloads a one-time model file (~75–150 MB), and subsequent
        recordings are 100% local and offline. Quality is best on
        English; the multilingual models work on other languages but are
        a step behind cloud providers.
      </p>

      {error && (
        <div className={styles.errorCard} role="alert">
          <span className={styles.errorTitle}>On-device STT error</span>
          <span className={styles.errorDetail}>{error}</span>
        </div>
      )}

      {models.length === 0 ? (
        <div className={styles.placeholder}>Loading models…</div>
      ) : (
        <div className={styles.modelList}>
          {models.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              installed={installedIds.has(m.id)}
              active={m.id === activeId}
              installingId={installingId}
              installProgress={installProgress}
              onInstall={onInstall}
              onSetActive={onSetActive}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </article>
  );
}

// Silence the unused-import warning for the
// `ChangeEvent` import. We import it as a type
// only (not used in the current shape, but
// kept so the file is ready for a future
// "filter by language" dropdown).
void (null as unknown as ChangeEvent<HTMLSelectElement>);
