# Phase 2 — Offline licensing layer (design)

**Date**: June 2026
**Phase**: 2 of the production-readiness roadmap (see HANDOFF §6 "Next:")
**Status**: Design (accepted for implementation)
**Supersedes**: nothing — this is the first time Lipi has a licensing layer
**Deciders**: project lead (Vimal Nair)

## Goal

Add an **offline-verifiable subscription** to Lipi so the app can be sold
to other people. The user pastes a license key into the app, the app
verifies the key offline (no network round-trip), and the app stores
the verified license in the OS keychain. The license binds the
subscription to a specific machine fingerprint so a single license
can't be shared across dozens of machines. A 14-day free trial is
auto-generated on first run (no credit card required).

## Non-goals (Phase 2 explicitly does not do)

- **No backend / online verification.** The license is verified purely
  with an embedded public key. There is no server round-trip on app
  start, no "phone home" check, no revocation list. This matches the
  "no backend, ever" architectural rule (Decision #17) the user
  reaffirmed when picking the production architecture.
- **No IAP integration.** The Mac App Store / Microsoft Store IAP
  flow (Phase 4) is a separate concern — it will hand a receipt to the
  licensing layer, which will validate the receipt and convert it to a
  license. Phase 2 builds the offline-license *primitives*; Phase 4
  wires them to the stores.
- **No team / per-seat licensing.** Phase 2 is a single-user, single-
  license model. 1 license = 1 user on up to 2 machines. Team /
  per-seat / volume is a future pricing tier.
- **No anti-tamper beyond signature verification.** We don't detect
  debuggers, don't refuse to run in a VM, don't check the file
  modification time of `lipi.exe`. The signature is the only
  verification.
- **No license-server CLI tool.** Phase 2 has a Rust `sign_license`
  function (so we can test the round-trip), but the production signing
  tool — a CLI the project lead runs to issue keys from a CSV of
  purchases — is a separate "license issuer" subcommand that lands in
  Phase 4 (when we know the exact store IAP receipt shape).

## Architecture overview

The license is a **JWS-style compact signed document**: a
base64url-encoded JSON payload, a base64url-encoded Ed25519 signature,
concatenated with a `.` separator. The shape is identical to a JWT
(JWS in the compact serialization) but with a custom payload schema
and an Ed25519 algorithm (`EdDSA`). The public key is embedded in the
Rust binary as a `const [u8; 32]` so a user can't easily swap it.

The verification path is fully offline:

```
[User pastes license key]
    │
    ▼
[Tauri command: license_activate(key)]
    │   1. Parse "header.payload.signature"
    │   2. base64url-decode payload, parse JSON
    │   3. base64url-decode signature
    │   4. Verify Ed25519(signature, header.payload, embedded_pubkey)
    │   5. Check machine_id matches `sub` claim
    │   6. Check `exp` claim is in the future
    │   7. Check `nbf` claim is in the past
    │   8. Store the verified payload in the OS keychain
    ▼
[Return LicenseStatus::Active { plan, expiresAt, machines: 1 }]
```

The machine fingerprint is a SHA-256 hash of `hostname || username ||
mac_address`, encoded as a 32-character hex string. It's stable across
reboots (the inputs don't change on a single machine) and unique per
machine (collisions would require identical hostname + username + MAC,
which is essentially impossible in practice).

The license is bound to a specific machine by setting the `sub` claim
to the fingerprint *at issuance time*. So a license key issued to
machine A will fail verification on machine B (the `sub` claim
won't match machine B's fingerprint). This is a hard bind — there's
no "transfer license to another machine" UI in Phase 2 (we land that
in Phase 3, and it'll require re-issuing a new license key from the
project lead's signing tool).

The 14-day free trial is auto-generated on first run: the app
generates a license payload with `plan: "trial"`, `exp: now + 14 days`,
and `sub: <this machine's fingerprint>`, then signs it with a
**trial** keypair (a different key from the production keypair). The
trial public key is also embedded as a `const [u8; 32]`. The trial
license never leaves the machine — it's generated and stored locally.

## The data model

### License payload (the signed JSON)

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LicensePayload {
    /// "lipi-license-v1" — fixed format identifier. The
    /// Rust side checks this on parse; a mismatched
    /// value is treated as "not a Lipi license".
    pub format: String,

    /// "trial" | "monthly" | "yearly". Drives the
    /// paywall / grace period / feature gating.
    pub plan: String,

    /// Unix timestamp when the license was issued.
    /// Used for audit + the "renewed N days ago" UI.
    pub iat: i64,

    /// Unix timestamp when the license becomes valid.
    /// Almost always == iat; reserved for future
    /// "delayed activation" use cases.
    pub nbf: i64,

    /// Unix timestamp when the license expires.
    /// Past `exp` = "expired" / "in grace period".
    pub exp: i64,

    /// SHA-256 of hostname || username || mac_address,
    /// hex-encoded, 32 chars. The license is bound
    /// to this machine.
    pub sub: String,

    /// Random per-license id. Used for the
    /// deactivation UI ("which machines are using
    /// this license?") and for log de-duplication.
    pub jti: String,
}
```

The five string fields are all max-length-validated (format ≤ 16,
plan ≤ 16, sub = exactly 32 hex chars, jti ≤ 64) so a corrupt or
malicious payload can't OOM the parser.

### The license key (what the user pastes)

```
LIP1.<base64url(payload)>.<base64url(signature)>
```

`LIP1` is a fixed magic prefix (Lipi license v1). The dot-separated
format is the JWS compact serialization. A real key looks like:

```
LIP1.eyJmb3JtYXQiOiJsaXBpLWxpY2Vuc2UtdjEiLCJwbGFuIjoieWVhcmx5I...<truncated>..<signature>
```

The total length is ~400-500 chars. We accept and trim whitespace
from the user's input.

### Keypairs

Two Ed25519 keypairs, both embedded as `const [u8; 32]`:

| Keypair | Purpose | Where the private key lives |
|---------|---------|-----------------------------|
| **Production** (`LIP1_PROD_PUBKEY`) | Signs paid license keys | The project lead's CI secrets + a local backup on an encrypted USB drive. NEVER committed. |
| **Trial** (`LIP1_TRIAL_PUBKEY`) | Signs trial license keys | The trial private key IS embedded in the binary (it's how the trial license is generated locally). The trial license has a 14-day max `exp`, so even if someone extracted the trial private key, the maximum damage is 14 days of free usage on a single machine. |

The production public key is committed to the repo (in
`src-tauri/src/licensing.rs` as a `const [u8; 32]`). The trial
public key is also committed (same file, different const). The
production private key is generated once, stored in the project lead's
CI secret store (`TAURI_PROD_LICENSE_KEY_HEX`), and the project lead
runs a one-time `cargo run --bin sign_license -- --plan yearly
--machine <fp> --out license.txt` to issue a key. Phase 4 will wrap
that into a CSV-driven batch issuer.

### License status (what the app reports)

```rust
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum LicenseStatus {
    /// No license file in the keychain. App should
    /// show the activation screen (Phase 3 will
    /// gate the workspace UI behind this).
    Unactivated,

    /// License is valid and not expired. The
    /// payload's plan + exp are available.
    Active {
        plan: String,        // "monthly" | "yearly"
        expires_at: i64,     // Unix timestamp
        issued_at: i64,      // Unix timestamp
        days_remaining: i64, // exp - now, computed
    },

    /// License is in the 7-day grace period after
    /// expiry. App should nag (Phase 3).
    GracePeriod {
        plan: String,
        expired_at: i64,
        days_into_grace: i64,
    },

    /// License is past the grace period. App
    /// should hard-block the workspace (Phase 3).
    Expired {
        plan: String,
        expired_at: i64,
    },

    /// License is on a trial. The trial plan is
    /// "trial", the expiry is 14 days from iat.
    Trial {
        expires_at: i64,
        days_remaining: i64,
    },

    /// License file is in the keychain but failed
    /// verification. This is a hard error — the
    /// user tampered with the keychain, or the
    /// license is for a different machine, or the
    /// license is corrupted. The app should show
    /// "License invalid" + the reason.
    Invalid {
        reason: String, // "signature-mismatch" | "machine-mismatch" | "expired" | "malformed"
    },
}
```

The `tag = "kind"` + `rename_all = "camelCase"` matches the project's
existing IPC error / payload convention (see `src-tauri/src/secrets.rs`
and `src/ipc/secrets.ts`).

### Tauri commands

```rust
#[tauri::command]
fn license_get_status() -> LicenseStatus;

#[tauri::command]
fn license_activate(key: String) -> LicenseStatus;

#[tauri::command]
fn license_deactivate() -> LicenseStatus;

#[tauri::command]
fn license_get_machine_fingerprint() -> String;
```

The first three read / write the OS keychain under service
`app.lipi.ide` (matching the secrets module's convention) with user
`license`. Only one license is active at a time — activating a new
key overwrites the old one.

The `license_get_machine_fingerprint` command exists so the JS-side
"Activation" UI can show the user their fingerprint (so they can
include it in the "please issue me a license" support email). The
value is non-secret (it's a hash of public system info), so showing
it in the UI is fine.

## Persistence

The license *payload* is stored in the OS keychain (service
`app.lipi.ide`, user `license`). The keychain is the same store the
secrets module uses — the same `keyring 3.6` crate, the same
`MockCredentialBuilder` for tests. The license is *not* the
signature itself — we store the *verified payload* (the JSON), not
the full `LIP1.payload.signature` string. Re-deriving the signature
on every load is unnecessary (we already verified it on activate);
storing the payload means the status command can be cheap
(no signature verification on every call).

Wait, that's a security hole. If the user can write to their own
keychain, they can write a self-signed "I'm active forever" payload
to the `license` entry. The signature has to be in the keychain too,
and we re-verify on every `license_get_status` call.

Revised: we store the full `LIP1.payload.signature` string in the
keychain. `license_get_status` reads it, re-parses, re-verifies the
signature, and computes the status. The verification is fast (a
single Ed25519 verification is microseconds), so doing it on every
status call is fine.

We also store the **last-verified-at** timestamp in a separate
keychain entry (`service: app.lipi.ide`, user:
`license_last_verified`). The status command only re-verifies the
signature once per app session (the first status call after launch)
and uses the cached payload for subsequent calls within the same
session. On app restart, the signature is re-verified.

This is "verify on first status call, cache for the session" — the
same pattern as the rest of the codebase (see `voiceCapabilitiesStore`
which hydrates once and is idempotent for the rest of the session).

## Cross-platform notes

- **macOS / Windows / Linux desktop**: identical code path. The
  `keyring` crate is already wired for all three platforms. The
  `mac_address` crate works on all three.

- **No mobile** in Phase 2. The licensing layer is desktop-only. The
  Tauri command module is gated `#[cfg(not(mobile))]` so the iOS /
  Android builds don't compile it. Mobile licensing is a future
  phase (it'll need a different storage — the Apple Keychain
  "shared keychain group" + receipt validation).

- **Linux without Secret Service**: the license activation will fail
  with `KeychainUnavailable`. Phase 3's UI will surface this as "The
  OS keychain is not running — please start GNOME Keyring /
  KWallet". This is a smaller problem than for AI provider API keys
  (a missing keychain is rare on Linux desktops).

## File layout

New files:

```
src-tauri/src/licensing.rs                    # The Rust module (sign + verify + Tauri commands)
src-tauri/src/licensing_test_helpers.rs       # Reusable sign+verify fixtures for the test suite
src-tauri/tests/licensing_smoke.rs            # Integration test (sign → verify → mutate → reject)
src/ipc/licensing.ts                          # TS IPC wrappers + LicenseStatus type mirror
src/shared/state/licenseStore.ts              # Zustand store mirroring the Rust status
src/shared/state/licenseStore.test.ts         # Store tests (hydrate, transitions, idempotency)
src/screens/License/License.tsx               # Activation screen (the "paste a key" wizard)
src/screens/License/License.module.css        # Activation screen styles
src/screens/License/License.test.tsx          # Activation screen tests (real DOM render per Decision #78)
src/screens/SettingsProvider/components/LicenseCard.tsx       # Settings tab License card
src/screens/SettingsProvider/components/LicenseCard.module.css # Settings License card styles
src/screens/SettingsProvider/components/LicenseCard.test.tsx  # License card tests
```

Modified files:

```
src-tauri/Cargo.toml                          # Add ed25519-dalek, sha2, base64, hostname, whoami, mac_address deps
src-tauri/src/lib.rs                          # Add `mod licensing;` + register 4 Tauri commands in invoke_handler
src-tauri/capabilities/default.json           # (No change — Tauri commands are auto-permissive)
src/ipc/index.ts                              # Re-export licensing module
src/screens/SettingsProvider/SettingsProvider.tsx  # Add License card to the settings list
src/screens/SettingsProvider/SettingsProvider.module.css  # License card layout slot
src/shared/commands/commands.ts               # Add "license.show" and "license.deactivate" commands to the palette
src/voice/capabilities.ts (or similar)        # (No change — voice is unrelated)
CHANGELOG.md                                  # "Added (Phase 2 — Offline licensing layer)"
HANDOFF.md                                    # §6 "Current phase" + §9.24 per-phase writeup
docs/decisions/                               # New ADRs #85-#88
```

The licensing primitive is a single Rust module (not split across
`licensing_sign.rs` / `licensing_verify.rs` / `licensing_keystore.rs`)
because the three concerns are tightly coupled (signing requires the
keypair, verifying requires the keychain entry, both share the
`LicensePayload` type). One file, ~400 lines + ~200 lines of tests.

## Crate choices

| Crate | Why | MSRV impact |
|-------|-----|-------------|
| `ed25519-dalek` v2 | Pure-Rust Ed25519. No C deps. The 2.x API is stable; the 1.x line is deprecated. | None (works on rustc 1.65+) |
| `sha2` v0.10 | For the machine fingerprint hash. We already have `sha2` as a transitive of `gix`. | None |
| `base64` v0.22 | For the JWS-style base64url encoding. The 0.22 API is the current line. | None |
| `hostname` v0.4 | Cross-platform hostname via `gethostname(2)` / `GetComputerNameExW`. | None |
| `whoami` v1 | Cross-platform OS username. | None |
| `mac_address` v1 | Cross-platform MAC address. We use the *first* non-loopback MAC. | None |

All six are well-maintained, pure-Rust, no C deps, and the only
meaningful addition to the dependency tree is `ed25519-dalek` (~200
KB of compiled code). The total impact on the binary size is
negligible.

## The trial generation flow

The trial is generated lazily on the first `license_get_status`
call after install (when the keychain has no `license` entry):

```
license_get_status()
  │
  ├── keychain.get("license") -> None
  │     │
  │     ▼
  │   machine_fingerprint() -> "<32-char hex>"
  │   LicensePayload { format: "lipi-license-v1",
  │                    plan: "trial",
  │                    iat: now,
  │                    nbf: now,
  │                    exp: now + 14 days,
  │                    sub: fingerprint,
  │                    jti: <16 random hex chars> }
  │   sign_with_trial_key(payload) -> signature
  │   "LIP1.<base64url(payload)>.<base64url(signature)>"
  │   keychain.set("license", <key string>)
  │   keychain.set("license_last_verified", now)
  │     │
  │     ▼
  │   return LicenseStatus::Trial { expires_at, days_remaining: 14 }
  │
  └── (subsequent calls hit the keychain and the
      verify-and-cache path)
```

The trial is a one-time thing — once the user activates a real
license, the trial is overwritten. A user who wants to "reset" the
trial has to uninstall + reinstall (and lose their settings — this
is a feature: it prevents trial-reset abuse).

The trial generation is **synchronous** in the `license_get_status`
command. The keychain write is the slow part (~10ms on macOS, ~1ms
on Windows). For the first status call this is one-time; subsequent
calls are sub-millisecond.

## UI integration (preview, full design in Phase 3)

The Phase 2 UI is minimal — a single activation screen and a
single settings card:

- **`src/screens/License/License.tsx`**: The activation screen.
  Shows a textarea ("Paste your license key here"), a "Activate"
  button, and a "Get a license" link that opens `https://lipi.ide/pricing`
  in the system browser. On success, navigates to the Workspace screen.
  On error, shows the reason. This screen is the *only* thing shown
  when the license status is `Unactivated` (Phase 3 will add the
  full-screen gate; Phase 2 just renders the activation screen as
  the index route when unactivated).
- **`src/screens/SettingsProvider/components/LicenseCard.tsx`**:
  A new settings card. Shows the current status (Active / Trial /
  Grace / Expired), the plan + expiry, a "Manage subscription" link
  (no-op in Phase 2; Phase 3 wires it to the store's subscription
  page), and a "Deactivate" button.

Phase 3 will add:
- The full-screen gate (workspace is inaccessible when unactivated
  or past grace)
- The expiry banner / nag modal
- The trial-progress badge in the title bar
- The "Activate on another machine" copy-to-clipboard
- The "Receipt" link

## Test plan

### Rust unit tests (`src-tauri/src/licensing.rs`)

1. `sign_then_verify_roundtrip` — sign a payload, verify it, check the
   payload fields match.
2. `verify_rejects_wrong_signature` — sign with key A, verify with
   key B → `Invalid("signature-mismatch")`.
3. `verify_rejects_tampered_payload` — sign, mutate one byte of the
   payload, verify → `Invalid("signature-mismatch")`.
4. `verify_rejects_malformed_key` — pass a `not.a.license` string →
   `Invalid("malformed")`.
5. `verify_rejects_wrong_machine` — sign with `sub: "AAA"`, verify
   on a machine with fingerprint "BBB" → `Invalid("machine-mismatch")`.
6. `verify_rejects_expired` — sign with `exp: now - 1` → `Invalid("expired")`.
7. `verify_rejects_future_nbf` — sign with `nbf: now + 3600` → `Invalid("not-yet-valid")`.
8. `verify_accepts_grace_period` — sign with `exp: now - 1` but the
   status layer still returns `GracePeriod` (status layer is
   separate from the verify layer).
9. `machine_fingerprint_is_stable` — call `machine_fingerprint()`
   twice, check the values are equal.
10. `machine_fingerprint_is_32_hex_chars` — check the format.
11. `trial_payload_signs_with_trial_key` — generates a trial payload,
    verifies with the trial pubkey, returns `Trial` status.
12. `status_unactivated_when_keychain_empty` — fresh keychain, status
    returns `Unactivated`.
13. `status_active_after_activation` — activate, then status returns
    `Active`.
14. `status_grace_after_expiry_within_7_days` — activate with a
    past-`exp` license, status returns `GracePeriod`.
15. `status_expired_after_7_days` — activate with `exp = now - 8 days`,
    status returns `Expired`.
16. `deactivate_clears_keychain` — activate, deactivate, status returns
    `Unactivated`.
17. `payload_field_validation_rejects_oversize` — pass a payload with
    `format: "x".repeat(1000)` → `Invalid("malformed")`.

### Integration test (`src-tauri/tests/licensing_smoke.rs`)

A full sign → store → load → re-verify round-trip, using the Mock
keychain. Verifies the contract between the Rust module and the
keychain layer.

### TS unit tests (`src/shared/state/licenseStore.test.ts`)

1. `starts with status=Unactivated`.
2. `hydrate transitions to Active / Trial / etc.`.
3. `activate(key) calls IPC and updates state`.
4. `deactivate calls IPC and resets to Unactivated`.
5. `hydrate is idempotent — second call is a no-op`.
6. `machine fingerprint is fetched on demand and cached`.

### TS component tests (`src/screens/License/License.test.tsx`)

1. `renders the activation textarea + button on mount`.
2. `clicking Activate with a valid key navigates to the workspace`.
3. `clicking Activate with an invalid key shows the reason`.
4. `renders the "Get a license" link pointing to the configured URL`.

### TS component tests (`LicenseCard.test.tsx`)

1. `renders the plan + expiry for an active license`.
2. `renders "Trial — N days remaining" for a trial`.
3. `renders the GracePeriod warning for a grace-period license`.
4. `renders the Expired error for an expired license`.
5. `clicking Deactivate calls the IPC + resets the card`.

Total: **~30 new tests** (17 Rust + 6 TS store + 4 component
activation + 5 component settings).

## Open questions / future work

1. **Will the trial generation block the first-run experience?**
   The first `license_get_status` call on a fresh install takes ~10ms
   to write to the keychain. That's imperceptible, but worth
   measuring on real hardware. If it's noticeable, we move the
   trial generation to a background task that resolves on the next
   status call.

2. **Should the trial be skippable via env var?** Devs building
   Lipi from source want to skip the trial. A `LIPI_LICENSE_BYPASS=1`
   env var is the standard pattern. Phase 2 doesn't add this —
   Phase 4's "build configuration" can include it if needed.

3. **What if the user's keychain is broken on Linux?** The activation
   will fail with `KeychainUnavailable`. Phase 3 will surface this
   as a clear "Keychain unavailable — start GNOME Keyring / KWallet
   and re-launch" message. No fallback to a file-based license
   store — that would be a security regression.

4. **What about the licence issuer tool?** Phase 2 has the
   `sign_license` function in the Rust module. The CLI tool that
   wraps it (`cargo run --bin sign_license -- --plan yearly
   --machine <fp> --out license.txt`) is a separate Phase 4
   deliverable. Phase 2 only ships the signing primitive + a
   comment in the Cargo.toml listing it as future work.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| User decompiles `lipi.exe` and extracts the trial private key | Medium | Low (14 days max, single machine) | Accept the risk. The production private key is NOT in the binary. |
| User generates fake license keys signed with their own key | None (signing key is in CI) | n/a | The Rust side verifies with the embedded pubkey. A fake key fails signature check. |
| User overwrites the `license` entry in their keychain | Low | Low | The Rust side re-verifies the signature on every status call. A tampered keychain entry with a bad signature is treated as "no license" (status returns Unactivated). |
| `keyring` crate breaks on a future macOS / Windows update | Very low | High (all licensing fails) | The `keyring` crate is widely-used; the project lead is subscribed to its release notes. A future phase can swap to `tauri-plugin-stronghold` if needed. |
| User shares license with a friend (both run on machine with same fingerprint) | Very low | Low | The fingerprint includes the MAC address. Two distinct machines have distinct MACs. Two VMs on the same host share the MAC, but the OS username / hostname usually differ. |
| Linux without Secret Service | Low | Low (can't activate) | Phase 3 shows a clear error. The user is in a small minority. |

The risks are bounded by the "no backend" architecture. There's no
account to compromise, no payment to reverse, no subscription to
cancel server-side. The worst case is "a few users get free Lipi for
a few months" — and even that requires them to extract the trial
private key from a signed binary, which is not a casual attack.

## What this design does NOT cover

- **No payment processing.** Phase 2 is offline-only. The
  payment-processor integration (Stripe / App Store / Microsoft Store)
  is Phase 4.
- **No "Restore my subscription" UI.** When Phase 4 lands, the
  activation screen will get a "Restore from App Store" / "Restore from
  Microsoft Store" button. Phase 2 only has the manual paste-in flow.
- **No transfer-between-machines flow.** A user who buys a new laptop
  has to email the project lead with their old + new fingerprints
  and a manual re-issue. Phase 3's "Deactivate" button is the first
  step; the "Transfer" flow is a v2 feature.
- **No team / volume licensing.** Each user has their own license.
  The "5 seats for $200" pricing tier is a future plan that requires
  a per-license-file format change (multiple `sub` claims per signed
  payload).
- **No analytics.** The app doesn't phone home with license stats.
  The project lead has to count "active licenses" manually (via
  customer support emails). A future phase could add an opt-in
  "send anonymous usage stats" toggle that includes a license-hash
  beacon, but that's a separate decision.

## References

- `HANDOFF.md §6 "Next:"` — the production-readiness roadmap
- `HANDOFF.md §6 "Current phase: M6b — SHIPPED"` — the previous
  shipped phase (M6b's per-tab state keying + v4 settings)
- `docs/decisions/0017-no-backend-ever.md` — the architectural rule
  this design extends (no backend → no online license validation)
- `docs/decisions/0023-tauri-bundle-id.md` — the bundle ID convention
  (the keychain service name `app.lipi.ide` matches this)
- `src-tauri/src/secrets.rs` — the OS keychain wrapper we reuse
- `src/ipc/secrets.ts` — the IPC convention (tagged error unions,
  camelCase JSON) we mirror
- `src/shared/state/voiceCapabilitiesStore.ts` — the Zustand store
  pattern (hydrate-once-then-read) we mirror
- JWS (RFC 7515) — the compact serialization format we use for the
  license key
- EdDSA (RFC 8032) — the signature algorithm we use

---

*This is a design doc. Implementation will follow in Phase 2b-2h of
the production-readiness todo list.*
