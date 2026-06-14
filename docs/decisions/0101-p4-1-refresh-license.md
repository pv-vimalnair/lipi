# Decision #101 — "Refresh from IAP" Tauri command (additive, manual, kid-gated)

**Date**: June 2026
**Phase**: 4.1 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)
**Status**: Accepted + implemented

## Context

Phase 4 shipped real IAP receipt validation
(Apple App Store `verifyReceipt` + Microsoft
Store Broker API). The flow is:

1. User opens the License activation screen.
2. User clicks "Restore from App Store" (Mac)
   or "Restore from Microsoft Store" (Windows).
3. The JS layer hands the receipt to
   `iap_redeem` (the Rust dispatcher).
4. The Rust side validates the receipt +
   generates a `LicensePayload` bound to the
   current machine + signs it with the
   per-machine IAP keypair + saves it to the
   keychain.

This works for the **first** IAP redemption.
But what about **renewals**?

When the user renews their subscription (e.g.
their monthly plan auto-renews), the App Store
/ Microsoft Store generates a new receipt with
a later `expires_at`. The current `iap_redeem`
flow works for renewals (the user can just
re-run the Restore flow with the new receipt).
But the UX is awkward: the user has to know to
re-run the Restore flow, find the new receipt,
and paste it.

A dedicated "Refresh from IAP" command gives
the user a 1-click way to extend the local
license's `exp` after a renewal.

## Decision

Add a new `iap_refresh_license` Tauri command
that:

1. **Loads the current license** from the
   keychain + verifies its signature.
2. **Checks the `kid` field** — only
   `kid = "iap-local"` licenses are refreshable
   (trial / offline-purchase licenses return
   `iap-refresh-not-applicable`).
3. **Validates the new receipt** (re-uses
   `iap_redeem_inner` for routing + validation).
   The new receipt can be the parsed-response
   JSON (Apple), the raw base64 receipt
   (Apple), or the raw XML receipt (Microsoft).
4. **Compares the new receipt's `exp` to the
   current license's `exp`.** If the new `exp`
   is not later than the current `exp`, return
   `iap-refresh-no-extension` (don't downgrade
   the license).
5. **Builds a new `LicensePayload`** with the
   new `exp`, same `sub` (machine fingerprint),
   same `kid = "iap-local"`, new `iat`, new
   `jti`.
6. **Signs with the same per-machine keypair**
   (the keypair is loaded from the keychain; no
   new keypair is generated).
7. **Saves the license** to the keychain
   (overwrites the existing entry).
8. **Returns the new `Active` status.**

The UI gets:
- A new "Refresh from IAP" button on
  `LicenseCard` (only visible for IAP-issued
  licenses).
- A new `IapRefreshFlow` wizard on the License
  activation screen (3 steps: paste → running
  → result).

The flow is **additive** — the existing
`iap_redeem` flow is unchanged. The existing
"Restore from App Store" / "Restore from
Microsoft Store" flow still works for the
first-time redemption case.

## Why kid-gated (only for IAP-issued licenses)?

The refresh command only makes sense for
IAP-issued licenses. Trial licenses have a
fixed 14-day expiration (no renewal; the
trial is one-shot). Offline-purchase licenses
are issued by the project lead and don't
auto-renew (the user has to email the project
lead for a new key).

IAP-issued licenses are the only case where
the user can self-serve a renewal (the
receipt is paid on the App Store / Microsoft
Store, not via the project lead). So the
refresh command is scoped to IAP-issued
licenses only.

For trial / offline-purchase licenses, the
existing `license_activate` flow (paste a new
key) is the right path. The error reason
`iap-refresh-not-applicable` points the user
to the right alternative.

## Why manual (not auto-refresh on app launch)?

Apple and Microsoft recommend periodic
re-validation of IAP subscriptions to catch
renewals + cancellations. But auto-refresh
would violate the **offline-first principle**
(Decision #17): the app would need to make a
network call on every launch, and a network
failure would be visible to the user.

The decision is to keep the refresh **manual**
(the user clicks the button). This:

- **Respects the offline-first principle.** The
  app doesn't need a network call on every
  launch.
- **Lets the user control the timing.** If
  the user just renewed, they click the button
  to update the license. If they haven't
  renewed, the button is a no-op.
- **Avoids surprising the user.** An
  auto-refresh on launch would silently
  extend the license, which could confuse
  users who are trying to evaluate the
  product (e.g. a free trial user who wants
  to see the "Trial expired" state).

A v1.2 follow-up could add an
**opt-in auto-refresh** (a Settings toggle
that enables periodic re-validation every
24 hours, with a 5-minute timeout and silent
failure on network errors).

## Why "not later" comparison (no downgrades)?

The new receipt's `exp` must be **later**
than the current license's `exp`. We don't
allow downgrades. The reasoning:

- **Renewal** is the primary use case. The
  user renewed their subscription, so the
  new receipt's `exp` should be later.
- **A downgrade would be a bug.** If the new
  receipt's `exp` is earlier than the current
  license's `exp`, either:
  - The user pasted a stale receipt (e.g.
    from a previous renewal that's been
    superseded). The right behavior is to
    reject and ask the user to paste the
    latest receipt.
  - The user is trying to "trick" the
    license into a shorter expiration. The
    right behavior is to reject.
  - There's a clock issue (the user is in a
    timezone where the renewal hasn't
    propagated yet). The right behavior is
    to ask the user to wait and try again.
- **It's easier to reason about.** The
  license's `exp` is monotonically
  non-decreasing over the lifetime of the
  license.

## Why the new `LicensePayload` keeps the same `kid`?

The new `LicensePayload` keeps the same
`kid = "iap-local"` (and the same per-machine
keypair). The reasoning:

- The license is still bound to this machine.
- The license is still IAP-issued.
- The per-machine keypair is the right keypair
  to use to verify the signature (the
  verifier dispatches on `kid` to load the
  per-machine pubkey from the keychain).
- Changing `kid` would require a different
  keypair, which would either:
  - Require a new per-machine keypair
    generation (overwriting the existing
    keypair, which is bound to the old
    license), OR
  - Require embedding the production private
    key (which violates the offline-first
    principle — see Decision #97).

So the new `LicensePayload` keeps
`kid = "iap-local"` and the same per-machine
keypair. The only changes are `iat`, `exp`,
and `jti`.

## Alternatives considered

### A. Auto-refresh on app launch

**Rejected** (for now). Violates the
offline-first principle. Could be added as
a v1.2 opt-in toggle.

### B. Use a new keypair (e.g. a "refresh keypair") for the new license

**Rejected.** Adds complexity without benefit.
The per-machine keypair is the right keypair
for this machine. Using a new keypair would
require the verifier to track multiple
keypairs per machine, which is unnecessary.

### C. Use the production private key for the new license

**Rejected.** Violates the offline-first
principle (would require embedding the
production private key in the binary, which
is a security risk). See Decision #97 for
the rationale.

### D. Allow downgrades

**Rejected.** A downgrade is either a bug or
an attack. The right behavior is to reject
and ask the user to paste a later receipt.

### E. Make the refresh command universal (work for any `kid`)

**Rejected.** Trial / offline-purchase
licenses don't have a "renewal" path that
the user can self-serve. The refresh command
is IAP-specific by design.

## Impact

- **Code:** ~80 lines in `iap.rs` (the new
  `iap_refresh_license` + `iap_refresh_license_inner`
  functions) + ~30 lines in `lib.rs` (expose
  the new command) + ~10 lines in `iap.ts`
  (the `iapRefreshLicense` wrapper) + ~50
  lines in `LicenseCard.tsx` (the new
  button + license_kid state) + ~150 lines
  in `IapRefreshFlow.tsx` + ~80 lines in
  `IapRefreshFlow.module.css`.
- **Tests:** 6 new iap refresh-license Rust
  tests + 7 new `iapRefreshLicense` TS tests
  + 6 new humanizeInvalidReason tests = **19
  new tests** for the new functionality.
- **Docs:** Updated `iap.rs` module docs +
  updated `iap.ts` JSDoc + new
  `IapRefreshFlow.tsx` module docs +
  updated `CHANGELOG.md` + new HANDOFF §9.28.

## References

- `HANDOFF.md §6 "Current phase: Phase 4.1 — IAP v1.1 follow-ups — SHIPPED"`
- `HANDOFF.md §9.28` — the per-phase writeup
- `docs/plans/prod-p4-1-iap-followups-design.md` — the design doc
- `docs/decisions/0097-p4-iap-per-machine-keypair.md` — the IAP keypair decision (why we keep the same keypair)
- `docs/decisions/0099-p4-iap-no-revalidation.md` — the no-auto-revalidation decision (why the refresh is manual)
