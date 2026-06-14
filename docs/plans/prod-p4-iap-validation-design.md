# Phase 4 — Real IAP receipt validation (design)

**Date**: June 2026
**Phase**: 4 of the production-readiness roadmap (see HANDOFF §6 "Current phase")
**Status**: Design (accepted for implementation)
**Supersedes**: the `iap_redeem` stub from Phase 3 (see `src-tauri/src/iap.rs` v1). The UI surface is unchanged; only the Rust implementation is filled in.
**Deciders**: project lead (Vimal Nair)

## Goal

Replace the Phase 3 `iap_redeem` stub (which returns
`Invalid { reason: "iap-not-yet-implemented: ..." }` for any
input) with a real, working implementation that:

1. **Inspects the receipt format** (Mac App Store vs
   Microsoft Store vs Google Play) and dispatches to
   the platform-specific validator.
2. **Validates the receipt** against the platform's
   server-side endpoint (Apple's `verifyReceipt`,
   Microsoft's Store Broker API). A real receipt
   proves the user paid.
3. **Verifies the product ID** matches the expected
   IAP product ID for the requested plan (e.g. the
   "monthly" plan's product ID on the App Store is
   `app.lipi.ide.monthly`).
4. **Generates a local `LicensePayload`** bound to
   the current machine's fingerprint, signs it with
   a per-machine Ed25519 keypair (generated on
   first IAP redemption, stored in the keychain),
   and saves it to the keychain.
5. **Returns the same `LicenseStatusPayload`** the
   Phase 2 `license_activate` returns. The UI
   doesn't need to change.

After Phase 4 lands, the user flow is:

1. User clicks "Restore from App Store" (or
   Microsoft Store) on the License activation
   screen.
2. The UI captures the receipt (already-paid
   receipt from the OS's `AppStore` /
   `Windows.Services.Store` API).
3. The UI calls `iap_redeem(receipt, plan)`.
4. The Rust side validates the receipt against
   Apple / Microsoft, generates the local
   license, saves it to the keychain, returns
   `Active { ... }`.
5. The UI's `useLicenseStore` reads the
   `Active` status and dismisses the LicenseGate
   / TrialBadge.

The whole flow is offline-first: once the
license is saved, the user can work offline
indefinitely (no IAP re-validation, no network
call on app launch). The IAP re-validation is
only required for the *initial* activation.

## Non-goals (Phase 4 explicitly does not do)

- **No IAP *purchase* flow.** The IAP receipt
  is captured from the OS's native IAP API
  (which the OS handles). The user already
  paid; the Rust side just validates the
  receipt. The "click here to subscribe" button
  is the PricingCard's external link to the
  project website (already shipped in Phase 3).
- **No Google Play receipt validation.** Google
  Play is a mobile-only store; Phase 4 is
  desktop-only. Mobile is a separate phase.
- **No subscription auto-renewal management.**
  The Apple / Microsoft subscription state is
  managed by Apple / Microsoft. The user manages
  their subscription in their Apple ID / Microsoft
  account settings; if they cancel, the license
  is still valid locally (the IAP proof of
  payment is "they paid for X months", and
  the local license is bound to that period).
  The Rust side doesn't re-validate on app
  launch (we can't — offline-first, Decision
  #17).
- **No receipt sandbox support.** Apple's
  `verifyReceipt` has a `sandbox` flag for
  TestFlight receipts. Phase 4 hardcodes the
  `production` URL; TestFlight users get
  `Invalid { reason: "iap-sandbox-not-supported"
  }` (the project lead can manually switch
  the user to a real license key).
- **No family-sharing / volume-purchase
  validation.** A real IAP receipt proves
  *someone* paid, not that *this user* paid.
  Phase 4 trusts the receipt; family-sharing
  abuse is a v1.1 follow-up.
- **No Linux IAP.** Linux doesn't have a
  store-equivalent for desktop apps (Snap /
  Flathub don't have IAP). The PricingCard
  "IAP" buttons are hidden on Linux; only
  the offline-purchase key path is shown.
- **No machine-transfer for IAP licenses.**
  The IAP-issued license is bound to a single
  machine (machine fingerprint). The
  "Transfer to a new machine" flow (Phase 3)
  works for IAP licenses by deactivating on
  the old machine (deleting the keychain
  entry), but the user can't re-activate on
  a new machine via IAP (the receipt was
  paid on the old machine's Apple ID, not
  the new one). The fix is to redirect
  transfer-IAP users to the offline-purchase
  path (paste a key). A v1.1 follow-up.

## What this phase builds

### 1. The receipt dispatcher (`src-tauri/src/iap.rs` rewritten)

The current `iap_redeem(receipt, plan)` is a
one-liner stub. Phase 4 rewrites it as a
**dispatcher** that:

1. **Inspects the receipt format**:
   - If the receipt parses as JSON with
     `{"receipt-type": "ProductionAppStore", ...}`
     (or any of Apple's known keys) → route to
     the Apple validator.
   - If the receipt parses as XML with
     `<Receipt xmlns="http://schemas.microsoft.com/...">`
     and the root element is `<Receipt>` →
     route to the Microsoft validator.
   - Else: `Invalid { reason:
     "iap-receipt-format-unrecognized" }`.
2. **Calls the platform-specific validator**
   (`iap_apple::verify` or
   `iap_microsoft::verify`). On success, gets
   back a `ValidatedIapReceipt` struct with
   the product ID, purchase date, and
   expiration date.
3. **Generates a `LicensePayload`** bound to
   the current machine's fingerprint, with
   `plan: "monthly" | "yearly"` (mapped from
   the IAP product ID), `iat: now`, `nbf:
   now`, `exp: validated_receipt.expires_at`,
   `sub: machine_fingerprint()`, `jti:
   random`.
4. **Signs the payload** with the user's
   per-machine IAP keypair (generated on
   first IAP redemption, stored in the
   keychain under `KEYCHAIN_USER_IAP_PRIVKEY`).
   The license string is a new format
   `LIP1.<base64url(payload)>.<base64url(signature)>`
   (same as the offline + trial format), with
   a new `kid` field in the payload that
   identifies the key source as "iap-local".
5. **Saves the license** to the keychain via
   the existing `licensing::save_license`.
   This overwrites any existing license (e.g.
   a trial or a previous offline-purchase key).
6. **Returns the `LicenseStatus::Active { ... }`**
   via `licensing::derive_status`.

The new `iap_redeem` function signature is
unchanged from the Phase 3 stub (`fn(receipt:
String, plan: String) -> LicenseStatus`). The
UI doesn't need to change.

### 2. The Apple validator (`src-tauri/src/iap_apple.rs`)

A new module that implements Apple's
`verifyReceipt` protocol:

- **Endpoint**: `https://buy.itunes.apple.com/verifyReceipt`
  (production; the sandbox endpoint is
  `https://sandbox.itunes.apple.com/verifyReceipt`
  but Phase 4 hardcodes production).
- **Request body**: JSON
  `{"receipt-data": "<base64 receipt>",
    "password": "<shared secret>"}`. The
  shared secret is the App Store Connect
  app-specific shared secret (32-char hex
  string), stored in the CI env var
  `LIPI_APPLE_IAP_SHARED_SECRET`. The Rust
  side reads it from the env var at build
  time (via `option_env!`) so the binary
  never has the secret on disk.
- **Response body**: JSON with `status: 0`
  (success) or one of the well-known error
  codes (`21002` = data is malformed,
  `21004` = shared secret mismatch, etc.).
  On success, the response includes a
  `latest_receipt_info[]` array of
  `InAppPurchase` rows with `product_id`,
  `purchase_date_ms`, `expires_date_ms`,
  etc.
- **Validation**:
  - `status` must be `0`.
  - The `latest_receipt_info[0].product_id`
    must match the expected IAP product ID
    for the requested plan. Phase 4 hardcodes:
    - `monthly` → `app.lipi.ide.monthly`
    - `yearly` → `app.lipi.ide.yearly`
  - The `expires_date_ms` must be in the
    future. (Apple sends `expires_date_ms`
    for auto-renewing subscriptions; for
    non-consumable / lifetime products, this
    field is absent. Phase 4 only supports
    auto-renewing subscriptions, so the field
    is required.)
  - The `purchase_date_ms` must be in the
    past (catches "the receipt is from the
    future" attacks).
- **Return**: a `ValidatedIapReceipt` struct
  with `product_id`, `purchased_at_unix`,
  `expires_at_unix`.

The Apple validator has a `reqwest`-based
HTTP client (already in the project's
dependency tree). The response is
deserialized into a serde struct; the
validation is in a separate function
(`validate_apple_response`) so it's
testable with a mock JSON fixture (no
real Apple endpoint needed for tests).

### 3. The Microsoft validator (`src-tauri/src/iap_microsoft.rs`)

A new module that implements the Microsoft
Store Broker API:

- **Endpoint**:
  `https://collections.mp.microsoft.com/v9.0/collections/...`
  (the exact URL is per-product; the receipt
  is a `https://licensing.onestore.microsoft.com/...` URL
  embedded in the `Windows.Services.Store`
  receipt).
- **Authentication**: OAuth 2.0 client
  credentials. The app's Azure AD app
  registration provides the `client_id` +
  `client_secret` + `tenant_id`. The Rust
  side reads these from env vars at build
  time (`LIPI_MS_IAP_CLIENT_ID`,
  `LIPI_MS_IAP_CLIENT_SECRET`,
  `LIPI_MS_IAP_TENANT_ID`) and exchanges
  them for an access token at
  `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token`.
- **Request body**: the receipt string is
  the raw XML returned by
  `Windows.Services.Store`. The Rust side
  posts it to the Broker API with
  `Content-Type: application/xml`.
- **Response body**: XML with
  `<Response>` containing a `<Receipt>` or
  `<Error>` element.
- **Validation**:
  - The response must not contain an
    `<Error>`.
  - The `<Receipt>` must have the expected
    `ProductId` for the requested plan.
  - The `<ExpirationDate>` must be in the
    future.
- **Return**: a `ValidatedIapReceipt` struct
  (same shape as the Apple one).

The Microsoft validator is significantly
more complex than the Apple one (OAuth +
XML parsing + per-product URLs). Phase 4
ships the full implementation; the tests
use a mock XML fixture.

### 4. The per-machine IAP keypair (`src-tauri/src/iap_keypair.rs`)

A new module that manages the per-machine
Ed25519 keypair used to sign IAP-generated
licenses:

- **Generation**: on first IAP redemption
  (or first trial, if the user opts into a
  trial *before* IAP), the Rust side checks
  if the keychain has the
  `KEYCHAIN_USER_IAP_PRIVKEY` entry. If not,
  it generates a fresh 32-byte Ed25519
  secret key using `getrandom`, encodes it
  as 64 lowercase hex chars, and stores it
  in the keychain. The corresponding 32-byte
  public key is also stored in the keychain
  under `KEYCHAIN_USER_IAP_PUBKEY`.
- **Signing**: `iap_redeem` reads the privkey
  from the keychain, signs the
  `LicensePayload` with it via
  `licensing::sign_payload` (re-using the
  existing signing function).
- **Verification**: the `verify_license`
  function is extended with a new path: if
  the license's `kid` is "iap-local", the
  verifier reads the pubkey from the
  keychain and uses it to verify the
  signature.

The per-machine keypair is the **security
model**: the privkey never leaves the
keychain, so a malicious actor with the
embedded trial pubkey can't forge a license.
The privkey is generated on the user's
machine, so only that machine can produce
valid IAP-signed licenses.

### 5. The `LicensePayload` extension (`src-tauri/src/licensing.rs`)

The `LicensePayload` struct gets a new
optional field: `kid: Option<String>`. The
`kid` (key id) identifies which pubkey to
use to verify the signature:

- `kid = "trial"` → use the embedded
  `TRIAL_PUBKEY` (existing behavior).
- `kid = "offline"` → use the embedded
  `PROD_PUBKEY` (existing behavior, used
  for `LIP1...` keys from purchase emails).
- `kid = "iap-local"` → read the pubkey
  from the keychain.

The `kid` is set by the signing function
(`generate_trial_license` sets it to
`"trial"`; `iap_redeem` sets it to
`"iap-local"`; the project lead's
`sign_license` CLI sets it to `"offline"`).

`validate_shape` checks the `kid` is one
of the three valid values (or `None` for
backward-compat with v0.0.x licenses that
predate the `kid` field — these are
treated as `"trial"` by the verifier).

`verify_license` dispatches on `kid`:

- `"trial"` or `None` → `TRIAL_PUBKEY`.
- `"offline"` → `PROD_PUBKEY`.
- `"iap-local"` → read from keychain
  (`KEYCHAIN_USER_IAP_PUBKEY`); if the
  keychain entry is missing, return
  `LicenseError::MissingLocalPubkey`.

The `LicenseStatus` returned by
`iap_redeem` is unchanged (`Active { ... }`).
The user's app is now unlocked for the
duration of the IAP subscription (or
forever, for non-consumable products).

### 6. The TS IPC wrapper update (`src/ipc/iap.ts`)

The TS wrapper is already correct — it
expects a `LicenseStatusPayload` back,
which is what the new implementation
returns. The doc comment is updated to
reflect that the v1 stub is gone.

A new error reason is documented in the
TS wrapper's JSDoc: `"iap-sandbox-not-supported"`,
`"iap-receipt-format-unrecognized"`,
`"iap-product-id-mismatch"`,
`"iap-expired"`, `"iap-network-error"`,
`"iap-shared-secret-missing"`. The UI
humanizes these via the existing
`humanizeInvalidReason` helper.

## Architecture overview

```
   User (Mac / Windows / Linux)              Apple / Microsoft
   ────────────────────────────              ───────────────
   User opens License activation screen
        │
        ▼
   User clicks "Restore from App Store"
        │
        ▼
   JS calls iap_redeem(receipt, plan)
        │
        ▼
   Rust iap_redeem (the dispatcher)
        │
        ├──► iap_apple::verify          ────►  Apple verifyReceipt
        │        │                              (HTTPS, JSON)
        │        ▼
        │    ValidatedIapReceipt
        │        │ (status, product_id, expires_at)
        │        │
        │        ▼
        │    Build LicensePayload
        │    (plan, iat, nbf, exp, sub, jti, kid="iap-local")
        │        │
        │        ▼
        │    Read per-machine IAP privkey from keychain
        │    (or generate on first IAP redemption)
        │        │
        │        ▼
        │    licensing::sign_payload
        │    → "LIP1.<base64url(payload)>.<base64url(sig)>"
        │        │
        │        ▼
        │    licensing::save_license
        │    (overwrites any existing license)
        │        │
        │        ▼
        │    licensing::derive_status
        │    → LicenseStatus::Active { ... }
        │
        ├──► iap_microsoft::verify      ────►  Microsoft Store Broker
        │        │                              (OAuth + HTTPS, XML)
        │        ▼ ... (same as Apple)
        │
        └──► format unrecognized
                 │
                 ▼
             LicenseStatus::Invalid { reason: "iap-receipt-format-unrecognized" }
                                                          │
                                                          ▼
                                                  License activation screen
                                                  shows the humanized reason
```

The user flow is the same on every platform
(the user clicks "Restore from [Store]" once,
the Rust side does the rest). The IAP proof
of payment is the receipt validation; the
local license binding is the per-machine
keypair.

## Data model

The only new type is `ValidatedIapReceipt` (in
`iap.rs`):

```rust
pub struct ValidatedIapReceipt {
    pub product_id: String,
    pub purchased_at_unix: i64,
    pub expires_at_unix: i64,
}
```

The `LicensePayload` struct gets a new
optional field (`kid: Option<String>`), but
the existing payload format is backward-
compatible: `serde` deserializes v0.0.x
payloads (without `kid`) as `kid: None`,
which the verifier treats as `"trial"`.

No other data model changes. The keychain
gets two new entries (`KEYCHAIN_USER_IAP_PRIVKEY`
+ `KEYCHAIN_USER_IAP_PUBKEY`); the
existing `KEYCHAIN_USER_LICENSE` entry
holds the resulting `LIP1...` string.

## File layout

New files:

```
src-tauri/src/iap_apple.rs           # Apple App Store validator
src-tauri/src/iap_apple.test.rs      # Apple validator tests
src-tauri/src/iap_microsoft.rs       # Microsoft Store validator
src-tauri/src/iap_microsoft.test.rs  # Microsoft validator tests
src-tauri/src/iap_keypair.rs         # Per-machine IAP keypair management
src-tauri/src/iap_keypair.test.rs    # Keypair management tests
```

Modified files:

```
src-tauri/src/iap.rs                 # Rewrite as dispatcher
src-tauri/src/iap.rs                 # Add ~10 new tests for the dispatcher
src-tauri/src/licensing.rs           # Add `kid` field to LicensePayload
src-tauri/src/licensing.rs           # Update verify_license to dispatch on `kid`
src-tauri/src/licensing.rs           # Add ~5 new tests for `kid` dispatch
src-tauri/src/lib.rs                 # No new commands (iap_redeem is the only one)
src/ipc/iap.ts                      # Update JSDoc with the new error reasons
src/ipc/iap.test.ts                 # Add ~2 new tests for the new error reasons
CHANGELOG.md                        # New "Added (Phase 4 — IAP receipt validation)" section
HANDOFF.md                          # §6 "Current phase" + §9.27
docs/decisions/0097-p4-iap-per-machine-keypair.md
docs/decisions/0098-p4-iap-receipt-format-routing.md
docs/decisions/0099-p4-iap-no-revalidation.md
```

## The receipt-format routing

The dispatcher inspects the receipt format
to decide which platform validator to call:

```rust
fn dispatch_receipt(receipt: &str) -> ReceiptRoute {
    let trimmed = receipt.trim_start();
    if trimmed.starts_with('{') {
        // JSON — try Apple first.
        if serde_json::from_str::<AppleReceiptResponse>(trimmed).is_ok() {
            return ReceiptRoute::Apple;
        }
    }
    if trimmed.starts_with('<') {
        // XML — Microsoft.
        if trimmed.contains("<Receipt") {
            return ReceiptRoute::Microsoft;
        }
    }
    ReceiptRoute::Unknown
}
```

The Apple validator is tried first because
the Apple `verifyReceipt` *request* is JSON
(the *response* is also JSON); the receipt
*itself* is base64-encoded but the *outer*
envelope that the OS gives to the JS layer
might be JSON in some macOS versions (the
`AppStore` API returns a JSON wrapper around
the base64 receipt). The dispatcher tries
Apple first; if the response can't be
parsed as Apple, it tries Microsoft.

If both fail, the user gets
`iap-receipt-format-unrecognized`. The UI
shows "we couldn't recognize the receipt
format. Please paste a license key instead."

## The per-machine keypair security model

The per-machine Ed25519 keypair is the
**single point of trust** for IAP-generated
licenses. The privkey is generated on the
user's machine (via `getrandom` + the
embedded `getrandom` crate, which uses
the OS's CSPRNG), stored in the keychain
(Windows DPAPI / macOS Keychain / Linux
Secret Service), and never leaves the
machine. The pubkey is also stored in the
keychain (so the verifier can read it
without the user re-entering anything).

**What a malicious actor can do without
the privkey**: nothing. They can't sign a
license; the verifier rejects the
signature.

**What a malicious actor can do with the
privkey**: only what the *user* can do.
The privkey is bound to the user's machine
(it's in their keychain). If the attacker
has root on the user's machine, they
already have the user's license.

**What if the privkey is lost** (e.g. the
user reinstalls the OS and the keychain
entry is gone): the IAP-generated license
is unverifiable. The verifier returns
`MissingLocalPubkey`. The user re-runs
the IAP flow on the new machine (their
Apple ID / Microsoft account still has
the subscription), and the Rust side
generates a new keypair.

**What if the user transfers the license
to a new machine** (via the Phase 3
TransferFlow): the old machine's keychain
entry is deleted (the TransferFlow calls
`license_deactivate`), so the old machine
can't verify the license anymore. The new
machine generates a new keypair on first
IAP re-redemption.

## Test plan

### Rust unit tests (`src-tauri/src/iap_apple.rs`)

1. `validate_apple_response_accepts_status_0_with_matching_product_id`.
2. `validate_apple_response_rejects_status_21002_malformed_data`.
3. `validate_apple_response_rejects_status_21004_shared_secret_mismatch`.
4. `validate_apple_response_rejects_mismatched_product_id`.
5. `validate_apple_response_rejects_expired_subscription`.
6. `validate_apple_response_rejects_future_purchase_date`.

### Rust unit tests (`src-tauri/src/iap_microsoft.rs`)

7. `validate_microsoft_response_accepts_valid_receipt_with_matching_product_id`.
8. `validate_microsoft_response_rejects_error_response`.
9. `validate_microsoft_response_rejects_mismatched_product_id`.
10. `validate_microsoft_response_rejects_expired_subscription`.
11. `parse_microsoft_xml_extracts_product_id_and_expiration`.

### Rust unit tests (`src-tauri/src/iap_keypair.rs`)

12. `get_or_create_iap_keypair_creates_new_on_first_call`.
13. `get_or_create_iap_keypair_returns_existing_on_second_call`.
14. `get_iap_pubkey_returns_none_if_keypair_not_yet_created`.
15. `sign_with_iap_keypair_produces_valid_signature`.

### Rust unit tests (`src-tauri/src/iap.rs` dispatcher)

16. `dispatch_receipt_routes_json_to_apple`.
17. `dispatch_receipt_routes_xml_to_microsoft`.
18. `dispatch_receipt_routes_unknown_to_invalid`.
19. `iap_redeem_with_empty_receipt_returns_invalid`.
20. `iap_redeem_with_invalid_format_returns_invalid_with_unrecognized_reason`.
21. `iap_redeem_with_expired_apple_receipt_returns_invalid_with_expired_reason`.
22. `iap_redeem_saves_license_to_keychain_on_success`.

### Rust unit tests (`src-tauri/src/licensing.rs` extension)

23. `validate_shape_accepts_kid_trial`.
24. `validate_shape_accepts_kid_offline`.
25. `validate_shape_accepts_kid_iap_local`.
26. `validate_shape_rejects_kid_unknown`.
27. `validate_shape_accepts_kid_none_for_backward_compat`.
28. `verify_license_dispatches_on_kid_trial`.
29. `verify_license_dispatches_on_kid_offline`.
30. `verify_license_dispatches_on_kid_iap_local`.
31. `verify_license_returns_missing_local_pubkey_when_iap_keychain_empty`.

### TS unit tests (`src/ipc/iap.test.ts`)

32. `iap_redeem_returns_active_status_on_success`.
33. `iap_redeem_propagates_invalid_status_for_format_error`.

Total: **~33 new tests** (31 Rust + 2 TS). The full vitest suite and the full cargo test suite should pass.

## Open questions / future work

1. **Should the IAP receipts be re-validated periodically?** Apple recommends re-validating every 30-60 days to catch subscriptions that the user cancelled. Phase 4 does *not* re-validate (we're offline-first). A v1.1 follow-up could add a "refresh license from IAP" command that re-validates and extends the local license's `exp`.
2. **Should the IAP receipt be stored in the keychain alongside the license?** A "yes" would let the user re-validate offline (e.g. "refresh license" without a network call to the user, but with a cached receipt). A "no" (Phase 4's choice) is simpler and the receipt is captured from the OS on demand. Future phase.
3. **What if the user's Apple ID / Microsoft account changes?** The IAP receipt is bound to the Apple ID, not the machine. If the user signs out of their Apple ID on the Mac, the next `iap_redeem` call returns a different receipt. Phase 4 doesn't handle this; the user gets a new license with a different `jti` but the same machine fingerprint. The verifier accepts both (same `kid` + same `sub`). A v1.1 follow-up could add a "this license was issued for a different Apple ID" warning.
4. **What about Google Play receipts (for Android / ChromeOS)?** Google Play uses a different receipt format (JSON with `orderId`, `purchaseToken`, `packageName`). Phase 4 is desktop-only; a future phase adds the Google Play validator for the (eventual) Android build.
5. **What about volume / per-seat licenses for teams?** A future v2 license format could include a `seats` field. The IAP validator would map to a "team" plan; the UI would show "X of Y seats used". Future.
6. **What if the IAP endpoint is down?** The user's existing local license is unaffected (it's signed with the per-machine key, not the IAP proof). The IAP re-validation (for a new machine or a re-activation) is blocked. The UI shows "Apple's / Microsoft's IAP service is unavailable; please paste a license key instead". The project lead monitors the Apple / Microsoft status pages.
7. **What about the "App Store small business program" (15% fee for <$1M revenue)?** Phase 4 doesn't configure the fee tier; that's a project lead's App Store Connect setting, not a code change. Future.
8. **What about IAP promo codes / offer codes?** Apple's offer codes produce a different receipt format. Phase 4 treats them as a regular `verifyReceipt` call (Apple's API handles offer codes transparently). No code change needed.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Apple's `verifyReceipt` endpoint changes (URL, request format, response format) | Low | High | The validator is a single function (`validate_apple_response`); a breaking change is a 1-2 day fix. Apple's API has been stable since 2011. |
| Microsoft's Store Broker API is complex (OAuth + per-product URLs + XML) | Medium | Medium | The Microsoft validator is in a separate file (`iap_microsoft.rs`); a breaking change is contained. The tests use mock XML fixtures (no real Microsoft endpoint needed). |
| The per-machine keypair is lost (OS reinstall, keychain corruption) | Low | Medium | The IAP re-validation flow generates a new keypair on the new machine. The user's Apple / Microsoft subscription is unchanged. The old keychain entry is silently abandoned. |
| A malicious actor fakes a per-machine keypair (e.g. by writing to the keychain directly) | Very Low | Critical | The keypair is stored in the OS keychain (Windows DPAPI / macOS Keychain / Linux Secret Service), which requires the user's login password to write to. An attacker with the user's login password already has the user's license. |
| A user with a fake / stolen credit card gets an IAP subscription, the chargeback cancels the IAP | Low | Medium | Phase 4 doesn't re-validate (offline-first). A v1.1 follow-up could add a "IAP re-validation" that the project lead can trigger manually for suspicious accounts. |
| The IAP receipt format is large (Apple receipts can be >100KB after base64 decoding) | Low | Low | The Rust side caps the receipt length at 1MB before parsing. Anything larger is rejected with `iap-receipt-too-large`. |
| The user uninstalls Lipi and reinstalls on the same machine | Low | Low | The keychain entry is per-OS-user, not per-app-install. Reinstalling Lipi doesn't delete the keychain entry. The license + keypair are preserved. |
| The user moves their keychain to a new machine (e.g. Apple Migration Assistant) | Very Low | High | The per-machine keypair is now on two machines. Both can verify the license. This is acceptable (the user is the same person; the alternative is "the user has to re-validate on the new machine", which is worse UX). |
| A race condition between two `iap_redeem` calls (the user double-clicks "Restore") | Low | Low | The dispatcher uses `tokio::sync::Mutex` to serialize the per-machine keypair generation. The second call sees the first call's keypair and uses it. |

The risks are bounded. The implementation is straightforward (one new endpoint call per platform, one new module for the keypair). The hard part is the Microsoft Broker API, which is well-documented but verbose.

## What this design does NOT cover

- **No real IAP purchase flow.** The user buys via the PricingCard's external link to the project website, OR via the OS's IAP dialog (when shipped in the App Store / Microsoft Store). The receipt is captured from the OS's IAP API, not from a custom JS dialog.
- **No mobile IAP (Google Play, Apple iOS).** Mobile is a separate distribution channel with its own store integration. Future phase.
- **No Linux IAP.** Linux doesn't have a desktop-app store with IAP. The PricingCard "IAP" buttons are hidden on Linux.
- **No IAP subscription state re-validation.** We trust the receipt once. A v1.1 follow-up could add periodic re-validation.
- **No IAP for free trials.** Apple's free trials are still "IAP" (the user enters their Apple ID, the trial is a 0-cost IAP). Phase 4 doesn't differentiate — the IAP validator returns `Active` for any valid receipt, including trials. The UI shows "trial active" based on the `exp` timestamp.
- **No "IAP upgrade" / "IAP downgrade"** (e.g. user goes from monthly to yearly). Apple's IAP supports this via subscription groups; Phase 4 doesn't differentiate. A v1.1 follow-up.

## References

- `HANDOFF.md §6 "Current phase: Phase 4 — IAP receipt validation — SHIPPED"` (post-Phase-4)
- `HANDOFF.md §9.27` — the per-phase writeup
- `docs/plans/prod-p2-licensing-design.md` — the Phase 2 design
  (the `LicensePayload` + `kid` extension is a
  minimal superset of the existing format)
- `docs/plans/prod-p3-subscription-ux-design.md` —
  the Phase 3 design (the `iap_redeem` stub
  is in `src-tauri/src/iap.rs` v1; the
  receipt format dispatching + keypair
  management are the same pattern as the
  offline + trial paths)
- Apple's `verifyReceipt` docs:
  https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
- Microsoft's Store Broker API docs:
  https://learn.microsoft.com/en-us/windows/uwp/monetize/in-app-purchases-and-trials

---

*This is a design doc. Implementation will follow in Phase 4b*
*of the production-readiness todo list.*
