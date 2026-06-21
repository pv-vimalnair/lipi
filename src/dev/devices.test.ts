/**
 * Tests for `devices.ts` (M1).
 *
 * The file is data â€” the tests
 * assert shape, sane ranges,
 * and that each device has
 * the new M1 fields
 * (`safeAreaTop`,
 * `safeAreaBottom`).
 */

import { describe, expect, it } from 'vitest';
import { TOP_8_DEVICES } from './devices';

describe('TOP_8_DEVICES', () => {
  it('has exactly 8 devices', () => {
    expect(TOP_8_DEVICES).toHaveLength(8);
  });

  it('each device has a unique id', () => {
    const ids = TOP_8_DEVICES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('each device has the new M1 safeArea fields as finite, non-negative numbers', () => {
    for (const d of TOP_8_DEVICES) {
      expect(Number.isFinite(d.safeAreaTop)).toBe(true);
      expect(Number.isFinite(d.safeAreaBottom)).toBe(true);
      expect(d.safeAreaTop).toBeGreaterThanOrEqual(0);
      expect(d.safeAreaBottom).toBeGreaterThanOrEqual(0);
    }
  });

  it('a device with `hasNotch: true` has notchWidth and notchHeight > 0', () => {
    for (const d of TOP_8_DEVICES) {
      if (d.hasNotch) {
        expect(d.notchWidth).toBeGreaterThan(0);
        expect(d.notchHeight).toBeGreaterThan(0);
      }
    }
  });

  it('a device with a notch has safeAreaTop >= notchHeight (sanity)', () => {
    // The safe-area top
    // includes the notch
    // PLUS the status
    // bar overflow. A
    // device with a
    // notch should
    // never have
    // safeAreaTop < its
    // notchHeight.
    for (const d of TOP_8_DEVICES) {
      if (d.hasNotch && d.notchHeight !== undefined) {
        expect(d.safeAreaTop).toBeGreaterThanOrEqual(d.notchHeight);
      }
    }
  });

  it('a device with a home indicator has safeAreaBottom >= homeIndicatorHeight', () => {
    for (const d of TOP_8_DEVICES) {
      if (d.homeIndicatorHeight > 0) {
        expect(d.safeAreaBottom).toBeGreaterThanOrEqual(
          d.homeIndicatorHeight,
        );
      }
    }
  });

  it('widths and heights are reasonable phone / tablet sizes', () => {
    for (const d of TOP_8_DEVICES) {
      // Phones:
      // 320-440 wide
      // (CSS px at 1Ã—
      // DPR). Tablets:
      // 700-1300 wide.
      expect(d.width).toBeGreaterThanOrEqual(320);
      expect(d.width).toBeLessThanOrEqual(1300);
      expect(d.height).toBeGreaterThanOrEqual(640);
      expect(d.height).toBeLessThanOrEqual(1400);
    }
  });

  it('the iPhone 15 Pro has the iOS-typical 47px / 34px safe-area insets', () => {
    // Locks the documented
    // values so an
    // accidental edit
    // (e.g. swapping 47
    // and 34) is caught.
    const iphone =
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
      TOP_8_DEVICES.find((d) => d.id === 'iphone-15-pro')!;
    expect(iphone.safeAreaTop).toBe(47);
    expect(iphone.safeAreaBottom).toBe(34);
  });

  it('the iPhone SE 3 has a 0px bottom safe-area inset (hardware home button)', () => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test setup guarantees value exists
    const se = TOP_8_DEVICES.find((d) => d.id === 'iphone-se-3')!;
    expect(se.safeAreaBottom).toBe(0);
  });
});
