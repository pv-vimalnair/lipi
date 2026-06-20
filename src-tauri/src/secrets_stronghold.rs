//! Stronghold-backed secrets facade for Android (Phase mobile-build
//! roadmap Phase B — Windows-doable seam).
//!
//! On Android, the `keyring` 3.x crate has no backend
//! (`keyring` 3.6 lists Linux / FreeBSD / OpenBSD /
//! Windows / macOS / iOS — Android is not there). The
//! Tauri ecosystem's standard answer is
//! `tauri-plugin-stronghold`, which has an Android
//! backend via the IOTA Stronghold encrypted database
//! (a snapshot file at `app_local_data_dir()/vault.hold`).
//!
//! ## Why a Rust-side facade (not just the JS bindings)
//!
//! The `tauri-plugin-stronghold` plugin exposes its
//! operations through the JS guest API
//! (`@tauri-apps/plugin-stronghold`). Our existing
//! secrets IPC contract — `secrets_set_api_key` /
//! `secrets_get_api_key` / `secrets_has_api_key` /
//! `secrets_delete_api_key` — is **Rust-side**: the
//! `set_api_key` / `get_api_key` / `has_api_key` /
//! `delete_api_key` functions in `secrets.rs` are the
//! authoritative entry points. To keep that contract
//! stable across the desktop (Keyring) and mobile
//! (Stronghold) builds, we need a Rust-side facade
//! that does the Stronghold ops in-process and returns
//! the same `SecretError` enum the Keyring path uses.
//!
//! ## Architecture
//!
//! - **Process-wide `Stronghold` instance** held in a
//!   `Mutex<Option<(PathBuf, Stronghold)>>`. We don't
//!   open the snapshot on every call — that's a
//!   `read()` + decryption per op, way too slow. One
//!   instance per process; the `Mutex` is taken for
//!   the duration of the op. The `Option` lets us
//!   reset for tests (and is a no-op in production
//!   after first init).
//! - **One client per process** — `client_path` =
//!   `b"lipi"`. All AI provider keys live in this
//!   client's store, keyed by the provider id
//!   (`openai` / `anthropic` / `openrouter` / etc.).
//! - **Snapshot path** =
//!   `<app_local_data_dir>/lipi.stronghold.hold`.
//!   The `app_local_data_dir()` is platform-correct
//!   (Android: `/data/data/app.lipi.ide/files/`).
//! - **Encryption key** - production builds derive the
//!   Stronghold key from Android Keystore bridge material.
//!   If the bridge is unavailable, Stronghold fails closed
//!   instead of falling back to a hardcoded key.
//!
//! ## Persistence flow
//!
//! 1. On the first call: load the snapshot (if it
//!    exists) using the key, then `create_client` (the
//!    client is in-memory, not in the snapshot yet).
//! 2. `set` / `delete` ops modify the client's store
//!    in-memory, then `commit_with_keyprovider` to
//!    encrypt + write the snapshot.
//! 3. `get` / `has` ops are pure read; no commit.
//!
//! ## Error mapping
//!
//! Stronghold's `ClientError` is mapped to our existing
//! 3-variant `SecretError` (see `map_stronghold_error`
//! in `secrets.rs`, Decision #184). The mapping is
//! already tested by `secrets::tests::stronghold_error_maps_to_secrets_error_correctly`.
//!
//! ## Test strategy
//!
//! All unit tests are gated `#[cfg(feature = "mobile")]`
//! because they need `iota_stronghold` (a `mobile`-
//! only optional dep). They use a tempdir for the
//! snapshot so each test is isolated. The tests
//! exercise the full round-trip (set / get / has /
//! delete + reload-from-snapshot) on real `Stronghold`
//! operations.

#![cfg(feature = "mobile")]

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use zeroize::Zeroizing;

use iota_stronghold::{KeyProvider, SnapshotPath, Stronghold};
#[cfg(not(test))]
use sha2::{Digest, Sha256};

use crate::secrets::{SecretError, SERVICE};

/// The Stronghold client path. One client per process;
/// the AI provider API keys are stored as separate
/// records in this client's `Store`, keyed by provider id.
const CLIENT_PATH: &[u8] = b"lipi";

/// The Stronghold snapshot filename (relative to
/// `app_local_data_dir`). The extension `.hold` is
/// the IOTA Stronghold convention (matches the JS-side
/// `Stronghold.load(vaultPath, vaultPassword)` example).
const SNAPSHOT_FILENAME: &str = "lipi.stronghold.hold";

/// Stronghold keys are derived from Android Keystore
/// bridge material in production. Unit tests use a
/// deterministic test-only key so they can run on
/// non-Android development machines.
/// Process-wide Stronghold state. The `Option` lets us
/// reset for tests (the production code never resets).
/// The `PathBuf` is the snapshot path the `Stronghold`
/// instance was loaded from; the `get_or_init` helper
/// detects path changes and re-initialises.
type State = Option<(PathBuf, Stronghold)>;

static STRONGHOLD: Mutex<State> = Mutex::new(None);

/// Resolve the snapshot path from the app's
/// `local_data_dir`. The caller (`secrets_set_api_key`
/// / `get` / etc.) is responsible for resolving
/// `app_local_data_dir()` (it needs the Tauri `AppHandle`).
#[allow(dead_code)] // used by lib.rs's `resolve_snapshot_path`
pub fn snapshot_path_for(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SNAPSHOT_FILENAME)
}

/// Load (or create) the Stronghold instance and its
/// one client. Idempotent for the same `snapshot_path`:
/// subsequent calls with the same path return the
/// existing instance. A different path triggers a
/// full re-init (this is the test-reset path).
fn get_or_init(snapshot_path: &Path) -> Result<(), SecretError> {
    let mut guard = STRONGHOLD.lock().map_err(|e| SecretError::Platform {
        detail: format!("stronghold mutex poisoned: {e}"),
    })?;
    // Fast path: already initialised for this path.
    if let Some((cached_path, _)) = guard.as_ref() {
        if cached_path == snapshot_path {
            return Ok(());
        }
    }
    // (Re)initialise. If the path changed, the old
    // instance is dropped.
    let stronghold = Stronghold::default();
    let snapshot = SnapshotPath::from_path(snapshot_path);
    if snapshot.exists() {
        // Existing snapshot: load + decrypt with the
        // Android-Keystore-derived key. If the bridge
        // is unavailable, fail closed instead of using
        // a known fallback key.
        let keyprovider = keyprovider()?;
        stronghold
            .load_snapshot(&keyprovider, &snapshot)
            .map_err(|e| SecretError::KeychainUnavailable {
                detail: format!("snapshot load failed: {e}"),
            })?;
    }
    // Acquire (or create) the in-memory client.
    // After a `load_snapshot`, the client data
    // is in the snapshot; `get_client` returns
    // the existing in-memory client, or errors
    // if none. `load_client` loads the client
    // from the snapshot data. We try `get_client`
    // first, then fall back to `create_client`
    // (for the very first launch when the snapshot
    // is empty / doesn't exist).
    if stronghold.get_client(CLIENT_PATH).is_err() {
        if stronghold.load_client(CLIENT_PATH).is_err() {
            // No client in snapshot — create one.
            // `create_client` is the only path
            // that adds a brand-new client. The
            // next `commit_with_keyprovider` writes
            // it to disk.
            stronghold
                .create_client(CLIENT_PATH)
                .map_err(|e| SecretError::Platform {
                    detail: format!("create_client failed: {e}"),
                })?;
        }
    }
    *guard = Some((snapshot_path.to_path_buf(), stronghold));
    Ok(())
}

/// Acquire the Stronghold mutex. Panics if the
/// `Mutex` is uninitialised (which means
/// `get_or_init` was never called — a programming
/// error).
fn lock() -> Result<std::sync::MutexGuard<'static, State>, SecretError> {
    STRONGHOLD.lock().map_err(|e| SecretError::Platform {
        detail: format!("stronghold mutex poisoned: {e}"),
    })
}

/// Build the `KeyProvider` from Android-Keystore material.
/// `commit_with_keyprovider` takes it by value; the
/// `KeyProvider` zeroizes the key on drop.
fn keyprovider() -> Result<KeyProvider, SecretError> {
    let key = stronghold_key()?;
    KeyProvider::try_from(key).map_err(|e| SecretError::KeychainUnavailable {
        detail: format!("keyprovider init failed: {e}"),
    })
}

fn stronghold_key() -> Result<Zeroizing<Vec<u8>>, SecretError> {
    #[cfg(test)]
    {
        return Ok(Zeroizing::new(b"lipi-stronghold-test-key-32bytes".to_vec()));
    }

    #[cfg(not(test))]
    {
        let material = crate::secrets_stronghold_key_bridge::load_key_from_keystore()?;
        let digest = Sha256::digest(material.as_slice());
        Ok(Zeroizing::new(digest.to_vec()))
    }
}

/// Save (or overwrite) the API key for the given
/// provider. The key is stored in the Stronghold
/// snapshot, never logged, never returned. On
/// success, the frontend should clear its input
/// field.
pub fn set_api_key(provider: &str, key: &str, snapshot_path: &Path) -> Result<(), SecretError> {
    // Validate first — same rules as the Keyring path
    // (provider / key non-empty, ASCII).
    crate::secrets::validate_stronghold_input(provider, key, true)?;

    get_or_init(snapshot_path)?;
    let mut guard = lock()?;
    let (_, stronghold) = guard.as_mut().ok_or_else(|| SecretError::Platform {
        detail: "stronghold not initialised after get_or_init".to_string(),
    })?;
    let client = stronghold
        .get_client(CLIENT_PATH)
        .map_err(|e| SecretError::Platform {
            detail: format!("get_client failed: {e}"),
        })?;
    let store = client.store();
    store
        .insert(provider.as_bytes().to_vec(), key.as_bytes().to_vec(), None)
        .map_err(|e| SecretError::Platform {
            detail: format!("store.insert failed: {e}"),
        })?;
    // Persist to disk.
    let snapshot = SnapshotPath::from_path(snapshot_path);
    let kp = keyprovider()?;
    stronghold
        .commit_with_keyprovider(&snapshot, &kp)
        .map_err(|e| SecretError::Platform {
            detail: format!("commit failed: {e}"),
        })?;
    Ok(())
}

/// Returns `true` if the provider has a key in the
/// Stronghold store, `false` if not. Pure read; no
/// commit.
pub fn has_api_key(provider: &str, snapshot_path: &Path) -> Result<bool, SecretError> {
    crate::secrets::validate_stronghold_input(provider, "", false)?;
    get_or_init(snapshot_path)?;
    let guard = lock()?;
    let (_, stronghold) = guard.as_ref().ok_or_else(|| SecretError::Platform {
        detail: "stronghold not initialised after get_or_init".to_string(),
    })?;
    let client = stronghold
        .get_client(CLIENT_PATH)
        .map_err(|e| SecretError::Platform {
            detail: format!("get_client failed: {e}"),
        })?;
    let store = client.store();
    store
        .contains_key(provider.as_bytes())
        .map_err(|e| SecretError::Platform {
            detail: format!("store.contains_key failed: {e}"),
        })
}

/// Read the API key for the given provider. Returns
/// `Ok(None)` if no key is stored. Pure read; no
/// commit.
pub fn get_api_key(provider: &str, snapshot_path: &Path) -> Result<Option<String>, SecretError> {
    crate::secrets::validate_stronghold_input(provider, "", false)?;
    get_or_init(snapshot_path)?;
    let guard = lock()?;
    let (_, stronghold) = guard.as_ref().ok_or_else(|| SecretError::Platform {
        detail: "stronghold not initialised after get_or_init".to_string(),
    })?;
    let client = stronghold
        .get_client(CLIENT_PATH)
        .map_err(|e| SecretError::Platform {
            detail: format!("get_client failed: {e}"),
        })?;
    let store = client.store();
    match store
        .get(provider.as_bytes())
        .map_err(|e| SecretError::Platform {
            detail: format!("store.get failed: {e}"),
        })? {
        Some(bytes) => Ok(Some(String::from_utf8(bytes).map_err(|e| {
            SecretError::Platform {
                detail: format!("stored key is not valid UTF-8: {e}"),
            }
        })?)),
        None => Ok(None),
    }
}

/// Delete the API key for the given provider.
/// Idempotent: deleting a non-existent key returns
/// `Ok(())`. Commits the change to the snapshot.
pub fn delete_api_key(provider: &str, snapshot_path: &Path) -> Result<(), SecretError> {
    crate::secrets::validate_stronghold_input(provider, "", false)?;
    get_or_init(snapshot_path)?;
    let mut guard = lock()?;
    let (_, stronghold) = guard.as_mut().ok_or_else(|| SecretError::Platform {
        detail: "stronghold not initialised after get_or_init".to_string(),
    })?;
    let client = stronghold
        .get_client(CLIENT_PATH)
        .map_err(|e| SecretError::Platform {
            detail: format!("get_client failed: {e}"),
        })?;
    let store = client.store();
    // `store.delete` returns `Ok(None)` if the key
    // wasn't there — exactly the "idempotent" semantics
    // the Keyring path provides.
    let _ = store
        .delete(provider.as_bytes())
        .map_err(|e| SecretError::Platform {
            detail: format!("store.delete failed: {e}"),
        })?;
    // Persist the deletion.
    let snapshot = SnapshotPath::from_path(snapshot_path);
    let kp = keyprovider()?;
    stronghold
        .commit_with_keyprovider(&snapshot, &kp)
        .map_err(|e| SecretError::Platform {
            detail: format!("commit failed: {e}"),
        })?;
    Ok(())
}

// Reference SERVICE so the unused-import lint
// doesn't trip on the test-only build.
const _: () = {
    let _ = SERVICE;
};

// ────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::Mutex as StdMutex;
    use tempfile::TempDir;

    /// Tests run in parallel by default in Cargo; the
    /// `STRONGHOLD` static is shared across all tests,
    /// so we serialise the entire suite through this
    /// `TEST_LOCK` to keep state from leaking between
    /// tests. Each test gets a unique snapshot path
    /// (via `tempfile::TempDir`), and the `reset_state`
    /// helper clears the `STRONGHOLD` static before
    /// the test body runs.
    static TEST_LOCK: StdMutex<()> = StdMutex::new(());

    /// Wipe the process-wide `STRONGHOLD` state. The
    /// next `get_or_init` call will load fresh from
    /// the new `snapshot_path`. This is the test-only
    /// reset path; production code never calls it.
    fn reset_state() {
        let mut guard = STRONGHOLD.lock().expect("stronghold lock poisoned");
        *guard = None;
    }

    /// Fresh snapshot path per test. We use
    /// `tempfile::TempDir` to avoid leaking the snapshot
    /// file across tests.
    fn fresh_snapshot() -> (TempDir, PathBuf) {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(SNAPSHOT_FILENAME);
        // Pre-clear the global state so the next
        // get_or_init picks up our tempdir path.
        reset_state();
        (dir, path)
    }

    #[test]
    fn set_then_has_returns_true() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        set_api_key("openai", "sk-test-1234", &path).expect("set");
        assert_eq!(has_api_key("openai", &path).expect("has"), true);
    }

    #[test]
    fn test_stronghold_key_is_32_bytes_and_not_legacy_placeholder() {
        let key = stronghold_key().expect("test key");
        assert_eq!(key.len(), 32);
        let legacy = [
            b"Lipi-stronghold-v1-".as_slice(),
            b"placeholder!!".as_slice(),
        ]
        .concat();
        assert_ne!(key.as_slice(), legacy.as_slice());
    }

    #[test]
    fn source_does_not_define_legacy_placeholder_key_constant() {
        let source = include_str!("secrets_stronghold.rs");
        let forbidden = concat!("const ", "PLACEHOLDER_KEY");
        assert!(
            !source.contains(forbidden),
            "production code must not define the legacy placeholder key"
        );
    }

    #[test]
    fn set_then_get_returns_the_key() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        set_api_key("openai", "sk-test-1234", &path).expect("set");
        let got = get_api_key("openai", &path).expect("get");
        assert_eq!(got, Some("sk-test-1234".to_string()));
    }

    #[test]
    fn get_returns_none_when_absent() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        let got = get_api_key("nonexistent", &path).expect("get");
        assert_eq!(got, None);
    }

    #[test]
    fn has_returns_false_when_absent() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        assert_eq!(has_api_key("nonexistent", &path).expect("has"), false);
    }

    #[test]
    fn delete_then_get_returns_none() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        set_api_key("openai", "sk-test-1234", &path).expect("set");
        delete_api_key("openai", &path).expect("delete");
        assert_eq!(get_api_key("openai", &path).expect("get"), None);
    }

    #[test]
    fn delete_is_idempotent() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        // No prior set; delete is a no-op.
        delete_api_key("never-set", &path).expect("delete on missing key");
    }

    #[test]
    fn set_then_set_overwrites() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        set_api_key("openai", "first", &path).expect("set 1");
        set_api_key("openai", "second", &path).expect("set 2");
        let got = get_api_key("openai", &path).expect("get");
        assert_eq!(got, Some("second".to_string()));
    }

    #[test]
    fn round_trip_across_reload() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        set_api_key("openai", "sk-reload-1", &path).expect("set");
        set_api_key("anthropic", "sk-reload-2", &path).expect("set 2");
        // Drop the in-memory Stronghold; the snapshot
        // file persists.
        reset_state();
        // Next call re-initialises from disk.
        let got_openai = get_api_key("openai", &path).expect("reload openai");
        let got_anthropic = get_api_key("anthropic", &path).expect("reload anthropic");
        assert_eq!(got_openai, Some("sk-reload-1".to_string()));
        assert_eq!(got_anthropic, Some("sk-reload-2".to_string()));
    }

    #[test]
    fn set_rejects_empty_provider() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        let result = set_api_key("", "sk-test", &path);
        assert!(
            matches!(result, Err(SecretError::InvalidInput { .. })),
            "expected InvalidInput for empty provider, got {result:?}"
        );
    }

    #[test]
    fn set_rejects_empty_key() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        let result = set_api_key("openai", "", &path);
        assert!(
            matches!(result, Err(SecretError::InvalidInput { .. })),
            "expected InvalidInput for empty key, got {result:?}"
        );
    }

    #[test]
    fn set_rejects_non_ascii_provider() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        let result = set_api_key("opénai", "sk-test", &path);
        assert!(
            matches!(result, Err(SecretError::InvalidInput { .. })),
            "expected InvalidInput for non-ASCII provider, got {result:?}"
        );
    }

    #[test]
    fn set_rejects_overlong_key() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        let long_key: String = "a".repeat(crate::secrets::MAX_KEY_LEN + 1);
        let result = set_api_key("openai", &long_key, &path);
        assert!(
            matches!(result, Err(SecretError::InvalidInput { .. })),
            "expected InvalidInput for overlong key, got {result:?}"
        );
    }

    #[test]
    fn snapshot_file_is_created_on_first_set() {
        let _lock = TEST_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let (_dir, path) = fresh_snapshot();
        // Snapshot doesn't exist yet.
        assert!(!path.exists(), "snapshot should not exist before set");
        set_api_key("openai", "sk-first", &path).expect("set");
        // After set, the snapshot file should exist.
        assert!(path.exists(), "snapshot should exist after set");
        // And it should be non-empty.
        let metadata = fs::metadata(&path).expect("metadata");
        assert!(metadata.len() > 0, "snapshot should be non-empty");
    }
}
