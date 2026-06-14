# Decision #93 — Phase 3: ship the IAP `iap_redeem` command as a stub (Phase 4 fills it in)

**Date**: June 2026
**Phase**: 3 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

The Mac App Store and Microsoft Store require apps sold
through them to use the platform's in-app purchase (IAP)
system, NOT a custom payment flow. The IAP flow is:

1. User clicks "Subscribe" in the app.
2. The OS shows a native IAP dialog.
3. The OS hands the app a receipt.
4. The app sends the receipt to the app's server
   (or directly to Apple / Microsoft) for validation.
5. The app converts the validated receipt into a
   local license key (or a server-side entitlement).

Phase 3 is the "subscription UX + offline-purchase
flow" phase. The offline-purchase flow (paste a key
from the project website's email) is the v1 happy path.
The IAP flow is the v2 path, gated by the platform.

The question: do we ship the IAP integration in Phase
3, or stub it for Phase 4?

## Decision

**Stub it.** Phase 3 ships an `iap_redeem` Tauri
command that returns `LicenseStatus::Invalid { reason:
"iap-not-yet-implemented: ..." }` for any input. The
"Restore from App Store" button on the License
activation screen calls this command and shows the
humanized reason to the user.

Phase 4 fills in the real receipt validation
(Apple's `verifyReceipt` endpoint, Microsoft's Store
Broker API) without changing the UI.

## Consequences

- **+** The UI flow is built and tested now (Phase 3).
  When Phase 4 lands, the UI doesn't need to change —
  only the Rust implementation behind the same Tauri
  command signature.
- **+** The stub clearly documents the contract: the
  return type is `LicenseStatus`, the same as the
  other `license_*` commands. Phase 4 has a clear
  spec to implement.
- **+** The user is told "IAP restoration is coming in
  a future update" instead of a silent failure. No
  confusion about "why doesn't this work?".
- **+** The stub lives in `src-tauri/src/iap.rs`,
  which has the same shape as `licensing.rs`
  (commands at the bottom, tests at the bottom).
  Easy to extend in Phase 4.
- **−** Users who try the IAP flow in v1 see "not yet
  implemented" and may think the app is broken.
  Mitigation: the button copy is clear ("Restore from
  App Store — coming soon"), and the "paste a license
  key" path is always available.
- **−** Phase 4 has to wire the real validation,
  which is a non-trivial amount of work
  (Apple's `verifyReceipt` requires a server-side
  call to `https://buy.itunes.apple.com/verifyReceipt`,
  Microsoft's Store Broker API requires a different
  endpoint). The stub lets us defer this work
  cleanly, but it's still on the Phase 4 docket.
- **−** The stub adds 1 new Tauri command to the
  IPC surface. A future phase that removes the
  command (because the real IAP is wired
  elsewhere) would have to update the `iap.ts`
  wrapper AND the UI. Small cost.

## Alternatives considered

- **Ship the real IAP in Phase 3**. Phase 3 is
  already large (gate, badge, banner, transfer,
  paywall, CLI). Adding real IAP would push the
  scope into "Phase 3+ IAP" and slip the timeline.
  Phase 4 is a natural fit because the IAP
  integration is platform-specific (macOS code
  signing + sandbox entitlements, Microsoft Store
  registration) and is a separate concern from
  the user-facing UX.
- **Don't ship the IAP button at all**. Hides the
  future feature from the user, but also hides
  the "Restore from App Store" workflow when
  Phase 4 lands. The "stub now, real later"
  pattern is better because it lets us test the
  UI integration now.
- **Defer to Phase 5 (production release
  pipeline)**. Phase 5 is the
  code-signing / updater / CI-CD phase, which is
  a different concern (release infrastructure
  vs. user-facing IAP). IAP is closer to Phase 4
  (platform integrations) than Phase 5.

## References

- `docs/plans/prod-p3-subscription-ux-design.md`
  — the "IAP receipt adapter (stub)" section.
- `src-tauri/src/iap.rs` — the stub (~150 lines
  + ~80 lines of tests).
- `src/ipc/iap.ts` — the TS wrapper.
- `src/ipc/index.ts` — re-exports `iap`.
- `src-tauri/src/lib.rs` — registers the
  `iap_redeem` command.
