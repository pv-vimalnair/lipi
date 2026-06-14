# ADR 0099 — Don't re-validate IAP subscriptions on app launch (offline-first)

**Date**: June 2026
**Phase**: 4 (IAP receipt validation)
**Status**: Accepted
**Deciders**: project lead (Vimal Nair)

## Context

Apple and Microsoft both recommend that subscription-based
apps periodically re-validate the user's subscription state
(e.g. every 30-60 days). The reasons:

- A user might cancel their subscription, and the app
  should reflect the cancellation (e.g. revoke access at
  the end of the paid period).
- A subscription might lapse due to a failed payment
  (expired credit card), and the app should reflect the
  lapse.
- A user might upgrade or downgrade their subscription
  tier, and the app should reflect the new tier.

The standard implementation is: on app launch (or every 30
days), the app calls the platform's "check subscription
status" API and updates the local license accordingly.

Phase 4 explicitly does *not* implement this. The IAP
receipt is validated *once* (on initial redemption), and
the resulting `LicensePayload` is verified locally on every
app launch. There is no re-validation.

Two options for Phase 4:

1. **Re-validate on every app launch** (or every 30 days).
   The app calls Apple's `verifyReceipt` (with the cached
   receipt) or Microsoft's Store Broker API to check the
   current subscription state.
   - **Pro**: subscription state is always up-to-date.
   - **Con**: requires a network call on every app launch
     (or every 30 days). Violates the offline-first
     principle (Decision #17: "no backend, ever" + the
     broader "the app works without internet" principle).
   - **Con**: the IAP receipt is captured at redemption
     time and stored in the keychain. If the receipt is
     tampered with (e.g. the user edits the keychain
     entry), the re-validation would catch it. But the
     per-machine signing key (Decision #97) means the
     user can't forge a license *anyway* — the only way
     to get a license is to provide a valid receipt.
   - **Con**: Apple and Microsoft both rate-limit the
     `verifyReceipt` / Store Broker APIs. An app that
     re-validates on every launch would hit the rate
     limit quickly.
   - **Verdict**: rejected for Phase 4.

2. **No re-validation**. The IAP receipt is validated
   once (on initial redemption). The resulting
   `LicensePayload` is verified locally on every app
   launch using the per-machine signing key (Decision
   #97).
   - **Pro**: offline-first. The app works without
     internet (the user can work offline indefinitely
     after the initial redemption).
   - **Pro**: no rate-limit concerns. The app doesn't
     make any network call on launch (except for the
     updater health check, which is independent).
   - **Pro**: the per-machine signing key means the
     user can't forge a license even if they edit the
     keychain entry. The verifier rejects the
     signature.
   - **Con**: if the user cancels their subscription,
     the local license remains valid until the
     `exp` timestamp (which is set to Apple's /
     Microsoft's reported expiration date at
     redemption time). For a monthly subscription,
     the user has up to 30 days of access after
     cancellation. For a yearly subscription, up to
     365 days.
   - **Con**: the project lead has no way to remotely
     revoke an IAP-issued license (e.g. for a
     chargeback). The license is bound to the
     machine, so the worst case is "the user has
     access to one machine for the duration of the
     paid period", which is the same as a paid
     license they could have bought.
   - **Verdict**: the right model for the project's
     offline-first design.

## Decision

Use option 2: no re-validation. The IAP receipt is
validated once (on initial redemption), and the resulting
`LicensePayload` is verified locally on every app launch
using the per-machine signing key (Decision #97).

The `LicensePayload.exp` is set to the IAP receipt's
`expires_date_ms` (Apple) or `ExpirationDate` (Microsoft)
at redemption time. When `exp` passes, the local license
transitions to `expired` and the UI shows the LicenseGate.

If the user cancels their subscription early, the local
license remains valid until `exp` (the date Apple /
Microsoft reports as the "paid through" date). This is
acceptable: the user paid for the period, they get the
period. Apple's / Microsoft's cancellation logic is
"the user keeps access until the end of the paid period",
which matches the local license's behavior.

## Consequences

- **Offline-first**: the app works without internet
  (the user can work offline indefinitely after the
  initial redemption). Decision #17 is upheld.
- **No rate-limit concerns**: the app doesn't make any
  network call on launch (except for the updater health
  check, which is independent of the license).
- **Tamper-resistant**: the per-machine signing key
  (Decision #97) means the user can't forge a license.
  The verifier rejects the signature even if the user
  edits the keychain entry.
- **No remote revocation**: the project lead can't
  remotely revoke an IAP-issued license. The license is
  bound to the machine + the paid period. The worst
  case is "the user has access to one machine for the
  duration of the paid period", which is the same as
  a paid license they could have bought.
- **Cancellation latency**: if the user cancels their
  subscription, the local license remains valid until
  `exp`. For a monthly subscription, up to 30 days.
  For a yearly subscription, up to 365 days. This
  matches Apple's / Microsoft's "keep access until
  the end of the paid period" model.
- **Phase 4.1 follow-up** (if needed): a v1.1 update
  could add a "refresh license from IAP" command that
  the user triggers manually (e.g. from the License
  settings card). The command would call Apple's /
  Microsoft's API, get the latest subscription
  state, and update the local license. This is
  opt-in (the user chooses when to spend the network
  round-trip), so it doesn't violate offline-first.
  The project lead would document this in the
  `humanizeInvalidReason` text for the
  "license-expired" reason.

## Alternatives considered

- **Option 1 (re-validate on launch / every 30 days)**:
  rejected. Violates offline-first, hits rate limits,
  and is unnecessary given the per-machine signing
  key.
- **Option 3 (re-validate on app launch + manual
  refresh)**: not considered for Phase 4. The manual
  refresh is a v1.1 follow-up (see above).
- **Background re-validation** (a hidden process that
  re-validates every 30 days while the app is
  running): rejected. Same as option 1, plus a
  privacy concern (the user might not know the app is
  making a network call in the background).

## References

- `docs/plans/prod-p4-iap-validation-design.md` — the
  full Phase 4 design (the "no re-validation" decision
  is in the "What this design does NOT cover"
  section).
- `docs/decisions/0017-no-backend-ever.md` — the
  "no backend, ever" decision (which informs the
  offline-first principle).
- `docs/decisions/0097-p4-iap-per-machine-keypair.md`
  — the per-machine signing key decision (which
  makes re-validation unnecessary for
  tamper-resistance).
- Apple's `verifyReceipt` rate limits:
  https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
  (the docs don't publish exact rate limits, but
  real-world apps report ~1-2 calls per second before
  throttling).
- Microsoft's Store Broker API rate limits:
  https://learn.microsoft.com/en-us/windows/uwp/monetize/in-app-purchases-and-trials
  (similar throttling).
