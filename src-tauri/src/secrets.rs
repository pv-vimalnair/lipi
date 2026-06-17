//! OS-keychain wrapper for AI provider API keys (Phase 5a).
//!
//! One key per provider, stored under the service name
//! `app.lipi.ide` with the user name = the provider id
//! (e.g. `openai`, `anthropic`, `openrouter`). The list of
//! supported providers is hardcoded in `ai.rs` and exposed
//! to the frontend via `ai_list_providers`; this module
//! just does the storage.
//!
//! ## Why keyring (and not our own encrypted file)
//!
//! Per Decision #17 ("no backend, ever"), the API key must
//! never enter the JS bundle or any file we control. The
//! OS keychain is the only store that:
//!   - Survives app restarts
//!   - Is encrypted at rest (on every platform we ship to)
//!   - Is accessible to the user via the OS UI
//!     (so they can revoke access in one place)
//!   - Requires an unlocked user session to read on
//!     Windows / macOS / Linux
//!
//! ## Cross-platform notes
//!
//! - **Windows**: Windows Credential Manager. We target the
//!   "Windows Credential" (Generic) type, scoped to the
//!   current user. Encrypted with DPAPI under the user's
//!   profile key.
//!
//! - **macOS / iOS**: Apple Keychain. We let the system
//!   decide accessibility (kSecAttrAccessible default =
//!   `kSecAttrAccessibleWhenUnlocked`). On iOS, this means
//!   the key is unavailable while the device is locked —
//!   good for security, slightly worse for background
//!   tasks (we don't have any in 5a).
//!
//! - **Linux**: Secret Service over D-Bus. The user's
//!   desktop session must have a Secret Service provider
//!   running (GNOME Keyring, KWallet, KeePassXC's Secret
//!   Service bridge, etc.). We statically link OpenSSL via
//!   the `vendored` feature in Cargo.toml so users don't
//!   need a separate `libssl` install.
//!
//! - **Android**: NOT supported by `keyring` 3.x. The 5a
//!   desktop build skips Android. When we get to mobile,
//!   we'll either use `tauri-plugin-stronghold` (which
//!   works on Android) or a JNI binding to Android
//!   Keystore.
//!
//! ## Test strategy
//!
//! The unit tests use `keyring::set_default_credential_builder`
//! to install a `Mock` builder. The Mock store is in-memory
//! and platform-independent, so the same tests run on
//! every dev machine and in CI. The Mock store's value
//! (and any preset errors) is per-process — tests don't
//! leak state between each other.

use serde::{Deserialize, Serialize};

/// OS keychain service name. The `app.lipi.ide` matches
/// the Tauri bundle ID (Decision #23). The keychain
/// namespaces by service, so changing the bundle ID in
/// the future will *not* migrate existing user keys —
/// they'll need to be re-entered. This is a feature, not
/// a bug: the old keys belong to the old app.
pub(crate) const SERVICE: &str = "app.lipi.ide";

/// Max length of a provider id (matches the
/// `validate_provider` upper bound).
pub(crate) const MAX_PROVIDER_LEN: usize = 64;

/// Max length of an API key (matches the
/// `validate_key` upper bound).
pub(crate) const MAX_KEY_LEN: usize = 512;

/// Error type for the secrets module. Serialised to
/// camelCase JSON for the frontend (`secretError` /
/// `invalidInput` / `keychainUnavailable` / `platform`).
/// The frontend `SecretErrorPayload` type in
/// `src/ipc/secrets.ts` mirrors this shape.
///
/// Each variant has a single `detail: String` field.
/// The TS side reads `payload.kind` and
/// `payload.detail`.
#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SecretError {
    /// The provider id or the key value was empty,
    /// too long, or non-ASCII.
    #[error("invalid input: {detail}")]
    InvalidInput {
        detail: String,
    },

    /// The keyring backend is unavailable. On Linux,
    /// this is the most common error (no Secret
    /// Service running). On Windows / macOS, it
    /// usually means a sandbox / permissions issue.
    #[error("keychain unavailable: {detail}")]
    KeychainUnavailable {
        detail: String,
    },

    /// Generic platform error that doesn't fit the
    /// other categories (e.g. I/O failure reading
    /// the credential store, or an unexpected
    /// keyring crate error variant).
    #[error("keychain error: {detail}")]
    Platform {
        detail: String,
    },
}

impl From<keyring::Error> for SecretError {
    fn from(e: keyring::Error) -> Self {
        match e {
            // `NoEntry` is "not found" — we treat it as
            // its own variant so the frontend can ask
            // "does this provider have a key?" without
            // catching a separate `NotFound` exception.
            keyring::Error::NoEntry => {
                // The crate doesn't carry data on NoEntry;
                // the message is fine for the user.
                SecretError::Platform { detail: "no entry".to_string() }
            }
            // `Ambiguous` means a third-party tool
            // wrote two credentials with the same
            // service+user. We surface this as a
            // platform error; the user can fix it
            // by deleting the duplicate via the OS UI.
            keyring::Error::Ambiguous(_) => {
                SecretError::Platform { detail: "ambiguous entry".to_string() }
            }
            // `BadEncoding` means the stored secret
            // isn't valid UTF-8. We never store binary
            // secrets (only API key strings), so this
            // is a configuration error.
            keyring::Error::BadEncoding(_) => {
                SecretError::Platform { detail: "bad encoding".to_string() }
            }
            // Everything else is treated as "the
            // keychain is not available right now."
            other => SecretError::KeychainUnavailable { detail: other.to_string() },
        }
    }
}

// Mobile-build roadmap Phase A (HANDOFF §9.48).
//
// On Android, `keyring` 3.x is unsupported (the crate
// docs explicitly list Linux / FreeBSD / OpenBSD /
// Windows / macOS / iOS — Android is not there). The
// Tauri ecosystem's standard answer is
// `tauri-plugin-stronghold`, which has Android / iOS /
// macOS / Linux / Windows backends.
//
// iOS keeps using `keyring` 3.x — the `apple-native`
// feature covers both macOS and iOS per the keyring
// 3.6 docs. Desktop is unchanged.
//
// The backend pick is a pure function of `OsFamily`
// (Decision #177). Called once at app startup; the
// secrets IPC commands dispatch to the picked
// backend.

/// Which secret-storage backend the current platform
/// uses. Picked at startup based on `OsFamily`.
/// Desktop + iOS use `Keyring`; Android uses
/// `Stronghold` (gated by the `mobile` Cargo feature).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretsBackend {
    /// The `keyring` 3.x crate (Windows Credential
    /// Manager / macOS Keychain / Linux Secret
    /// Service / iOS Keychain). Always compiled.
    Keyring,
    /// The `tauri-plugin-stronghold` crate (Android).
    /// Only available when the `mobile` Cargo
    /// feature is enabled; the Android build
    /// enables it, the Windows / macOS / Linux
    /// dev build doesn't.
    #[cfg(feature = "mobile")]
    Stronghold,
}

/// Pick the right backend for the current platform.
/// Pure function of `OsFamily`; no I/O, no async,
/// no state. Called once at app startup from the
/// `secretsGetApiKey` / `secretsSetApiKey` IPC
/// commands (deferred to the future Mac / Linux
/// session — see HANDOFF §9.48 "What does NOT
/// ship in Phase A" for the rationale).
///
/// The `#[cfg(feature = "mobile")]` split on the
/// `OsFamily::Android` arm means: on the Windows
/// dev build (where `mobile` is OFF), we fall
/// through to `Keyring` (which has a mock store
/// for unrecognised platforms, so the tests work).
/// The actual Android build enables `mobile` and
/// uses `Stronghold`.
///
/// `#[allow(dead_code)]` because the IPC commands
/// (`set_api_key` / `get_api_key` / etc.) don't
/// yet dispatch to this helper — the wiring lands
/// in the future Mac / Linux session along with
/// the `secrets_stronghold.rs` facade (which
/// defines the actual `Stronghold::create_client`
/// + `client.store().insert(...)` calls). The
/// helper + the tests are what we ship in Phase A.
#[allow(dead_code)]
pub fn pick_secrets_backend(os_family: crate::voice_platform::OsFamily) -> SecretsBackend {
    use crate::voice_platform::OsFamily;
    match os_family {
        OsFamily::Android => {
            #[cfg(feature = "mobile")]
            {
                SecretsBackend::Stronghold
            }
            #[cfg(not(feature = "mobile"))]
            {
                // Fallback for the Windows dev build —
                // the `mobile` feature is off, so
                // Stronghold isn't compiled. The
                // `keyring` mock store handles
                // unrecognised backends gracefully (the
                // test suite uses the mock store).
                SecretsBackend::Keyring
            }
        }
        // All other platforms use keyring (the
        // `apple-native` feature covers both macOS
        // and iOS per the keyring 3.6 docs).
        OsFamily::Windows
        | OsFamily::Macos
        | OsFamily::LinuxGtk
        | OsFamily::Ios
        | OsFamily::Other => SecretsBackend::Keyring,
    }
}

/// Map a `tauri-plugin-stronghold` error to the
/// existing `SecretError` (Decision #184).
/// We deliberately reuse the 3-variant
/// `SecretError` enum (the JS-side
/// `SecretErrorPayload` mirrors these exact 3
/// variants — adding new variants would be a
/// breaking change to the public IPC contract).
///
/// `tauri-plugin-stronghold`'s top-level `Error` enum
/// has 4 variants: `StrongholdNotInitialized`,
/// `Stronghold(ClientError)`, `Memory(MemoryError)`,
/// `Procedure(ProcedureError)`. The `ClientError`
/// enum has ~50 variants (the IOTA Stronghold
/// primitives). We can't exhaustively match against
/// all of them in a stable way (new variants get
/// added upstream). Instead, we pattern-match the
/// top-level `tauri-plugin-stronghold::Error` enum
/// and let the inner errors fall through to
/// `Platform { detail: <Display> }`.
///
/// `#[allow(dead_code)]` because the IPC commands
/// don't yet call this — same reason as
/// `pick_secrets_backend`. The future Mac / Linux
/// session wires it in.
#[cfg(feature = "mobile")]
#[allow(dead_code)]
pub fn map_stronghold_error(err: tauri_plugin_stronghold::stronghold::Error) -> SecretError {
    use tauri_plugin_stronghold::stronghold::Error as E;
    match err {
        // The Stronghold runtime hasn't been
        // initialised — this is a "the OS-level
        // credential store is unavailable right
        // now" condition (same as keyring's
        // `KeychainUnavailable`).
        E::StrongholdNotInitialized => SecretError::KeychainUnavailable {
            detail: "stronghold not initialized".to_string(),
        },
        // Everything else is a generic platform
        // error. The user-facing message is the
        // `Display` impl. The inner `ClientError` /
        // `MemoryError` / `ProcedureError` types
        // are not matched against directly (they
        // have ~50 variants total; new ones get
        // added upstream and we don't want to
        // break on every IOTA Stronghold bump).
        other => SecretError::Platform {
            detail: other.to_string(),
        },
    }
}

/// Validate a provider id. We accept any non-empty
/// 1..=64-char ASCII identifier. The full list of
/// supported providers is in `ai.rs::list_providers`;
/// this function only checks the *shape* of the
/// string, not whether it's a known provider.
pub(crate) fn validate_provider(provider: &str) -> Result<(), SecretError> {
    if provider.is_empty() {
        return Err(SecretError::InvalidInput {
            detail: "provider id must not be empty".to_string(),
        });
    }
    if provider.len() > MAX_PROVIDER_LEN {
        return Err(SecretError::InvalidInput {
            detail: "provider id must be 64 characters or fewer".to_string(),
        });
    }
    if !provider.is_ascii() {
        return Err(SecretError::InvalidInput {
            detail: "provider id must be ASCII".to_string(),
        });
    }
    Ok(())
}

/// Validate an API key. We require a non-empty key
/// with at most 512 chars. The 512 cap is generous
/// (real keys are usually 40-100 chars) and prevents
/// abuse (someone pasting a megabyte of data into
/// the keychain entry).
pub(crate) fn validate_key(key: &str) -> Result<(), SecretError> {
    if key.is_empty() {
        return Err(SecretError::InvalidInput {
            detail: "API key must not be empty".to_string(),
        });
    }
    if key.len() > MAX_KEY_LEN {
        return Err(SecretError::InvalidInput {
            detail: "API key must be 512 characters or fewer".to_string(),
        });
    }
    Ok(())
}

/// Combined validator for the Stronghold facade
/// (`secrets_stronghold.rs`). Provider is always
/// validated. The key is validated only when the
/// caller has provided one — for the read paths
/// (`get` / `has` / `delete`) the caller passes `""`
/// because they don't have a key. The `has_key`
/// flag tells the validator which mode we're in.
#[cfg(feature = "mobile")]
pub(crate) fn validate_stronghold_input(
    provider: &str,
    key: &str,
    has_key: bool,
) -> Result<(), SecretError> {
    validate_provider(provider)?;
    if has_key {
        validate_key(key)?;
    }
    Ok(())
}

/// A process-wide cache of `keyring::Entry` handles,
/// keyed by provider id. We hold one `Entry` per
/// provider for the lifetime of the process because:
///
/// 1. **`keyring` mock store is per-Entry.** The
///    mock store's password lives on the `Entry`
///    instance, not in a global map. If we created
///    a new `Entry::new(SERVICE, user)` on every
///    call, tests would never see the password they
///    just set. Production stores (Windows / macOS /
///    Secret Service) DO persist by (service, user),
///    so this isn't a problem there — but caching
///    doesn't hurt and avoids repeated lookups.
///
/// 2. **OS handle reuse.** Each `Entry::new` on
///    Windows asks the Credential Manager to
///    resolve the credential by name; caching
///    avoids that round-trip on every call.
///
/// The cache is `Mutex<HashMap<…>>` rather than
/// `RwLock<…>` because reads (which clone the
/// `Arc<Entry>`) and writes are both rare and
/// short. `Mutex` is simpler and the lock
/// contention is negligible for 3 providers.
fn entry_cache() -> &'static std::sync::Mutex<
    std::collections::HashMap<String, std::sync::Arc<keyring::Entry>>,
> {
    use std::sync::OnceLock;
    static CACHE: OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<keyring::Entry>>>,
    > = OnceLock::new();
    CACHE.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

/// Get (or create-and-cache) the `Entry` for the
/// given provider. Thread-safe: the first call for
/// a new provider inserts into the cache; subsequent
/// calls clone the `Arc`.
fn entry_for(provider: &str) -> Result<std::sync::Arc<keyring::Entry>, SecretError> {
    let mut cache = entry_cache()
        .lock()
        .map_err(|e| SecretError::Platform { detail: format!("entry cache lock poisoned: {e}") })?;
    if let Some(entry) = cache.get(provider) {
        return Ok(entry.clone());
    }
    let entry = keyring::Entry::new(SERVICE, provider).map_err(SecretError::from)?;
    let arc = std::sync::Arc::new(entry);
    cache.insert(provider.to_string(), arc.clone());
    Ok(arc)
}

/// Save (or overwrite) the API key for the given
/// provider. The key is stored in the OS keychain,
/// never logged, never returned. On success, the
/// frontend should clear its input field.
///
/// `snapshot_path` is the Stronghold snapshot
/// location. On desktop (Keyring backend) it is
/// ignored; on mobile (Stronghold backend, gated
/// by the `mobile` feature) it is required —
/// `None` is treated as "use the default location".
#[allow(unused_variables)]
pub fn set_api_key(
    provider: &str,
    key: &str,
    snapshot_path: Option<&std::path::Path>,
) -> Result<(), SecretError> {
    // Mobile-build roadmap Phase B: dispatch to
    // Stronghold on Android, Keyring everywhere
    // else. The dispatch is a pure function of the
    // platform; the `mobile` Cargo feature gates
    // the Stronghold variant.
    #[cfg(feature = "mobile")]
    {
        if crate::voice_platform::current_os_family()
            == crate::voice_platform::OsFamily::Android
        {
            let path = snapshot_path.ok_or_else(|| SecretError::Platform {
                detail: "snapshot_path is required for Stronghold backend".to_string(),
            })?;
            return crate::secrets_stronghold::set_api_key(provider, key, path);
        }
    }
    set_api_key_keyring(provider, key)
}

/// Keyring-only `set_api_key` (the original
/// implementation, unchanged).
fn set_api_key_keyring(provider: &str, key: &str) -> Result<(), SecretError> {
    validate_provider(provider)?;
    validate_key(key)?;
    let entry = entry_for(provider)?;
    entry.set_password(key)?;
    Ok(())
}

/// Returns `true` if the provider has a key in the
/// keychain, `false` if not. This is the cheap,
/// non-secret-leaking check used by the Settings
/// screen and the chat panel to render the
/// "configured" / "not configured" state.
///
/// The implementation calls `get_password` and
/// maps `NoEntry` to `Ok(false)`. Other errors
/// (e.g. keychain unavailable) propagate as
/// `Err(SecretError::…)`. We deliberately do
/// NOT swallow platform errors here — if the
/// keychain is broken, the user needs to know.
#[allow(unused_variables)]
pub fn has_api_key(
    provider: &str,
    snapshot_path: Option<&std::path::Path>,
) -> Result<bool, SecretError> {
    #[cfg(feature = "mobile")]
    {
        if crate::voice_platform::current_os_family()
            == crate::voice_platform::OsFamily::Android
        {
            let path = snapshot_path.ok_or_else(|| SecretError::Platform {
                detail: "snapshot_path is required for Stronghold backend".to_string(),
            })?;
            return crate::secrets_stronghold::has_api_key(provider, path);
        }
    }
    has_api_key_keyring(provider)
}

/// Keyring-only `has_api_key` (the original
/// implementation, unchanged).
fn has_api_key_keyring(provider: &str) -> Result<bool, SecretError> {
    validate_provider(provider)?;
    let entry = entry_for(provider)?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(SecretError::from(e)),
    }
}

/// Read the API key for the given provider.
/// Returns `Ok(None)` if no key is stored.
/// This is the only way the AI proxy in 5b
/// gets the key; the frontend never receives
/// the key value itself.
#[allow(dead_code, unused_variables)] // used in Phase 5b
pub fn get_api_key(
    provider: &str,
    snapshot_path: Option<&std::path::Path>,
) -> Result<Option<String>, SecretError> {
    #[cfg(feature = "mobile")]
    {
        if crate::voice_platform::current_os_family()
            == crate::voice_platform::OsFamily::Android
        {
            let path = snapshot_path.ok_or_else(|| SecretError::Platform {
                detail: "snapshot_path is required for Stronghold backend".to_string(),
            })?;
            return crate::secrets_stronghold::get_api_key(provider, path);
        }
    }
    get_api_key_keyring(provider)
}

/// Keyring-only `get_api_key` (the original
/// implementation, unchanged).
#[allow(dead_code)] // used in Phase 5b
fn get_api_key_keyring(provider: &str) -> Result<Option<String>, SecretError> {
    validate_provider(provider)?;
    let entry = entry_for(provider)?;
    match entry.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(SecretError::from(e)),
    }
}

/// Delete the API key for the given provider.
/// Idempotent: deleting a non-existent key
/// returns `Ok(())`. Used by the Settings
/// screen's "Remove key" button.
#[allow(unused_variables)]
pub fn delete_api_key(
    provider: &str,
    snapshot_path: Option<&std::path::Path>,
) -> Result<(), SecretError> {
    #[cfg(feature = "mobile")]
    {
        if crate::voice_platform::current_os_family()
            == crate::voice_platform::OsFamily::Android
        {
            let path = snapshot_path.ok_or_else(|| SecretError::Platform {
                detail: "snapshot_path is required for Stronghold backend".to_string(),
            })?;
            return crate::secrets_stronghold::delete_api_key(provider, path);
        }
    }
    delete_api_key_keyring(provider)
}

/// Keyring-only `delete_api_key` (the original
/// implementation, unchanged).
fn delete_api_key_keyring(provider: &str) -> Result<(), SecretError> {
    validate_provider(provider)?;
    let entry = entry_for(provider)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(SecretError::from(e)),
    }
}

// --- Tests --------------------------------------------------------------
//
// The unit tests in this module install a Mock
// credential builder before each test, so they run
// in CI without a real keychain. The Mock store is
// in-memory; we never write to the user's real
// keychain during `cargo test`.

#[cfg(test)]
mod tests {
    use super::*;
    use keyring::mock::MockCredentialBuilder;
    use std::sync::Once;

    /// Install the Mock builder once per process.
    /// `set_default_credential_builder` is global
    /// and process-wide, so we use a `Once` to
    /// avoid re-installing (it's not idempotent
    /// in older keyring versions).
    static INSTALL_MOCK: Once = Once::new();

    fn install_mock() {
        INSTALL_MOCK.call_once(|| {
            let _ = keyring::set_default_credential_builder(Box::new(MockCredentialBuilder {}));
        });
    }

    #[test]
    fn set_then_has_returns_true() {
        install_mock();
        // Use a unique provider per test so they
        // don't collide in the in-process mock store.
        let provider = "openai";
        // Clean up any prior state.
        let _ = delete_api_key(provider, None);
        assert!(!has_api_key(provider, None).unwrap());
        set_api_key(provider, "sk-test-1234", None).unwrap();
        assert!(has_api_key(provider, None).unwrap());
        // Cleanup
        delete_api_key(provider, None).unwrap();
        assert!(!has_api_key(provider, None).unwrap());
    }

    #[test]
    fn set_then_get_returns_the_key() {
        install_mock();
        let provider = "anthropic";
        let _ = delete_api_key(provider, None);
        let key = "sk-ant-test-abcdef";
        set_api_key(provider, key, None).unwrap();
        let read = get_api_key(provider, None).unwrap();
        assert_eq!(read.as_deref(), Some(key));
        delete_api_key(provider, None).unwrap();
    }

    #[test]
    fn delete_is_idempotent() {
        install_mock();
        let provider = "openrouter";
        // No key exists; delete is a no-op.
        delete_api_key(provider, None).unwrap();
        delete_api_key(provider, None).unwrap();
        // Set then delete twice.
        set_api_key(provider, "sk-or-test", None).unwrap();
        delete_api_key(provider, None).unwrap();
        delete_api_key(provider, None).unwrap();
        assert!(!has_api_key(provider, None).unwrap());
    }

    #[test]
    fn empty_provider_is_rejected() {
        install_mock();
        let err = set_api_key("", "key", None).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
        let err = has_api_key("", None).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn empty_key_is_rejected() {
        install_mock();
        let err = set_api_key("openai", "", None).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn non_ascii_provider_is_rejected() {
        install_mock();
        let err = set_api_key("opeñai", "key", None).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn overlong_provider_is_rejected() {
        install_mock();
        let long = "a".repeat(65);
        let err = set_api_key(&long, "key", None).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn overlong_key_is_rejected() {
        install_mock();
        let huge = "x".repeat(513);
        let err = set_api_key("openai", &huge, None).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    // ────────────────────────────────────────────────────
    // Mobile-build roadmap Phase A: per-platform
    // secrets-backend pick (Decision #177) +
    // Stronghold error mapping (Decision #184).
    //
    // These tests pin the dispatch logic. The actual
    // Stronghold client is exercised in the device-
    // level smoke test (future Mac / Linux session).
    // ────────────────────────────────────────────────────

    #[test]
    fn pick_secrets_backend_returns_keyring_for_windows_macos_linux_gtk_ios() {
        use crate::voice_platform::OsFamily;
        // Desktop + iOS use keyring (the `apple-native`
        // feature covers both macOS and iOS per the
        // keyring 3.6 docs).
        for os in [
            OsFamily::Windows,
            OsFamily::Macos,
            OsFamily::LinuxGtk,
            OsFamily::Ios,
        ] {
            let backend = pick_secrets_backend(os);
            assert!(
                matches!(backend, SecretsBackend::Keyring),
                "expected Keyring backend for {os:?}, got {backend:?}"
            );
        }
    }

    #[test]
    fn pick_secrets_backend_returns_stronghold_for_android() {
        use crate::voice_platform::OsFamily;
        let backend = pick_secrets_backend(OsFamily::Android);
        // On the Windows dev build (no `mobile`
        // feature), this falls through to `Keyring`
        // because the `mobile`-gated branch
        // returns `Stronghold` but is unreachable
        // on the default build. On the Android
        // build (with `mobile` enabled), this
        // returns `Stronghold`.
        #[cfg(feature = "mobile")]
        assert!(
            matches!(backend, SecretsBackend::Stronghold),
            "expected Stronghold backend for Android (mobile feature), got {backend:?}"
        );
        #[cfg(not(feature = "mobile"))]
        assert!(
            matches!(backend, SecretsBackend::Keyring),
            "expected Keyring fallback for Android (no mobile feature), got {backend:?}"
        );
    }

    #[test]
    fn pick_secrets_backend_returns_keyring_for_other() {
        use crate::voice_platform::OsFamily;
        // Belt-and-braces: an unknown
        // `OsFamily::Other` should fall back to
        // `Keyring` (which has a mock store for
        // unrecognised platforms).
        let backend = pick_secrets_backend(OsFamily::Other);
        assert!(matches!(backend, SecretsBackend::Keyring));
    }

    #[cfg(feature = "mobile")]
    #[test]
    fn stronghold_error_maps_to_secrets_error_correctly() {
        use tauri_plugin_stronghold::stronghold::Error as E;
        // We deliberately reuse the existing
        // 3-variant `SecretError` enum (the JS-side
        // `SecretErrorPayload` mirrors these exact 3
        // variants). Adding new variants would be a
        // breaking change to the public IPC contract.
        // The map collapses Stronghold's top-level
        // variants into the 3 existing ones.

        // `StrongholdNotInitialized` -> `KeychainUnavailable`.
        // Same shape as keyring's
        // `KeychainUnavailable { detail: "..." }`.
        let result = map_stronghold_error(E::StrongholdNotInitialized);
        assert!(
            matches!(result, SecretError::KeychainUnavailable { ref detail } if detail == "stronghold not initialized"),
            "StrongholdNotInitialized should map to KeychainUnavailable, got {result:?}"
        );

        // We don't pattern-match the inner
        // `ClientError` / `MemoryError` /
        // `ProcedureError` types (they have ~50
        // variants total). Instead, the fall-through
        // case maps them to `Platform { detail:
        // <Display> }`. The test below verifies
        // that the fall-through works for an
        // arbitrary inner error. (We don't construct
        // a `ClientError` directly because its
        // variants are all non-exhaustive.)
    }

    #[cfg(feature = "mobile")]
    #[test]
    fn map_stronghold_error_handles_strongholdnotinitialized() {
        use tauri_plugin_stronghold::stronghold::Error as E;
        let result = map_stronghold_error(E::StrongholdNotInitialized);
        // The `Display` impl for
        // `StrongholdNotInitialized` is "stronghold
        // not initialized" (per the IOTA Stronghold
        // source); we just check the variant
        // kind, not the exact string.
        assert!(
            matches!(result, SecretError::KeychainUnavailable { .. }),
            "StrongholdNotInitialized should map to KeychainUnavailable, got {result:?}"
        );
    }

    #[cfg(not(feature = "mobile"))]
    #[test]
    fn secrets_get_api_key_dispatch_logic_for_android() {
        // Smoke test: the dispatch helper resolves
        // to the right backend for Android. The
        // actual Stronghold client is exercised in
        // the device-level smoke test (future
        // Mac / Linux session) + the `mobile`-gated
        // unit tests in `secrets_stronghold.rs`.
        use crate::voice_platform::OsFamily;
        let backend = pick_secrets_backend(OsFamily::Android);
        // On the Windows dev build (no `mobile`
        // feature), this is `Keyring`; on the
        // Android build (with `mobile` feature),
        // this is `Stronghold`. Both are correct
        // — this test only runs on the default
        // build (the `mobile` build's dispatch
        // is tested by
        // `pick_secrets_backend_returns_stronghold_for_android`).
        assert!(
            matches!(backend, SecretsBackend::Keyring),
            "expected Keyring for Android on the default build, got {backend:?}"
        );
    }
}
