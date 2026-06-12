/**
 * Tests for `useHaptics`'s pure `fireHaptic` helper.
 *
 * The hook itself is a thin `useCallback` wrapper
 * around the helper. We test the helper directly so
 * the project doesn't need `@testing-library/react`
 * (the standard pattern in this codebase — see
 * `useOpenWorkspace.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { hapticMock } = vi.hoisted(() => ({
  hapticMock: vi.fn(),
}));

vi.mock('@/ipc', async () => {
  const actual = await vi.importActual<typeof import('@/ipc')>('@/ipc');
  return {
    ...actual,
    haptic: hapticMock,
  };
});

const { fireHaptic, useHaptics } = await import('./useHaptics');

describe('fireHaptic', () => {
  beforeEach(() => {
    hapticMock.mockReset();
    hapticMock.mockResolvedValue(undefined);
  });
  afterEach(() => {
    hapticMock.mockReset();
  });

  it('forwards the intensity to the IPC', async () => {
    await fireHaptic('light');
    expect(hapticMock).toHaveBeenCalledWith('light');
  });

  it('supports medium and heavy', async () => {
    await fireHaptic('medium');
    await fireHaptic('heavy');
    expect(hapticMock).toHaveBeenNthCalledWith(1, 'medium');
    expect(hapticMock).toHaveBeenNthCalledWith(2, 'heavy');
  });

  it('swallows a rejecting IPC and does not throw', async () => {
    hapticMock.mockRejectedValueOnce(new Error('boom'));
    await expect(fireHaptic('light')).resolves.toBeUndefined();
    expect(hapticMock).toHaveBeenCalledTimes(1);
  });

  it('a subsequent call still fires after a rejection', async () => {
    hapticMock.mockRejectedValueOnce(new Error('boom'));
    await fireHaptic('light');
    await fireHaptic('medium');
    expect(hapticMock).toHaveBeenCalledTimes(2);
  });
});

describe('useHaptics hook shape', () => {
  it('is a function (callable as a hook)', () => {
    expect(typeof useHaptics).toBe('function');
  });
});
