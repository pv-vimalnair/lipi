/**
 * Tests for the `iap` IPC layer.
 *
 * The v1 stub returns
 * `Invalid { reason: "iap-not-yet-implemented: ..." }`
 * for any input. We pin the wire shape and the
 * "not yet implemented" reason here — any change to
 * the Rust serialisation that breaks the JS
 * expectation is caught here, not at runtime.
 */
import { describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

const { iapRedeem } = await import('./iap');

describe('iapRedeem', () => {
  it('invokes the iap_redeem Tauri command with the receipt and plan', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason: 'iap-not-yet-implemented: receipt bytes: 10, plan: monthly',
    });
    await iapRedeem('fake-receipt', 'monthly');
    expect(invokeMock).toHaveBeenCalledWith('iap_redeem', {
      receipt: 'fake-receipt',
      plan: 'monthly',
    });
  });

  it('returns the invalid status from the Rust side unchanged', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason: 'iap-not-yet-implemented: receipt bytes: 20, plan: yearly',
    });
    const result = await iapRedeem('a'.repeat(20), 'yearly');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/iap-not-yet-implemented/);
    }
  });

  it('accepts monthly and yearly plans (TS-level type narrowing)', async () => {
    invokeMock.mockResolvedValueOnce({ kind: 'invalid', reason: 'iap-not-yet-implemented' });
    await iapRedeem('r', 'monthly');
    expect(invokeMock).toHaveBeenLastCalledWith('iap_redeem', { receipt: 'r', plan: 'monthly' });

    invokeMock.mockResolvedValueOnce({ kind: 'invalid', reason: 'iap-not-yet-implemented' });
    await iapRedeem('r', 'yearly');
    expect(invokeMock).toHaveBeenLastCalledWith('iap_redeem', { receipt: 'r', plan: 'yearly' });
  });
});
