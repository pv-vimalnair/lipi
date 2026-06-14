/**
 * Tests for the `iap` IPC layer.
 *
 * Phase 4 (IAP receipt validation). The v1 stub
 * is gone; the Rust side now actually validates
 * the receipt. We pin the IPC surface (the
 * `iap_redeem` Tauri command name + the
 * `LicenseStatusPayload` shape) and a few
 * representative error reasons.
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
      kind: 'active',
      plan: 'monthly',
      expiresAt: 0,
      issuedAt: 0,
      daysRemaining: 30,
    });
    await iapRedeem('{"status":0,"latest_receipt_info":[]}', 'monthly');
    expect(invokeMock).toHaveBeenCalledWith('iap_redeem', {
      receipt: '{"status":0,"latest_receipt_info":[]}',
      plan: 'monthly',
    });
  });

  it('returns the active status from the Rust side unchanged', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'active',
      plan: 'yearly',
      expiresAt: 9999999999,
      issuedAt: 1700000000,
      daysRemaining: 365,
    });
    const result = await iapRedeem('<Receipt>...</Receipt>', 'yearly');
    expect(result.kind).toBe('active');
    if (result.kind === 'active') {
      expect(result.plan).toBe('yearly');
      expect(result.daysRemaining).toBe(365);
    }
  });

  it('accepts monthly and yearly plans (TS-level type narrowing)', async () => {
    invokeMock.mockResolvedValueOnce({ kind: 'active', plan: 'monthly' });
    await iapRedeem('r', 'monthly');
    expect(invokeMock).toHaveBeenLastCalledWith('iap_redeem', { receipt: 'r', plan: 'monthly' });

    invokeMock.mockResolvedValueOnce({ kind: 'active', plan: 'yearly' });
    await iapRedeem('r', 'yearly');
    expect(invokeMock).toHaveBeenLastCalledWith('iap_redeem', { receipt: 'r', plan: 'yearly' });
  });

  it('propagates iap-receipt-format-unrecognized for unknown formats', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason:
        'iap-receipt-format-unrecognized: the receipt doesn\'t match a known format. Receipt length: 10 bytes.',
    });
    const result = await iapRedeem('not-a-receipt', 'monthly');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/iap-receipt-format-unrecognized/);
    }
  });

  it('propagates iap-expired for past-due subscriptions', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason: 'iap-expired: the subscription expired at unix 1700000000 (now 1800000000)',
    });
    const result = await iapRedeem('{"status":0}', 'monthly');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/iap-expired/);
    }
  });

  it('propagates iap-product-id-mismatch for mismatched plans', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason: 'iap-product-id-mismatch: expected "app.lipi.ide.monthly" for this plan, got "app.lipi.ide.yearly"',
    });
    const result = await iapRedeem('{"status":0}', 'monthly');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/iap-product-id-mismatch/);
    }
  });

  it('propagates iap-sandbox-not-supported for TestFlight receipts', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason: 'iap-sandbox-not-supported: this receipt is a TestFlight / sandbox receipt. Phase 4 only supports production receipts.',
    });
    const result = await iapRedeem('{"status":21007}', 'monthly');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/iap-sandbox-not-supported/);
    }
  });

  it('propagates iap-keychain-error for keychain failures', async () => {
    invokeMock.mockResolvedValueOnce({
      kind: 'invalid',
      reason: 'iap-keychain-error: keychain entry cache lock poisoned',
    });
    const result = await iapRedeem('{"status":0}', 'monthly');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/iap-keychain-error/);
    }
  });
});
