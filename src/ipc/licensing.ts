/**
 * Typed IPC wrapper for the offline-license layer
 * (Phase 2 — see `docs/plans/prod-p2-licensing-design.md`
 * for the full design and `HANDOFF.md §9.24` for the
 * per-phase writeup).
 *
 * Mirrors `src-tauri/src/licensing.rs`. The license is a
 * JWS-style compact signed document ("LIP1.payload.signature")
 * using Ed25519. The Rust side embeds the public key
 * (production + trial) and verifies the signature offline
 * — no server round-trip, no phone-home, no revocation
 * list (per Decision #17: "no backend, ever").
 *
 * The IPC surface is intentionally tiny: 4 commands.
 * `licenseGetStatus` is the only one called in the hot
 * path (it caches per session — see
 * `src/shared/state/licenseStore.ts`). The other three
 * are called from the activation screen and the settings
 * card.
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Tagged union mirroring the Rust `LicenseStatus` enum.
 * Serialised to camelCase JSON by `#[serde(rename_all =
 * "camelCase", tag = "kind")]` on the Rust side.
 *
 * The variants are:
 *
 * - `unactivated` — no license in the keychain. The Rust
 *   side auto-generates a 14-day trial on first call, so
 *   this variant is only returned after an explicit
 *   `licenseDeactivate()` call.
 * - `active` — paid license (plan: "monthly" | "yearly")
 *   is valid and not expired. `daysRemaining` is a
 *   convenience field for the UI ("137 days left").
 * - `gracePeriod` — license is past `exp` but within the
 *   7-day grace period. The UI shows a "Renew now" banner.
 * - `expired` — license is past the grace period. The UI
 *   (Phase 3) hard-blocks the workspace.
 * - `trial` — first-run 14-day trial. `daysRemaining`
 *   drives the trial-progress badge in the title bar.
 * - `invalid` — license failed verification. `reason` is
 *   a machine-readable string ("verification-failed",
 *   "machine-mismatch", "not-yet-valid", etc.) that the
 *   UI displays in an alert dialog.
 */
export type LicenseStatusPayload =
  | { kind: 'unactivated' }
  | { kind: 'active'; plan: string; expiresAt: number; issuedAt: number; daysRemaining: number }
  | { kind: 'gracePeriod'; plan: string; expiredAt: number; daysIntoGrace: number }
  | { kind: 'expired'; plan: string; expiredAt: number }
  | { kind: 'trial'; expiresAt: number; daysRemaining: number }
  | { kind: 'invalid'; reason: string };

/**
 * Read the current license status. The Rust side
 * auto-generates a 14-day trial on first call (when the
 * keychain is empty), so the returned status is rarely
 * `unactivated` in practice. A real `unactivated` is only
 * seen immediately after `licenseDeactivate()`.
 *
 * The Rust side re-verifies the license signature on
 * every call (the verification is microseconds — an
 * Ed25519 verify is ~50µs on a modern CPU). The TS-side
 * store (`licenseStore.ts`) calls this once on app
 * startup and caches the result for the rest of the
 * session.
 */
export async function licenseGetStatus(): Promise<LicenseStatusPayload> {
  return invoke<LicenseStatusPayload>('license_get_status');
}

/**
 * Activate a license key. The key is sent to the Rust
 * side once (over the IPC bridge), verified, and stored
 * in the OS keychain. On success, the returned
 * `LicenseStatusPayload` reflects the new state. On
 * failure, the returned status is `invalid` with a
 * machine-readable `reason` — the keychain is NOT
 * modified.
 *
 * Returns `Promise<LicenseStatusPayload>` (not throws):
 * a bad key is a normal user error, not an exception.
 * The UI catches the `invalid` variant and shows an
 * alert dialog.
 */
export async function licenseActivate(key: string): Promise<LicenseStatusPayload> {
  return invoke<LicenseStatusPayload>('license_activate', { key });
}

/**
 * Delete the current license from the keychain. The
 * next `licenseGetStatus` call will auto-generate a new
 * 14-day trial. Idempotent (deleting an empty keychain
 * is a no-op).
 *
 * Returns the resulting status, which is `unactivated`
 * on success. Phase 3's "transfer to a new machine" flow
 * is the main use case; Phase 2 just exposes the IPC.
 */
export async function licenseDeactivate(): Promise<LicenseStatusPayload> {
  return invoke<LicenseStatusPayload>('license_deactivate');
}

/**
 * Get this machine's fingerprint (64-character lowercase
 * hex string — a SHA-256 of hostname || username ||
 * mac_address). The activation screen displays this so
 * the user can include it in a "please issue me a
 * license" support email.
 *
 * The fingerprint is non-secret (it's a hash of public
 * system info), so showing it in the UI is fine. It's
 * also stable across reboots on a single machine.
 */
export async function licenseGetMachineFingerprint(): Promise<string> {
  return invoke<string>('license_get_machine_fingerprint');
}
