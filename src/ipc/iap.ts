/**
 * TypeScript IPC wrapper for the Rust `iap_redeem`
 * command.
 *
 * Phase 3 (subscription UX). The v1 stub returns
 * `Invalid { reason: "iap-not-yet-implemented: ..." }`
 * for any input; Phase 4 fills in the real receipt
 * validation. The IPC surface (this function's
 * signature) is stable; only the Rust implementation
 * changes.
 *
 * The UI calls this from the "Restore from App Store"
 * flow on the License activation screen.
 */
import { invoke } from '@tauri-apps/api/core';

import type { LicenseStatusPayload } from './licensing';

/**
 * Redeem an IAP receipt. The Rust side inspects the
 * receipt format (Mac App Store vs Microsoft Store
 * vs Google Play vs …) and dispatches to the
 * platform-specific validator. On success, the
 * Rust side generates a `LicensePayload`, signs it
 * with the production private key, and stores it in
 * the OS keychain — the same code path as
 * `license_activate`. The returned status is the
 * same shape as the `license_*` commands'.
 *
 * The v1 stub returns `Invalid { reason:
 * "iap-not-yet-implemented: ..." }` for any input.
 *
 * @param receipt - The IAP receipt string (base64-
 *   encoded for Mac App Store, XML for Microsoft
 *   Store, JSON for Google Play).
 * @param plan - The plan the user is buying
 *   (`monthly` or `yearly`). The Rust side validates
 *   this against the IAP product ID.
 */
export async function iapRedeem(
  receipt: string,
  plan: 'monthly' | 'yearly',
): Promise<LicenseStatusPayload> {
  return invoke<LicenseStatusPayload>('iap_redeem', { receipt, plan });
}
