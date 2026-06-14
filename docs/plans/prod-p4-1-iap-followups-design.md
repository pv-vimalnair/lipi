# Phase 4.1 — IAP v1.1 follow-ups (design)

**Date**: June 2026
**Phase**: 4.1 of the production-readiness roadmap
**Status**: Design (accepted for implementation)
**Supersedes**: items in the "What Phase 4 explicitly does NOT ship" list in `docs/plans/prod-p4-iap-validation-design.md` + HANDOFF §9.27
**Deciders**: project lead (Vimal Nair)

## Goal

Fill in the v1.1 follow-up items that Phase 4 explicitly deferred:

1. **Apple raw-receipt path** — currently the JS layer POSTs
   the base64 receipt to Apple and hands the JSON response
   to the Rust side. Phase 4.1 adds a path where the JS
   layer hands the base64 receipt to the Rust side, which
   POSTs to Apple directly.
2. **Microsoft OAuth client-credentials flow** — currently
   the Microsoft bearer token is read from the
   `LIPI_MS_IAP_BEARER_TOKEN` env var (static). Phase 4.1
   implements a real OAuth client-credentials flow (token
   exchange + refresh) with an in-memory cache.
3. **"Refresh license from IAP" command** — a new Tauri
   command that lets the user manually re-validate their
   IAP receipt and extend the local license's `exp` (e.g.
   after renewing their subscription).
4. **TransferFlow IAP redirect** — when the user tries to
   transfer an IAP-issued license, redirect them to the
   offline-purchase path (IAP licenses are bound to a
   single machine, but the IAP receipt was paid on the
   old machine's Apple ID, so the new machine can't
   re-validate via IAP).

## Non-goals (Phase 4.1 explicitly does not do)

- **Family-sharing / volume-purchase validation.** A real
  IAP receipt proves *someone* paid, not that *this
  user* paid. Phase 4.1 trusts the receipt; this is a
  v1.2 follow-up.
- **Google Play receipt validation.** Google Play is a
  mobile-only store; Phase 4.1 is desktop-only. The
  receipt-format dispatcher is extensible to Google
  Play (just add a new `ReceiptRoute::GooglePlay`
  variant + a new validator module), but the
  implementation is a future phase.
- **IAP upgrade / downgrade flows.** Apple's IAP
  supports this via subscription groups; Phase 4.1
  doesn't differentiate.
- **IAP-to-machine transfer via re-activation.** The
  IAP-issued license is bound to the machine that
  received the original receipt. If the user buys a
  new Mac, they need to cancel on the old machine
  and re-subscribe on the new one. Phase 4.1's
  TransferFlow redirect informs the user of this
  limitation.

## What this phase builds

### 1. Apple raw-receipt path (4.1b)

The Phase 4 `verify_apple_receipt` function is
already implemented (and was marked
`#[allow(dead_code)]` because Phase 4 ships the
parsed-response path). Phase 4.1:

- Removes the `#[allow(dead_code)]` on
  `verify_apple_receipt`.
- Updates the `iap_redeem` dispatcher to detect a
  raw base64 receipt (vs a JSON response): if the
  receipt doesn't start with `{` or `<` (the
  current JSON/XML markers), and looks like a
  base64 string (length > 100, only `A-Za-z0-9+/=`
  characters), treat it as a raw Apple receipt and
  call `verify_apple_receipt`.
- The JS layer's existing "Restore from App Store"
  flow can now pass either the raw base64 receipt
  (from the `AppStore` API on macOS) or the JSON
  response (from a prior Apple `verifyReceipt`
  call). The dispatcher routes to the right
  entry point.
- A new `ReceiptRoute::AppleRaw` variant is added
  to the `ReceiptRoute` enum to represent the
  raw-receipt case (vs the existing
  `ReceiptRoute::Apple` for the parsed-response
  case).

### 2. Microsoft OAuth client-credentials flow (4.1c)

The Phase 4 `verify_microsoft_receipt` function
uses a static bearer token from the
`LIPI_MS_IAP_BEARER_TOKEN` env var. Phase 4.1:

- Adds a new `iap_oauth.rs` module that implements
  the OAuth 2.0 client-credentials flow:
  - Reads `client_id`, `client_secret`, and
    `tenant_id` from the `LIPI_MS_IAP_CLIENT_ID` +
    `LIPI_MS_IAP_CLIENT_SECRET` +
    `LIPI_MS_IAP_TENANT_ID` env vars (already
    defined in Phase 4; just need to actually use
    them).
  - Exchanges them for an access token at
    `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`
    with `grant_type=client_credentials` and
    `scope=https://api.store.microsoft.com/.default`.
  - Caches the access token in memory with a
    TTL of 55 minutes (Microsoft's access tokens
    have a 60-minute lifetime; 5 minutes of
    safety margin).
  - On token expiry, transparently refreshes
    (the next `verify_microsoft_receipt` call
    gets a fresh token).
- The `verify_microsoft_receipt` function uses
  the cached token (or refreshes if expired).
- The static `LIPI_MS_IAP_BEARER_TOKEN` env var
  is **removed** in Phase 4.1. The OAuth flow
  is the only supported path. This is a breaking
  change for the existing CI builds that set
  the static token; the CI must be updated to
  set the 3 OAuth env vars instead.

### 3. "Refresh license from IAP" command (4.1d)

A new Tauri command `iap_refresh_license` that
lets the user manually re-validate their IAP
receipt and extend the local license's `exp`
(e.g. after renewing their subscription):

- Reads the current license from the keychain.
- If the license is `kid = "trial"` or
  `kid = "offline"`, return an error
  (`iap-refresh-not-applicable: the current
  license is not IAP-issued; use the
  existing license activation flow instead`).
- If the license is `kid = "iap-local"`, prompt
  the user for a fresh receipt (via the same
  "Restore from App Store" / "Restore from
  Microsoft Store" UI flow).
- Validate the fresh receipt (re-using
  `iap_apple::validate_apple_response` or
  `iap_microsoft::validate_microsoft_response`).
- If the new receipt's `exp` is later than the
  current license's `exp`, update the license
  (sign with the same per-machine keypair;
  the `kid` stays `"iap-local"`).
- If the new receipt's `exp` is earlier or equal,
  return an error
  (`iap-refresh-no-extension: the new receipt's
  expiration is not later than the current
  license's expiration; the license was not
  updated`).
- Return the updated `LicenseStatus::Active { ... }`.

The UI gets a new "Refresh from IAP" button on
the `LicenseCard` component (in the Settings
screen). The button is only visible for
IAP-issued licenses (the `useLicenseStore` reads
the license from the keychain; the Rust side
returns the `kid` in the active status; the
UI conditionally renders the button based on
`kid === "iap-local"`).

The command is `async` (it makes HTTP calls to
Apple / Microsoft). The UI shows a spinner
while the command is in flight.

### 4. TransferFlow IAP redirect (4.1e)

The Phase 3 `TransferFlow` wizard generates an
email body asking the project lead to re-issue
the license. For IAP-issued licenses, this
doesn't work (the user can't re-activate on the
new machine via IAP — the receipt was paid on
the old machine's Apple ID, and the new
machine's Apple ID is different).

Phase 4.1:

- The `useLicenseStore` reads the `kid` from the
  active status.
- The `TransferFlow` Step 1 (the "deactivate on
  this machine" confirmation) checks the `kid`:
  - For `kid = "trial"` or `kid = "offline"`,
    show the existing email body (asking the
    project lead to re-issue on the new machine).
  - For `kid = "iap-local"`, show a different
    message: "IAP licenses are bound to a single
    machine. To use Lipi on a new machine, please
    cancel your IAP subscription on this machine
    (the subscription will remain active until the
    end of the paid period), then subscribe again
    on the new machine. Your local license on this
    machine will remain valid until the end of the
    paid period."
- The email-generation step is skipped for
  IAP licenses (no email to send).

The UI changes are minimal: one branch in
`TransferFlow.tsx` (the message body) + one
branch in the email-generation helper.

### 5. Tests

- Apple raw-receipt dispatcher path: 5 new tests
  in `iap.rs::tests` (dispatch_receipt_routes_base64_to_apple_raw,
  dispatch_receipt_routes_apple_raw_with_empty_string,
  iap_redeem_with_apple_raw_receipt_routes_to_verify_apple_receipt,
  etc.).
- Microsoft OAuth flow: 10 new tests in
  `iap_oauth.rs::tests` (parse_token_response,
  is_token_expired, refresh_if_needed, etc.).
- Refresh license command: 5 new tests in
  `iap.rs::tests` (iap_refresh_license_with_trial_license_returns_error,
  iap_refresh_license_with_offline_license_returns_error,
  iap_refresh_license_with_iap_license_and_fresh_receipt_extends_exp,
  iap_refresh_license_with_iap_license_and_stale_receipt_returns_error,
  etc.).
- TransferFlow IAP redirect: 3 new tests in
  `TransferFlow.test.tsx` (TransferFlow_for_iap_license_shows_redirect_message,
  TransferFlow_for_iap_license_skips_email_generation,
  TransferFlow_for_trial_license_shows_existing_email_body).

Total: **~23 new tests** (~18 Rust + 5 TS). The
full vitest suite + the full cargo test suite
should pass.

## Architecture overview

```
   User (Mac / Windows / Linux)              Apple / Microsoft
   ────────────────────────────              ───────────────
   User clicks "Refresh from IAP"
        │
        ▼
   JS calls iap_refresh_license(receipt, plan)
        │
        ▼
   Rust iap_refresh_license (the new command)
        │
        ├──► Read current license from keychain
        │        │
        │        ▼
        │    Check `kid`:
        │        │
        │        ├── trial / offline → error
        │        │   (iap-refresh-not-applicable)
        │        │
        │        └── iap-local → continue
        │
        ├──► Validate fresh receipt (Apple or Microsoft)
        │        │
        │        ├── Apple: validate_apple_response
        │        │
        │        └── Microsoft:
        │             ms_oauth::get_access_token()
        │                  │
        │                  ▼
        │             check in-memory cache
        │                  │
        │                  ├── fresh (TTL > 5min) → use
        │                  │
        │                  └── expired → exchange new
        │                       │
        │                       ▼
        │             POST to
        │             https://login.microsoftonline.com/
        │             {tenant}/oauth2/v2.0/token
        │             (client_credentials)
        │                  │
        │                  ▼
        │             receive access_token + expires_in
        │                  │
        │                  ▼
        │             cache for 55 minutes
        │                  │
        │                  ▼
        │             validate_microsoft_response
        │
        ├──► Compare new exp vs current exp
        │        │
        │        ├── new exp > current exp → continue
        │        │
        │        └── new exp <= current exp → error
        │            (iap-refresh-no-extension)
        │
        ├──► Update LicensePayload:
        │     new iat = now, new exp = new exp,
        │     same sub (machine fingerprint),
        │     same kid = "iap-local"
        │
        ├──► Sign with same per-machine keypair
        │
        ├──► save_license (overwrites)
        │
        └──► return Active { plan, expires_at, ... }
                                                          │
                                                          ▼
                                                  License settings card
                                                  shows the new status
```

The new command is additive (no changes to the
existing `iap_redeem` flow). The UI gets a new
"Refresh from IAP" button on the LicenseCard.

## Data model

No new data model fields. The existing
`LicensePayload` + `kid` field are reused. The
`iap_refresh_license` command reads the current
license, builds a new `LicensePayload` with
`iat = now` + `exp = new_exp` + `kid = "iap-local"`,
and saves it.

The MS OAuth module holds an in-memory cache:
`Mutex<Option<CachedToken>>` where
`CachedToken { access_token: String, expires_at_unix: i64 }`.
The cache is process-local (one token per Lipi
process).

## File layout

New files:

```
src-tauri/src/iap_oauth.rs           # Microsoft OAuth client-credentials flow
src-tauri/src/iap_oauth.test.rs      # (inline tests in iap_oauth.rs)
```

Modified files:

```
src-tauri/src/iap.rs                 # Add AppleRaw route + refresh command
src-tauri/src/iap_microsoft.rs       # Use iap_oauth::get_access_token
src-tauri/src/iap_apple.rs           # Remove #[allow(dead_code)] on verify_apple_receipt
src-tauri/src/lib.rs                 # Register iap_oauth + iap_refresh_license
src/ipc/iap.ts                       # Add iapRefreshLicense + updated JSDoc
src/ipc/iap.test.ts                  # Add tests for the new command
src/screens/SettingsProvider/components/LicenseCard.tsx
                                     # Add "Refresh from IAP" button
src/screens/SettingsProvider/components/LicenseCard.test.ts
                                     # Add tests for the button visibility
src/screens/License/TransferFlow.tsx # Add IAP-license redirect branch
src/screens/License/TransferFlow.test.tsx (if exists)
                                     # Add tests for the redirect
CHANGELOG.md                         # New "Added (Phase 4.1 — IAP v1.1 follow-ups)" section
HANDOFF.md                           # §6 "Current phase" + §9.28
docs/decisions/0100-p4-1-ms-oauth.md
docs/decisions/0101-p4-1-refresh-license.md
```

## Test plan

### Rust unit tests (`src-tauri/src/iap_oauth.rs`)

1. `parse_token_response_extracts_access_token_and_expires_in`.
2. `parse_token_response_rejects_missing_access_token`.
3. `parse_token_response_rejects_missing_expires_in`.
4. `parse_token_response_rejects_non_json_body`.
5. `is_token_expired_returns_true_for_none`.
6. `is_token_expired_returns_true_for_past_timestamp`.
7. `is_token_expired_returns_false_for_fresh_token`.
8. `get_access_token_uses_cached_token_when_fresh`.
9. `get_access_token_refreshes_when_cached_token_is_expired`.
10. `get_access_token_uses_static_token_fallback_when_oauth_env_vars_unset`.

### Rust unit tests (`src-tauri/src/iap.rs`)

11. `dispatch_receipt_routes_base64_to_apple_raw`.
12. `dispatch_receipt_routes_apple_raw_with_empty_string`.
13. `dispatch_receipt_routes_apple_raw_with_short_string`.
14. `iap_redeem_with_apple_raw_receipt_routes_to_verify_apple_receipt`.
15. `iap_redeem_with_apple_raw_receipt_falls_back_to_json_path_if_response_parses`.
16. `iap_refresh_license_with_trial_license_returns_not_applicable_error`.
17. `iap_refresh_license_with_offline_license_returns_not_applicable_error`.
18. `iap_refresh_license_with_iap_license_and_fresh_receipt_extends_exp`.
19. `iap_refresh_license_with_iap_license_and_stale_receipt_returns_no_extension_error`.
20. `iap_refresh_license_with_missing_license_returns_error`.

### TS unit tests (`src/ipc/iap.test.ts`)

21. `iap_refresh_license_invokes_the_iap_refresh_license_tauri_command`.
22. `iap_refresh_license_propagates_invalid_status_for_not_applicable_error`.

### TS unit tests (`src/screens/SettingsProvider/components/LicenseCard.test.ts`)

23. `LicenseCard_for_iap_license_shows_refresh_button`.
24. `LicenseCard_for_trial_license_does_not_show_refresh_button`.
25. `LicenseCard_for_offline_license_does_not_show_refresh_button`.

### TS unit tests (`src/screens/License/TransferFlow.test.tsx`)

26. `TransferFlow_for_iap_license_shows_redirect_message`.
27. `TransferFlow_for_iap_license_skips_email_generation`.
28. `TransferFlow_for_trial_license_shows_existing_email_body`.

Total: **~28 new tests** (~20 Rust + 8 TS).

## Open questions / future work

1. **Should the IAP refresh command be auto-triggered
   periodically (e.g. on app launch if the license is
   < 7 days from exp)?** Apple and Microsoft recommend
   periodic re-validation. Phase 4.1 keeps it manual
   (the user clicks the button). Auto-refresh is a
   v1.2 follow-up.
2. **Should the OAuth flow use a system browser for
   interactive auth (Authorization Code flow)?** No —
   the Microsoft Store Broker API uses the
   client-credentials flow (no user interaction
   needed). The app's Azure AD app registration has
   the right `api://` scope for the Broker API.
3. **What if the user's Azure AD app registration
   expires / is rotated?** The CI secrets need to be
   updated. The `LIPI_MS_IAP_CLIENT_ID` /
   `LIPI_MS_IAP_CLIENT_SECRET` /
   `LIPI_MS_IAP_TENANT_ID` env vars are the rotation
   surface. A v1.2 follow-up could add a "test
   connection" button in the Settings card to verify
   the Azure AD credentials.
4. **What if the IAP receipt's product ID changes
   (e.g. user upgrades from monthly to yearly)?** The
   refresh command updates the `plan` field in the
   new `LicensePayload`. The UI shows the new plan.
5. **What about the "dual-machine" case where the
   user has Lipi installed on two machines (e.g. a
   laptop and a desktop)?** Each machine has its own
   per-machine keypair. The user re-validates the
   IAP receipt on each machine (a v1.1 UI
   improvement: store the receipt in the keychain
   and re-use it on each machine without prompting).
   A v1.2 follow-up.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| The Microsoft OAuth env vars are not set in the CI | Medium | High | The `iap_oauth::get_access_token` function falls back to the static `LIPI_MS_IAP_BEARER_TOKEN` env var if the OAuth env vars are unset (with a `iap-oauth-env-vars-missing` warning). The CI is updated to set the OAuth env vars instead of the static token. |
| The Apple raw-receipt path makes a network call from the Rust side, which could hang | Low | Medium | The 5-second timeout on `reqwest::Client` is reused from Phase 4. The dispatcher returns `iap-network-error` on timeout. |
| The refresh command upgrades a license without the user's explicit consent | Low | High | The UI shows a confirmation dialog before calling `iap_refresh_license`. The dialog displays the current `exp` + the new `exp` so the user can see the difference. |
| The TransferFlow redirect message is too long / confusing | Low | Low | The message is 2 short sentences. The UI shows it in a Modal with a "Got it" button. |
| The Microsoft OAuth token cache is process-local (lost on app restart) | High | Low | The token is regenerated on the first `verify_microsoft_receipt` call after app restart. The OAuth exchange takes < 500ms, so the latency is acceptable. |
| The `kid` field is exposed in the `LicenseStatus::Active` payload, but the TS side doesn't currently read it | Low | Low | The Phase 4.1 UI additions read `kid` from the active status. If `kid` is missing (old v0.0.x licenses), the UI defaults to "show the email body" (backward-compat). |

The risks are bounded. The implementation is
straightforward (one new module, one new command,
two UI branches).

## What this design does NOT cover

- **Auto-refresh on app launch.** The refresh
  command is manual (the user clicks the button).
  Auto-refresh is a v1.2 follow-up.
- **Google Play / iOS IAP.** Mobile is a separate
  distribution channel with its own store
  integration. The receipt-format dispatcher is
  extensible; a v1.2 adds the Google Play validator.
- **Family-sharing / volume-purchase validation.**
  Phase 4.1 trusts the receipt; a v1.2 follow-up
  could add validation against Apple / Microsoft's
  family-sharing APIs.
- **IAP upgrade / downgrade flows.** Apple supports
  this via subscription groups; Phase 4.1
  doesn't differentiate. A v1.2 follow-up.
- **IAP receipt storage in the keychain.** Currently
  the receipt is captured from the OS on demand
  (the user re-captures for refresh). A v1.2
  follow-up could store the receipt in the keychain
  to make refresh a 1-click operation.
- **Multi-machine IAP sharing.** The IAP-issued
  license is bound to a single machine. Multi-machine
  sharing is a v1.2 follow-up (requires a backend
  for receipt de-duplication, which violates
  Decision #17).

## References

- `HANDOFF.md §6 "Current phase: Phase 4.1 — IAP v1.1 follow-ups — SHIPPED"` (post-Phase-4.1)
- `HANDOFF.md §9.28` — the per-phase writeup
- `docs/plans/prod-p4-iap-validation-design.md` —
  the Phase 4 design (Phase 4.1 fills in the
  deferred items)
- `docs/decisions/0100-p4-1-ms-oauth.md` —
  the Microsoft OAuth decision
- `docs/decisions/0101-p4-1-refresh-license.md` —
  the refresh-license command decision
- Microsoft's OAuth 2.0 client-credentials flow:
  https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow

---

*This is a design doc. Implementation will follow in*
*Phase 4.1b of the production-readiness todo list.*
