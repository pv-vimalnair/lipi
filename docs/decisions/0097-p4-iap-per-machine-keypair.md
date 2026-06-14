# ADR 0097 — Use a per-machine Ed25519 keypair for IAP-signed licenses

**Date**: June 2026
**Phase**: 4 (IAP receipt validation)
**Status**: Accepted
**Deciders**: project lead (Vimal Nair)

## Context

Phase 4 replaces the `iap_redeem` stub with a real implementation
that validates receipts against Apple (`verifyReceipt`) and
Microsoft (Store Broker API), then generates a `LicensePayload`
bound to the current machine and saves it to the keychain.

The license is signed with an Ed25519 key. Three options for the
signing key:

1. **Embed the production privkey in the binary** (the same key
   the project lead uses for the `sign_license` CLI). The binary
   can sign any license; the embedded pubkey is the verifier.
   - **Pro**: simple. No new keypair generation logic.
   - **Pro**: licenses are portable across machines (the user
     could email a license to a friend).
   - **Con**: anyone with the binary has the privkey, so anyone
     can forge a license. The whole licensing layer is broken.
   - **Verdict**: unacceptable.

2. **Generate a per-user privkey (stored in the user's account
   settings, e.g. a cloud sync layer)**. The license is signed
   with the user's privkey; the pubkey is fetched from the
   account settings.
   - **Pro**: portable across machines (the user can sign in
     on a new machine and the license follows).
   - **Pro**: the binary doesn't have the privkey.
   - **Con**: requires a backend (we don't have one — Decision
     #17 "no backend, ever"). The whole point of the
     offline-first design is to avoid a backend.
   - **Verdict**: violates Decision #17.

3. **Generate a per-machine Ed25519 keypair on first IAP
   redemption, store the privkey in the OS keychain, store the
   pubkey in the OS keychain**. The license is signed with the
   per-machine privkey; the verifier reads the per-machine
   pubkey from the keychain.
   - **Pro**: the privkey never leaves the machine, so a
     malicious actor with the embedded trial pubkey (or the
     embedded production pubkey) can't forge an IAP-issued
     license.
   - **Pro**: no backend needed.
   - **Pro**: machine-fingerprint binding is enforced by the
     `LicensePayload.sub` field (a per-machine SHA-256), so
     even if the user copies the keychain entry to a different
     machine, the license's `sub` won't match.
   - **Con**: if the user's keychain is wiped (OS reinstall,
     new user account), the IAP-issued license is unverifiable.
     The recovery is to re-run the IAP flow (the user's
     Apple / Microsoft subscription is unchanged, so the
     receipt is still valid). This is acceptable; the
     `MissingLocalPubkey` error reason explicitly tells the
     user to re-run the IAP flow.
   - **Con**: the IAP-issued license is not portable across
     machines. If the user buys a new Mac, they need to
     re-validate the IAP on the new machine. The "Transfer to
     a new machine" flow (Phase 3) handles this: the user
     deactivates on the old machine and re-runs the IAP flow
     on the new machine.
   - **Verdict**: the right balance of security and UX.

## Decision

Use option 3: a per-machine Ed25519 keypair for IAP-signed
licenses. The privkey + pubkey are generated on first IAP
redemption, stored in the OS keychain under
`app.lipi.ide / iap-privkey` + `app.lipi.ide / iap-pubkey`,
and never leave the machine.

The `LicensePayload` is extended with a `kid` (key id) field
that identifies which pubkey to use to verify the signature:

- `kid = "trial"` → use the embedded `TRIAL_PUBKEY` (for
  auto-generated trials; the trial privkey is in the binary
  because trials are not security-sensitive — the worst case
  is a 14-day bypass, not a permanent unlock).
- `kid = "offline"` → use the embedded `PROD_PUBKEY` (for
  `LIP1...` keys from purchase emails; signed by the
  project lead's `sign_license` CLI, which has the prod
  privkey).
- `kid = "iap-local"` → read the per-machine pubkey from
  the keychain.

`verify_license` dispatches on `kid`. For `kid = "iap-local"`,
the per-machine pubkey is read from the keychain
(`iap_keypair::load_iap_pubkey`). If the keychain entry is
missing, the verifier returns
`LicenseError::MissingLocalPubkey` (a new error variant
introduced in Phase 4).

The `iap_redeem` dispatcher generates the per-machine keypair
on the first IAP redemption (via
`iap_keypair::get_or_create_iap_keypair`), uses the privkey
to sign the `LicensePayload`, and saves the license to the
keychain (via `licensing::save_license`).

## Consequences

- **Secure**: the privkey is in the OS keychain (Windows
  DPAPI / macOS Keychain / Linux Secret Service), which
  requires the user's login password to write to. An
  attacker with the user's login password already has the
  user's license.
- **No backend**: the per-machine keypair is local; no
  server round-trip is needed for verification (Decision
  #17 is upheld).
- **Offline-first**: the IAP receipt is validated against
  Apple / Microsoft once (on initial redemption). The
  resulting license is signed with the per-machine key,
  which is verified offline. No re-validation on app
  launch.
- **Machine-bound**: the `LicensePayload.sub` field is the
  machine fingerprint (a SHA-256 of hostname || username ||
  mac_address). Even if the user copies the keychain entry
  to a different machine, the verifier rejects the license.
- **Recoverable from keychain wipe**: if the keychain is
  wiped, the user re-runs the IAP flow. The new privkey is
  generated on the new machine; the old keypair is silently
  abandoned.
- **No cross-machine portability**: IAP-issued licenses
  don't transfer between machines. The user re-validates on
  each machine they want to use. The TransferFlow (Phase 3)
  handles the deactivation + re-activation workflow.
- **Adds a new error variant**: `LicenseError::MissingLocalPubkey`.
  The UI humanizes this via `humanizeInvalidReason` (already
  handles the new reason in Phase 4).

## Alternatives considered

- **Option 1 (embed the prod privkey)**: rejected. Breaks
  the licensing layer (anyone can forge a license).
- **Option 2 (cloud-synced user key)**: rejected. Violates
  Decision #17 (no backend, ever). Also doesn't work
  offline.
- **HSM-backed key (e.g. Apple Secure Enclave, Windows
  TPM)**: not considered for Phase 4. The HSM APIs are
  platform-specific and the project is offline-first. A
  v2 could use the HSM for an additional security layer,
  but the keychain-based approach is sufficient for v1.

## References

- `docs/plans/prod-p4-iap-validation-design.md` — the full
  Phase 4 design.
- `docs/decisions/0017-no-backend-ever.md` — the
  "no backend" decision.
- `src-tauri/src/iap_keypair.rs` — the per-machine keypair
  module.
- `src-tauri/src/licensing.rs` — the `LicensePayload.kid`
  extension + `verify_license` dispatch.
- `src-tauri/src/iap.rs` — the dispatcher that uses the
  per-machine keypair to sign IAP-issued licenses.
