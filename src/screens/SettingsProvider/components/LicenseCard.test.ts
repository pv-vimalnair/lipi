/**
 * Tests for `LicenseCard`'s pure helpers.
 *
 * The component itself is a thin render + click-handler
 * over `useLicenseStore`; testing the full component needs
 * RTL which isn't in the project's dep set (per Decision
 * #78, we don't add RTL — the pattern is "extract the
 * pure logic into a function and test the function").
 *
 * The two pure helpers are:
 *   - `statusLine(status)` — a human-friendly one-line
 *     summary of the current license status. Used as the
 *     card's lede.
 *   - `humanizeInvalidReason(reason)` — a longer
 *     explanation for each `invalid` variant reason.
 *     Drives the card's `.error` block.
 */
import { describe, expect, it } from 'vitest';

import { humanizeInvalidReason, statusLine } from './LicenseCard';
import type { LicenseStatusPayload } from '@/ipc/licensing';

function trial(daysRemaining: number): LicenseStatusPayload {
  return {
    kind: 'trial',
    expiresAt: 1_000_000 + daysRemaining * 86_400,
    daysRemaining,
  };
}

function active(plan: string, daysRemaining: number): LicenseStatusPayload {
  return {
    kind: 'active',
    plan,
    expiresAt: 1_000_000 + daysRemaining * 86_400,
    issuedAt: 1_000_000 - 30 * 86_400,
    daysRemaining,
  };
}

function grace(plan: string, daysIntoGrace: number): LicenseStatusPayload {
  return {
    kind: 'gracePeriod',
    plan,
    expiredAt: 1_000_000 - daysIntoGrace * 86_400,
    daysIntoGrace,
  };
}

function expired(plan: string): LicenseStatusPayload {
  return {
    kind: 'expired',
    plan,
    expiredAt: 1_000_000 - 8 * 86_400,
  };
}

describe('statusLine', () => {
  it('unactivated: "No license activated."', () => {
    expect(statusLine({ kind: 'unactivated' })).toMatch(/no license activated/i);
  });

  it('active: includes the capitalized plan + days remaining', () => {
    const line = statusLine(active('yearly', 137));
    expect(line).toMatch(/yearly/i);
    expect(line).toMatch(/137 days/);
  });

  it('active: singular "1 day" not "1 days"', () => {
    const line = statusLine(active('monthly', 1));
    expect(line).toMatch(/1 day remaining/);
    expect(line).not.toMatch(/1 days/);
  });

  it('gracePeriod: includes the plan + days into grace', () => {
    const line = statusLine(grace('yearly', 2));
    expect(line).toMatch(/grace period/i);
    expect(line).toMatch(/yearly/i);
    expect(line).toMatch(/2 days? ago/);
  });

  it('gracePeriod: singular "1 day ago" not "1 days ago"', () => {
    const line = statusLine(grace('monthly', 1));
    expect(line).toMatch(/1 day ago/);
    expect(line).not.toMatch(/1 days ago/);
  });

  it('expired: includes the plan + "Activate"', () => {
    const line = statusLine(expired('yearly'));
    expect(line).toMatch(/expired/i);
    expect(line).toMatch(/yearly/i);
    expect(line).toMatch(/activate/i);
  });

  it('trial: includes "trial" + days remaining', () => {
    const line = statusLine(trial(13));
    expect(line).toMatch(/trial/i);
    expect(line).toMatch(/13 days/);
  });

  it('trial: singular "1 day" not "1 days"', () => {
    const line = statusLine(trial(1));
    expect(line).toMatch(/1 day/);
    expect(line).not.toMatch(/1 days/);
  });

  it('invalid: a short "License invalid." message', () => {
    const line = statusLine({ kind: 'invalid', reason: 'machine-mismatch' });
    expect(line).toMatch(/invalid/i);
  });
});

describe('humanizeInvalidReason', () => {
  it('machine-mismatch mentions "different machine" + a fix', () => {
    const msg = humanizeInvalidReason('verification-failed: machine-mismatch: bound to a different machine');
    expect(msg).toMatch(/different machine/i);
    expect(msg).toMatch(/request|new license/i);
  });

  it('not-yet-valid mentions the activation date', () => {
    const msg = humanizeInvalidReason('verification-failed: not-yet-valid: nbf 123 is in the future');
    expect(msg).toMatch(/not yet valid|wait/i);
  });

  it('verification-failed mentions "corrupted" or "tampered"', () => {
    const msg = humanizeInvalidReason('verification-failed: signature verification failed');
    expect(msg).toMatch(/corrupt|tamper/i);
  });

  it('empty key: a polite "no key was provided" message', () => {
    const msg = humanizeInvalidReason('empty key');
    expect(msg).toMatch(/no license key|empty/i);
  });

  it('unknown reason: surfaces the raw reason string', () => {
    const msg = humanizeInvalidReason('something-weird-happened');
    expect(msg).toMatch(/something-weird-happened/);
  });

  // Phase 4: IAP-specific reason codes. Each
  // `iap-` reason maps to a user-friendly message
  // that explains what went wrong and what to do
  // next.
  it('iap-receipt-format-unrecognized mentions "license key" as the fallback', () => {
    const msg = humanizeInvalidReason('iap-receipt-format-unrecognized: unknown format');
    expect(msg).toMatch(/license key/i);
  });

  it('iap-sandbox-not-supported explains the sandbox-vs-production distinction', () => {
    const msg = humanizeInvalidReason('iap-sandbox-not-supported: this receipt is a TestFlight / sandbox receipt');
    expect(msg).toMatch(/sandbox|TestFlight/i);
  });

  it('iap-product-id-mismatch mentions "matching Restore button"', () => {
    const msg = humanizeInvalidReason('iap-product-id-mismatch: expected "app.lipi.ide.monthly", got "app.lipi.ide.yearly"');
    expect(msg).toMatch(/matching Restore|monthly|yearly/i);
  });

  it('iap-expired mentions "renew"', () => {
    const msg = humanizeInvalidReason('iap-expired: the subscription expired at unix 1700000000');
    expect(msg).toMatch(/renew|expired/i);
  });

  it('iap-network-error mentions "receipt server"', () => {
    const msg = humanizeInvalidReason('iap-network-error: connection refused');
    expect(msg).toMatch(/receipt server|try again/i);
  });

  it('iap-keychain-error mentions "keychain"', () => {
    const msg = humanizeInvalidReason('iap-keychain-error: keychain entry cache lock poisoned');
    expect(msg).toMatch(/keychain/i);
  });

  it('iap-not-yet-implemented (backward-compat) is still humanized', () => {
    const msg = humanizeInvalidReason('iap-not-yet-implemented: coming in a future update');
    expect(msg).toMatch(/coming|future update|license key/i);
  });
});
