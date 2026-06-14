/**
 * TypeScript IPC wrapper for the Rust `iap_redeem`
 * command.
 *
 * Phase 4 (IAP receipt validation). The v1 stub
 * (which returned
 * `Invalid { reason: "iap-not-yet-implemented: ..." }`
 * for any input) is gone. The Rust side now
 * actually validates the receipt against Apple
 * (`verifyReceipt`) or Microsoft (Store Broker
 * API), generates a `LicensePayload` bound to
 * the current machine, signs it with a per-machine
 * Ed25519 keypair, and saves it to the keychain.
 * The IPC surface (this function's signature) is
 * unchanged from Phase 3.
 *
 * The UI calls this from the "Restore from App
 * Store" / "Restore from Microsoft Store" flow
 * on the License activation screen.
 *
 * # Error reasons
 *
 * On failure, the Rust side returns
 * `LicenseStatus::Invalid { reason: "iap-...: ..." }`.
 * The `iap-` prefix is the convention; the rest
 * of the reason is a short code (e.g.
 * `iap-expired`) optionally followed by `:` and
 * a human-readable detail (e.g.
 * `iap-expired: the subscription expired at unix
 * 1700000000`). The UI humanizes the reason via
 * the existing `humanizeInvalidReason` helper.
 *
 * The full list of reason codes:
 *
 * - `iap-receipt-format-unrecognized` — the
 *   receipt doesn't match JSON (Apple) or
 *   XML (Microsoft). The user is on Linux
 *   (no IAP) or pasted a license key in the
 *   wrong field. UI: "we couldn't recognize
 *   the receipt format. Please paste a
 *   license key instead."
 * - `iap-malformed-response` — the JSON or
 *   XML response from Apple / Microsoft
 *   couldn't be parsed. UI: "the receipt
 *   server returned an unexpected response.
 *   Please try again, or paste a license
 *   key instead."
 * - `iap-rejected-by-apple` / `iap-rejected-by-microsoft`
 *   — Apple / Microsoft rejected the receipt.
 *   The detail includes the status code. UI:
 *   "the receipt was rejected by the store.
 *   Please contact support with code {status}."
 * - `iap-sandbox-not-supported` — the receipt
 *   is a TestFlight / sandbox receipt. UI: "this
 *   receipt is a TestFlight / sandbox receipt.
 *   Please switch to a production license key."
 * - `iap-no-purchase-found` — the receipt is
 *   valid but has no in-app purchases. UI: "the
 *   receipt is valid but has no in-app purchases.
 *   Did you mean to paste a license key?"
 * - `iap-product-id-mismatch` — the receipt's
 *   product ID doesn't match the requested
 *   plan (e.g. user asked for monthly but the
 *   receipt is for yearly). UI: "this receipt
 *   is for a different plan. Use the matching
 *   Restore button."
 * - `iap-plan-mismatch` — same as
 *   product-id-mismatch but raised by the
 *   dispatcher (double-check). UI: same as above.
 * - `iap-product-id-unknown` — internal error,
 *   the receipt's product ID doesn't match any
 *   known plan. UI: "internal error: please
 *   file a bug with the receipt's product ID."
 * - `iap-expired` — the subscription is in the
 *   past. UI: "your subscription has expired.
 *   Please renew at {pricing url}."
 * - `iap-future-purchase` — the receipt's
 *   purchase date is in the future (clock
 *   skew or a forged receipt). UI: "the
 *   receipt's purchase date is in the future.
 *   Please check your system clock."
 * - `iap-network-error` — the HTTP call to
 *   Apple / Microsoft failed. UI: "couldn't
 *   reach the receipt server. Please try
 *   again."
 * - `iap-shared-secret-missing` — the Apple
 *   shared secret env var is not set (dev
 *   build, CI). UI: "Apple IAP is not
 *   configured in this build."
 * - `iap-azure-credentials-missing` — the
 *   Microsoft Azure AD client credentials
 *   env vars are not set. UI: "Microsoft
 *   Store IAP is not configured in this
 *   build."
 * - `iap-oauth-failed` — the Microsoft OAuth
 *   flow failed. UI: "Microsoft Store
 *   authentication failed."
 * - `iap-unknown-plan` — the plan name is
 *   not one of "monthly", "yearly". UI:
 *   "unknown plan."
 * - `iap-keychain-error` — the OS keychain
 *   returned an error (permission denied,
 *   I/O error, etc.). UI: "couldn't access
 *   the keychain."
 * - `iap-sign-failed` — the per-machine
 *   keypair signature failed. UI: "internal
 *   error: signature failed."
 * - `iap-save-failed` — saving the license
 *   to the keychain failed. UI: "couldn't
 *   save the license."
 * - `license-shape-invalid` — the generated
 *   `LicensePayload` failed shape validation
 *   (a bug). UI: "internal error: invalid
 *   license shape."
 * - `iap-not-yet-implemented` — kept for
 *   backward-compat with the Phase 3 stub
 *   (UI checks for this string in case the
 *   user has an old build that calls the
 *   old stub). UI: "IAP is coming in a
 *   future update."
 */
import { invoke } from '@tauri-apps/api/core';

import type { LicenseStatusPayload } from './licensing';

/**
 * Redeem an IAP receipt. The Rust side inspects
 * the receipt format (Mac App Store vs Microsoft
 * Store) and dispatches to the platform-specific
 * validator. On success, the Rust side generates
 * a `LicensePayload` bound to the current
 * machine's fingerprint, signs it with a
 * per-machine Ed25519 keypair (generated on
 * first IAP redemption, stored in the keychain),
 * and stores it in the OS keychain — the same
 * code path as `licenseActivate`. The returned
 * status is the same shape as the `license_*`
 * commands'.
 *
 * @param receipt - The IAP receipt string. On
 *   Mac, this is the JSON response from Apple's
 *   `verifyReceipt` (or the raw base64 receipt,
 *   which the Rust side will POST). On Windows,
 *   this is the raw XML from
 *   `Windows.Services.Store`.
 * @param plan - The plan the user is buying
 *   (`monthly` or `yearly`). The Rust side
 *   validates this against the IAP product ID.
 */
export async function iapRedeem(
  receipt: string,
  plan: 'monthly' | 'yearly',
): Promise<LicenseStatusPayload> {
  return invoke<LicenseStatusPayload>('iap_redeem', { receipt, plan });
}

/**
 * Re-validate the IAP-issued license and
 * extend its `exp` if the user has renewed
 * their subscription.
 *
 * Phase 4.1 (IAP v1.1 follow-ups). This
 * command is **only** applicable to
 * IAP-issued licenses (those with
 * `kid = "iap-local"`). For trial or
 * offline-purchase licenses, the Rust
 * side returns
 * `Invalid { reason: "iap-refresh-not-applicable: ..." }`.
 *
 * The flow is the same as `iapRedeem` for
 * the receipt-validation step, but the
 * command additionally:
 *
 * 1. Loads the current license from the
 *    keychain and verifies its signature.
 * 2. Checks the `kid` field — only
 *    `kid = "iap-local"` licenses are
 *    refreshable.
 * 3. Compares the new receipt's `exp` to
 *    the current license's `exp`. If the
 *    new `exp` is not later, returns
 *    `iap-refresh-no-extension` (don't
 *    downgrade).
 * 4. Builds a new `LicensePayload` with
 *    the new `exp` and saves it.
 *
 * # Error reasons (additional to iapRedeem's)
 *
 * - `iap-license-missing` — no license in
 *   the keychain.
 * - `iap-license-invalid` — the existing
 *   license failed verification.
 * - `iap-license-load-failed` — keychain
 *   read error.
 * - `iap-refresh-not-applicable` — the
 *   current license is not IAP-issued.
 *   UI: "this command only works for
 *   IAP-issued licenses. For trial or
 *   offline-purchase licenses, use the
 *   existing license activation flow."
 * - `iap-refresh-no-extension` — the new
 *   receipt's `exp` is not later than the
 *   current license's `exp`. UI: "the
 *   new receipt's expiration is not
 *   later than the current license's.
 *   The license was not updated."
 * - `iap-refresh-failed` — the new
 *   receipt did not produce an active
 *   license (sanity check).
 *
 * @param receipt - The new IAP receipt
 *   string (same format as `iapRedeem`).
 * @param plan - The plan the user has
 *   renewed (`monthly` or `yearly`).
 */
export async function iapRefreshLicense(
  receipt: string,
  plan: 'monthly' | 'yearly',
): Promise<LicenseStatusPayload> {
  return invoke<LicenseStatusPayload>('iap_refresh_license', { receipt, plan });
}
