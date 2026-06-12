/**
 * Top-8 mobile device specs. Width / height are CSS px at 1× DPR; the
 * emulator uses these as logical viewport sizes and lets the browser
 * scale by DPR.
 *
 * Notch geometry is in CSS px relative to the device's top edge:
 *   - `notchWidth` / `notchHeight` describe the cutout
 *   - `cornerRadius` is the outer body radius
 *
 * Safe-area insets (M1) are the top / bottom values reported by the
 * OS to web content via `env(safe-area-inset-*)`:
 *   - `safeAreaTop`    = notch / dynamic island height + the
 *                       12-24px the OS adds above it (status bar
 *                       overflow). For an iPhone 15 Pro this is
 *                       ~47px in portrait; for a Pixel 8 it's ~30px.
 *   - `safeAreaBottom` = home indicator height + 8-16px the OS adds
 *                       below it. For an iPhone 15 Pro this is ~34px;
 *                       for a Pixel 8 it's ~24px.
 *   - 0 on devices without
 *     notches / home indicators
 *     (e.g. iPhone SE 3,
 *     Galaxy Tab S9 in
 *     landscape with no
 *     hardware bar).
 *
 * Numbers were taken from the manufacturers' public spec sheets.
 * Refresh this file when a new flagship ships.
 */

export type DeviceKind = 'phone' | 'tablet';

export interface DeviceSpec {
  id: string;
  label: string;
  kind: DeviceKind;
  width: number;
  height: number;
  dpr: number;
  cornerRadius: number;
  /** True if the device has a notch / dynamic island. */
  hasNotch: boolean;
  notchWidth?: number;
  notchHeight?: number;
  /** Bottom home-indicator height, in CSS px. 0 means hardware home button. */
  homeIndicatorHeight: number;
  /**
   * Top safe-area inset in CSS px. Used to position the
   * `MobileShell`'s top bar / status-bar element so the chrome
   * starts below the notch / dynamic island.
   */
  safeAreaTop: number;
  /**
   * Bottom safe-area inset in CSS px. Used to position the
   * `MobileShell`'s bottom tab bar so the home indicator
   * is visible above the gesture pill.
   */
  safeAreaBottom: number;
}

export const TOP_8_DEVICES: ReadonlyArray<DeviceSpec> = [
  {
    id: 'iphone-15-pro',
    label: 'iPhone 15 Pro',
    kind: 'phone',
    width: 393,
    height: 852,
    dpr: 3,
    cornerRadius: 55,
    hasNotch: true,
    notchWidth: 120,
    notchHeight: 35,
    homeIndicatorHeight: 5,
    // iPhone 15 Pro reports
    // ~47px top (notch
    // + status overflow)
    // and ~34px bottom
    // (home indicator
    // + 8px padding).
    safeAreaTop: 47,
    safeAreaBottom: 34,
  },
  {
    id: 'iphone-se-3',
    label: 'iPhone SE (3rd gen)',
    kind: 'phone',
    width: 375,
    height: 667,
    dpr: 2,
    cornerRadius: 0,
    hasNotch: false,
    homeIndicatorHeight: 0,
    // iPhone SE has a
    // hardware home button
    // — no safe-area
    // insets.
    safeAreaTop: 20,
    safeAreaBottom: 0,
  },
  {
    id: 'galaxy-s24',
    label: 'Galaxy S24',
    kind: 'phone',
    width: 360,
    height: 800,
    dpr: 3,
    cornerRadius: 24,
    hasNotch: true,
    notchWidth: 8,
    notchHeight: 8,
    homeIndicatorHeight: 4,
    // Galaxy S24 has a tiny
    // pin-hole camera. The
    // status bar still
    // pushes content down
    // ~24px.
    safeAreaTop: 24,
    safeAreaBottom: 22,
  },
  {
    id: 'pixel-8',
    label: 'Pixel 8',
    kind: 'phone',
    width: 412,
    height: 915,
    dpr: 2.625,
    cornerRadius: 30,
    hasNotch: true,
    notchWidth: 60,
    notchHeight: 18,
    homeIndicatorHeight: 4,
    // Pixel 8 has a centred
    // camera punch-hole
    // (no notch). Status
    // bar reports ~30px top.
    safeAreaTop: 30,
    safeAreaBottom: 24,
  },
  {
    id: 'oneplus-12',
    label: 'OnePlus 12',
    kind: 'phone',
    width: 412,
    height: 915,
    dpr: 3.5,
    cornerRadius: 28,
    hasNotch: true,
    notchWidth: 10,
    notchHeight: 10,
    homeIndicatorHeight: 4,
    // OnePlus 12 has a
    // pin-hole camera. The
    // status bar pushes
    // content ~30px down
    // (similar to the
    // Pixel).
    safeAreaTop: 30,
    safeAreaBottom: 24,
  },
  {
    id: 'ipad-air-m2-11',
    label: 'iPad Air M2 (11")',
    kind: 'tablet',
    width: 820,
    height: 1180,
    dpr: 2,
    cornerRadius: 22,
    hasNotch: false,
    homeIndicatorHeight: 5,
    // iPad has a 20px
    // status bar in
    // portrait; the home
    // indicator adds
    // ~20px to the
    // bottom.
    safeAreaTop: 20,
    safeAreaBottom: 20,
  },
  {
    id: 'ipad-mini-6',
    label: 'iPad mini (6th gen)',
    kind: 'tablet',
    width: 744,
    height: 1133,
    dpr: 2,
    cornerRadius: 22,
    hasNotch: false,
    homeIndicatorHeight: 5,
    safeAreaTop: 20,
    safeAreaBottom: 20,
  },
  {
    id: 'galaxy-tab-s9',
    label: 'Galaxy Tab S9',
    kind: 'tablet',
    width: 800,
    height: 1280,
    dpr: 2,
    cornerRadius: 14,
    hasNotch: false,
    homeIndicatorHeight: 4,
    safeAreaTop: 20,
    safeAreaBottom: 16,
  },
];
