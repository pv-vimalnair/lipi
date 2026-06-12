import type { CSSProperties } from 'react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { TOP_8_DEVICES, type DeviceSpec } from '../devices';
import { useDeviceEmulatorStore } from '../state/deviceEmulatorStore';
import { MobileShell } from '@/screens/EditorWorkspace/components/MobileShell';
import styles from './DeviceEmulator.module.css';

const PREVIEW_SCALE = 0.45;

/**
 * Top-8 mobile device emulator.
 *
 * Each frame renders the LIVE
 * `MobileShell` (the real mobile
 * UX, scaled down) inside a CSS
 * device frame (notch + home
 * indicator + corner radius),
 * so the dev can see how the
 * mobile layout holds up on
 * the most popular phones and
 * tablets without leaving the
 * desktop dev environment.
 *
 * ## Why a portal
 *
 * Each scaled `MobileShell`
 * needs its own `--safe-top`
 * and `--safe-bottom` CSS
 * variables on the host frame
 * (so the painted notch /
 * home indicator line up with
 * the chrome). The simplest
 * way to scope a CSS variable
 * to a subtree is to assign it
 * on the subtree's root. The
 * `MobileShell` is a single
 * shared component, so we
 * `createPortal` an instance
 * into each frame's
 * `.scaledSurface` element
 * — the portal target
 * inherits the CSS variables
 * from the frame.
 *
 * The portal target must be
 * in the DOM by the time
 * `createPortal` runs. We
 * capture the host ref via
 * a callback ref (which fires
 * SYNCHRONOUSLY when the
 * element mounts) and re-
 * render the portal contents
 * once the ref is attached.
 *
 * ## Why pointer events are
 *   blocked at the frame
 *   level
 *
 * The emulator is a LAYOUT
 * PREVIEW, not a runtime.
 * Clicking a tab in a
 * scaled frame would change
 * the state of that frame's
 * local `MobileShell` (each
 * has its own `useState` for
 * the active tab), which is
 * confusing — the real app's
 * mobile shell is hidden when
 * the emulator is open, so
 * the click has no visible
 * effect on the real app.
 * Better to show the layout
 * (which is the point of
 * the preview) and let
 * users interact with the
 * real app to test touch
 * behavior. So the scaled
 * surface has
 * `pointer-events: none`.
 *
 * ## Toggle (M1)
 *
 * The emulator mounts only
 * when `useDeviceEmulatorStore`
 * `enabled === true`. The
 * toggle is bound to
 * `Cmd-Shift-D` /
 * `Ctrl-Shift-D` via
 * `useDeviceEmulatorShortcut`
 * (mounted in the editor
 * workspace). The strip
 * itself has a small [Close]
 * button in the header —
 * a non-keyboard user has
 * a way to dismiss.
 */
export function DeviceEmulator() {
  const enabled = useDeviceEmulatorStore((s) => s.enabled);
  const setEnabled = useDeviceEmulatorStore((s) => s.setEnabled);

  if (!enabled) return null;

  return (
    <div
      className={styles.strip}
      role="region"
      aria-label="Device emulator"
      data-testid="device-emulator"
    >
      <header className={styles.header}>
        <span className={styles.title}>Device preview</span>
        <span className={styles.subtitle}>
          Top 8 · {TOP_8_DEVICES.length} devices · layout preview only ·
          <kbd> Cmd-Shift-D </kbd>
          to toggle
        </span>
        <button
          type="button"
          className={styles.closeButton}
          onClick={() => setEnabled(false)}
          aria-label="Close device emulator"
          data-testid="device-emulator-close"
        >
          Close
        </button>
      </header>
      <div className={styles.row}>
        {TOP_8_DEVICES.map((device) => (
          <DeviceFrame key={device.id} device={device} />
        ))}
      </div>
    </div>
  );
}

function DeviceFrame({ device }: { device: DeviceSpec }) {
  // The frame's outer size
  // (visible on the page,
  // not the device's true
  // size) is the device
  // dimensions ×
  // PREVIEW_SCALE.
  const frameStyle: CSSProperties = {
    width: device.width * PREVIEW_SCALE,
    height: device.height * PREVIEW_SCALE,
    borderRadius: device.cornerRadius * PREVIEW_SCALE,
  };

  // The screen inside the
  // bezel. Width / height
  // match the frame so the
  // scaled surface inside
  // it (at full device
  // dimensions) shrinks
  // down to fit.
  const screenStyle: CSSProperties = {
    width: device.width * PREVIEW_SCALE,
    height: device.height * PREVIEW_SCALE,
  };

  // The scaled surface is
  // the full device size,
  // `transform: scale()`d
  // down to fit the
  // screen. Anchored at
  // the top-left.
  const scaledStyle: CSSProperties = {
    width: device.width,
    height: device.height,
    transform: `scale(${PREVIEW_SCALE})`,
    // `pointer-events: none`
    // blocks taps inside
    // the frame from
    // reaching the
    // underlying
    // MobileShell. See
    // the file header.
    pointerEvents: 'none',
  };

  // The CSS variables
  // `--safe-top` /
  // `--safe-bottom` are
  // set on the SCREEN
  // (not the frame) so
  // the painted notch
  // and home indicator
  // line up with where
  // the MobileShell's
  // chrome sits. The
  // values are in
  // UNSCALED CSS px.
  const safeAreaStyle: CSSProperties = {
    '--safe-top': `${device.safeAreaTop}px`,
    '--safe-bottom': `${device.safeAreaBottom}px`,
  } as CSSProperties;

  // The host element
  // for the portal. We
  // use a callback ref
  // so the portal can
  // re-attach when the
  // element mounts /
  // remounts. React
  // guarantees the
  // callback fires
  // synchronously on
  // mount, so the
  // portal target is
  // available on the
  // SAME render the
  // callback fires
  // (i.e. the second
  // render after
  // mount).
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  return (
    <figure className={styles.frame} style={frameStyle} data-kind={device.kind}>
      <div className={styles.bezel} style={frameStyle}>
        <div
          className={styles.screen}
          style={{ ...screenStyle, ...safeAreaStyle }}
        >
          {device.hasNotch && device.notchWidth && device.notchHeight && (
            <div
              className={styles.notch}
              style={{
                width: device.notchWidth,
                height: device.notchHeight,
                top: device.notchHeight * 0.1,
                transform:
                  'translateX(-50%) translateY(-1px)',
              }}
              aria-hidden="true"
            />
          )}
          <div
            ref={setHost}
            className={styles.scaledSurface}
            style={scaledStyle}
          >
            {host && createPortal(<MobileShell />, host)}
          </div>
          {device.homeIndicatorHeight > 0 && (
            <div
              className={styles.homeIndicator}
              style={{
                height: device.homeIndicatorHeight,
                // Position the
                // indicator
                // `safeAreaBottom
                // - homeIndicatorHeight
                // - 6px` from
                // the bottom
                // of the
                // screen.
                bottom: Math.max(
                  device.safeAreaBottom -
                    device.homeIndicatorHeight -
                    6,
                  6,
                ),
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      <figcaption className={styles.caption}>
        {device.label}
        <br />
        {device.width}×{device.height}
      </figcaption>
    </figure>
  );
}
