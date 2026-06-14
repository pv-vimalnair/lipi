# ADR 0098 — Route IAP receipts by format inspection (JSON → Apple, XML → Microsoft)

**Date**: June 2026
**Phase**: 4 (IAP receipt validation)
**Status**: Accepted
**Deciders**: project lead (Vimal Nair)

## Context

The `iap_redeem` Tauri command needs to validate receipts from
two platforms:

- **Mac App Store**: the JS layer captures a receipt from
  Apple's `AppStore` API (or the new `StoreKit 2` API in
  macOS 14+). The receipt is either a base64-encoded blob
  (the raw receipt) or a JSON response from Apple's
  `verifyReceipt` endpoint.
- **Microsoft Store**: the JS layer captures a receipt from
  `Windows.Services.Store`. The receipt is XML (a Microsoft
  Store Broker API response).

The Tauri command needs to dispatch the receipt to the right
platform-specific validator. Three options:

1. **Two separate Tauri commands** (`iap_redeem_macos` +
   `iap_redeem_windows`). The UI calls the right one based
   on the user's OS.
   - **Pro**: explicit; the UI knows which store it's
     talking to.
   - **Con**: the UI has to know the user's OS, which is
     already known but adds a branching path to every
     call site.
   - **Con**: harder to extend to a third platform (Linux
     IAP, Google Play, etc.) — every new platform is a
     new Tauri command.
   - **Con**: the receipt *format* is the source of truth
     (Apple returns JSON, Microsoft returns XML), not the
     *user's OS*. A user on Windows who pastes an Apple
     receipt (e.g. forwarded from a colleague) would call
     the wrong command.
   - **Verdict**: rejected.

2. **OS detection on the Rust side**. The Tauri command
   checks the OS and dispatches internally.
   - **Pro**: same IPC surface (just `iap_redeem`).
   - **Con**: still doesn't handle the cross-platform case
     (a user pasting an Apple receipt on Windows).
   - **Con**: the dispatcher would need to handle Linux
     specially (no IAP), adding branching.
   - **Verdict**: rejected.

3. **Inspect the receipt format** (first non-whitespace
   character + a few structural markers) and dispatch to
   the matching validator. The receipt *is* the source of
   truth.
   - **Pro**: same IPC surface.
   - **Pro**: handles the cross-platform case (a user on
     Windows pasting an Apple receipt gets
     `iap-receipt-format-unrecognized`, not silent
     failure).
   - **Pro**: extensible to new platforms (just add a new
     format marker + a new validator).
   - **Pro**: the OS doesn't matter for the dispatcher;
     only the receipt format does.
   - **Con**: a user could in theory craft a JSON
     "receipt" that doesn't match Apple's actual format,
     and the dispatcher would route it to Apple (which
     would then reject it). The error message is the
     same as a real Apple receipt that fails validation
     (`iap-rejected-by-apple`); the user can't tell the
     difference. This is acceptable: the user is
     malicious, the outcome is a rejection, and the
     attack surface is "waste Apple's time with a fake
     request" (which is a DoS, not a license bypass).
   - **Verdict**: the right model.

## Decision

Use option 3: the `iap_redeem` dispatcher inspects the
receipt format and routes to the matching platform validator.

The routing logic (`iap::dispatch_receipt`):

```rust
let trimmed = receipt.trim_start();
if trimmed.is_empty() { return Unknown; }
if trimmed.starts_with('{') {
    // JSON: Apple.
    if trimmed.contains("\"latest_receipt_info\"")
        || trimmed.contains("\"product_id\"") {
        return Apple;
    }
    return Unknown;
}
if trimmed.starts_with('<') {
    // XML: Microsoft.
    if trimmed.contains("<Receipt") {
        return Microsoft;
    }
    return Unknown;
}
Unknown
```

The "discriminating markers" (`"latest_receipt_info"`,
`"product_id"`, `<Receipt`) are deliberately lenient: the
exact JSON / XML structure may vary across macOS versions
or Microsoft Store API versions, but the high-level
structure (Apple's `latest_receipt_info` array, Microsoft's
`<Receipt>` element) has been stable for years.

The dispatcher returns one of three `ReceiptRoute` values:

- `Apple` → call `iap_apple::validate_apple_response`
  (deserializes the JSON, validates the response).
- `Microsoft` → call `iap_microsoft::parse_microsoft_response`
  + `validate_microsoft_response` (parses the XML, validates
  the response).
- `Unknown` → return
  `LicenseStatus::Invalid { reason: "iap-receipt-format-unrecognized" }`.

## Consequences

- **Single IPC surface**: `iap_redeem` is the only Tauri
  command. The UI doesn't need to know which platform the
  user is on.
- **Cross-platform paste works**: a user can paste an Apple
  receipt on Windows and the dispatcher will route it to
  Apple (which will then reject it, but the rejection is
  via the `iap-rejected-by-apple` reason, not a generic
  "wrong platform" error).
- **Extensible**: adding a new platform (Google Play,
  Linux Snap, etc.) is a new `ReceiptRoute` variant + a
  new `dispatch_receipt` arm + a new validator module.
  The IPC surface doesn't change.
- **Lenient routing**: the markers (`"latest_receipt_info"`,
  `"product_id"`, `<Receipt`) are stable across Apple /
  Microsoft API versions, so a future API change is
  unlikely to break the routing. If it does, the user
  gets `iap-receipt-format-unrecognized` and the project
  lead updates the markers.
- **Pure function**: `dispatch_receipt` is a pure string
  inspection (no I/O, no network), so it's fully testable
  with string fixtures. The platform-specific validators
  are also pure (they take a deserialized response + the
  current time), so the test surface is large but
  contained.

## Alternatives considered

- **Option 1 (two separate Tauri commands)**: rejected. The
  OS isn't the source of truth for the receipt format; the
  receipt is.
- **Option 2 (OS detection)**: rejected. Same problem as
  option 1, plus a Linux branch (no IAP).
- **Receipt header magic bytes**: Apple and Microsoft
  receipts don't have a standardized header (Apple receipts
  are base64-encoded; the dispatcher sees either the raw
  base64 or the JSON wrapper around it). Inspecting the
  first non-whitespace character is the right level of
  discrimination.

## References

- `docs/plans/prod-p4-iap-validation-design.md` — the full
  Phase 4 design.
- `src-tauri/src/iap.rs` — the `dispatch_receipt` function
  + the `iap_redeem` dispatcher.
- `src-tauri/src/iap_apple.rs` — the Apple validator.
- `src-tauri/src/iap_microsoft.rs` — the Microsoft
  validator.
