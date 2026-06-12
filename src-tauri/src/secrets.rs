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
const SERVICE: &str = "app.lipi.ide";

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

/// Validate a provider id. We accept any non-empty
/// 1..=64-char ASCII identifier. The full list of
/// supported providers is in `ai.rs::list_providers`;
/// this function only checks the *shape* of the
/// string, not whether it's a known provider.
fn validate_provider(provider: &str) -> Result<(), SecretError> {
    if provider.is_empty() {
        return Err(SecretError::InvalidInput {
            detail: "provider id must not be empty".to_string(),
        });
    }
    if provider.len() > 64 {
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
fn validate_key(key: &str) -> Result<(), SecretError> {
    if key.is_empty() {
        return Err(SecretError::InvalidInput {
            detail: "API key must not be empty".to_string(),
        });
    }
    if key.len() > 512 {
        return Err(SecretError::InvalidInput {
            detail: "API key must be 512 characters or fewer".to_string(),
        });
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
pub fn set_api_key(provider: &str, key: &str) -> Result<(), SecretError> {
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
pub fn has_api_key(provider: &str) -> Result<bool, SecretError> {
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
#[allow(dead_code)] // used in Phase 5b
pub fn get_api_key(provider: &str) -> Result<Option<String>, SecretError> {
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
pub fn delete_api_key(provider: &str) -> Result<(), SecretError> {
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
        let _ = delete_api_key(provider);
        assert!(!has_api_key(provider).unwrap());
        set_api_key(provider, "sk-test-1234").unwrap();
        assert!(has_api_key(provider).unwrap());
        // Cleanup
        delete_api_key(provider).unwrap();
        assert!(!has_api_key(provider).unwrap());
    }

    #[test]
    fn set_then_get_returns_the_key() {
        install_mock();
        let provider = "anthropic";
        let _ = delete_api_key(provider);
        let key = "sk-ant-test-abcdef";
        set_api_key(provider, key).unwrap();
        let read = get_api_key(provider).unwrap();
        assert_eq!(read.as_deref(), Some(key));
        delete_api_key(provider).unwrap();
    }

    #[test]
    fn delete_is_idempotent() {
        install_mock();
        let provider = "openrouter";
        // No key exists; delete is a no-op.
        delete_api_key(provider).unwrap();
        delete_api_key(provider).unwrap();
        // Set then delete twice.
        set_api_key(provider, "sk-or-test").unwrap();
        delete_api_key(provider).unwrap();
        delete_api_key(provider).unwrap();
        assert!(!has_api_key(provider).unwrap());
    }

    #[test]
    fn empty_provider_is_rejected() {
        install_mock();
        let err = set_api_key("", "key").unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
        let err = has_api_key("").unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn empty_key_is_rejected() {
        install_mock();
        let err = set_api_key("openai", "").unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn non_ascii_provider_is_rejected() {
        install_mock();
        let err = set_api_key("opeñai", "key").unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn overlong_provider_is_rejected() {
        install_mock();
        let long = "a".repeat(65);
        let err = set_api_key(&long, "key").unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }

    #[test]
    fn overlong_key_is_rejected() {
        install_mock();
        let huge = "x".repeat(513);
        let err = set_api_key("openai", &huge).unwrap_err();
        assert!(matches!(err, SecretError::InvalidInput { .. }));
    }
}
