//! JNI bridge between `secrets_stronghold.rs` and the
//! Android `StrongholdKeyBridge.kt` plugin. See
//! `docs/plugins/lipi-stronghold-key-bridge/README.md`
//! for the full contract, and Decision #186 for the design
//! rationale.
//!
//! **Stub status**: this file ships with the project as a
//! contract placeholder. The actual JNI invocation (the
//! `extern "C"` calls that find the
//! `lipi/stronghold/StrongholdKeyBridge` class and call
//! its static `loadKey()` method) is the future Mac/Linux
//! session's work — per D-186's implementation plan.
//!
//! Until the JNI is wired:
//! - On `target_os = "android"`, `load_key_from_keystore()`
//!   returns a `SecretError::Platform` with a "not yet
//!   implemented" message. The Stronghold facade catches
//!   this and falls back to the v1 `PLACEHOLDER_KEY` (see
//!   `secrets_stronghold::keyprovider`).
//! - On other mobile targets (iOS — though iOS uses
//!   `keyring` 3.x's `apple-native` feature, not Stronghold),
//!   the function returns a "not supported on this target"
//!   error.
//!
//! Once the future session implements the JNI:
//! 1. Add a `cdylib` target to the Cargo manifest (either
//!    in the main `src-tauri/Cargo.toml` or in a new
//!    workspace crate — see the README §9 for the trade-off).
//! 2. Replace the `#[cfg(target_os = "android")]` arm of
//!    `load_key_from_keystore()` with the actual JNI call
//!    sequence:
//!    - Get the JNIEnv* via `tauri::AppHandle::android_context()`
//!      + `attach_current_thread()`.
//!    - `env.FindClass("lipi/stronghold/StrongholdKeyBridge")`.
//!    - `env.GetStaticMethodID(cls, "loadKey", "()[B")`.
//!    - `env.CallStaticObjectMethod(cls, methodId)`.
//!    - Cast the returned `jbyteArray` to `Vec<u8>`.
//!    - Wrap in `Zeroizing` and return.
//! 3. Update `secrets_stronghold::keyprovider()` to call
//!    `load_key_from_keystore()` and SHA-256 the result.
//! 4. Remove the `PLACEHOLDER_KEY` constant from
//!    `secrets_stronghold.rs` (or keep it as a documented
//!    fallback for broken-Keystore devices).
//! 5. Add a real-device end-to-end test (the
//!    `StrongholdKeyBridgeTest.kt` Robolectric test plus
//!    a device smoke test).

#![cfg(feature = "mobile")]

use zeroize::Zeroizing;

use crate::secrets::SecretError;

/// Canonical Java class name (with `.` replaced by `/`).
/// Matches the `package lipi.stronghold` declaration in
/// `StrongholdKeyBridge.kt`.
#[allow(dead_code)] // used by the future JNI implementation + the tests
const CLASS_NAME: &str = "lipi/stronghold/StrongholdKeyBridge";

/// Canonical JNI method signature for `ByteArray loadKey()`.
/// `() => [B` in JNI type notation.
#[allow(dead_code)] // used by the future JNI implementation + the tests
const LOAD_KEY_SIGNATURE: &str = "()[B";

/// Length of the AES-GCM IV (bytes). The Keystore generates
/// a fresh 12-byte IV on every `Cipher.init()` call.
#[allow(dead_code)] // used to compute EXPECTED_RETURN_LENGTH
const GCM_IV_LENGTH_BYTES: usize = 12;

/// Length of the zero plaintext the bridge encrypts to
/// derive the snapshot key. Must match the `PLACEHOLDER_KEY`
/// length and the `KeyProvider::try_from(Zeroizing<Vec<u8>>)`
/// required length.
#[allow(dead_code)] // used to compute EXPECTED_RETURN_LENGTH
const ZERO_PLAINTEXT_LENGTH_BYTES: usize = 32;

/// Length of the AES-GCM authentication tag (bytes).
/// Appended to the ciphertext by the Keystore.
#[allow(dead_code)] // used to compute EXPECTED_RETURN_LENGTH
const GCM_TAG_LENGTH_BYTES: usize = 16;

/// Total expected return length:
/// `12 (IV) + 32 (plaintext) + 16 (GCM tag) = 60 bytes`.
#[allow(dead_code)] // used by the tests + the future JNI implementation
const EXPECTED_RETURN_LENGTH: usize =
    GCM_IV_LENGTH_BYTES + ZERO_PLAINTEXT_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES;

/// Load the Stronghold snapshot encryption key from the
/// Android Keystore (per D-186). Returns the 60-byte
/// "SHA-256 input material" (12-byte AES-GCM IV + 32-byte
/// ciphertext + 16-byte GCM auth tag). The caller
/// (`secrets_stronghold::keyprovider`) is responsible for
/// SHA-256-ing the returned bytes and using the first 32
/// bytes of the digest as the `KeyProvider` key.
///
/// **Stub status**: returns `SecretError::Platform` on all
/// targets until the JNI is wired. The Stronghold facade
/// catches this and falls back to the v1 `PLACEHOLDER_KEY`.
#[allow(dead_code)] // called by the future keyprovider() swap
pub fn load_key_from_keystore() -> Result<Zeroizing<Vec<u8>>, SecretError> {
    #[cfg(target_os = "android")]
    {
        load_key_from_keystore_android()
    }
    #[cfg(not(target_os = "android"))]
    {
        // The desktop build never enables the `mobile`
        // feature (so this code path is never compiled
        // there). The non-android arm of the cfg is here
        // for completeness in case a future mobile target
        // (e.g. a hypothetical iOS Stronghold backend)
        // needs the same shape.
        let _ = (CLASS_NAME, LOAD_KEY_SIGNATURE, EXPECTED_RETURN_LENGTH);
        Err(SecretError::Platform {
            detail: format!(
                "StrongholdKeyBridge: Android Keystore derivation \
                 not supported on this target (D-186 follow-up). \
                 The v1 PLACEHOLDER_KEY is used as a fallback. \
                 See docs/plugins/lipi-stronghold-key-bridge/README.md."
            ),
        })
    }
}

/// Android-specific stub. The future session replaces this
/// body with the actual JNI invocation.
#[cfg(target_os = "android")]
fn load_key_from_keystore_android() -> Result<Zeroizing<Vec<u8>>, SecretError> {
    // TODO(future-session): the actual JNI implementation.
    //
    // Pseudo-code (requires the `ndk-context` crate OR
    // raw `extern "C"` calls):
    //
    //   let ctx = ndk_context::android_context();
    //   let vm = ctx.vm();
    //   let env = vm.attach_current_thread();
    //
    //   let class = env.find_class(CLASS_NAME)?;
    //   let method_id = env.get_static_method_id(
    //       class, "loadKey", LOAD_KEY_SIGNATURE
    //   )?;
    //   let jbytes = env.call_static_object_method_unchecked::<*mut u8>(
    //       class, method_id, &[]
    //   )?;
    //   let len = env.get_array_length(jbytes);
    //   let mut buf = vec![0u8; len as usize];
    //   env.get_byte_array_region(jbytes, 0, &mut buf);
    //
    //   if buf.len() != EXPECTED_RETURN_LENGTH {
    //       return Err(SecretError::Platform {
    //           detail: format!(
    //               "StrongholdKeyBridge: expected {} bytes, got {}",
    //               EXPECTED_RETURN_LENGTH, buf.len()
    //           ),
    //       });
    //   }
    //
    //   Ok(Zeroizing::new(buf))
    //
    // Until this is wired, the Stronghold facade falls back
    // to PLACEHOLDER_KEY (preserving the v1 behavior).
    let _ = (CLASS_NAME, LOAD_KEY_SIGNATURE, EXPECTED_RETURN_LENGTH);
    Err(SecretError::Platform {
        detail: "StrongholdKeyBridge: JNI not yet wired \
                 (D-186 follow-up; see docs/plugins/lipi-stronghold-key-bridge/README.md §6)."
            .to_string(),
    })
}

// ────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// The stub returns the documented "not implemented"
    /// / "not supported" error on every target. This pins
    /// the contract: a future session that wires the JNI
    /// will need to update this test (and the function
    /// body).
    #[test]
    fn stub_returns_platform_error_with_documented_message() {
        let result = load_key_from_keystore();
        assert!(
            matches!(result, Err(SecretError::Platform { .. })),
            "expected SecretError::Platform, got {result:?}"
        );
        let err = result.unwrap_err();
        let detail = match err {
            SecretError::Platform { detail } => detail,
            _ => unreachable!(),
        };
        assert!(
            detail.contains("StrongholdKeyBridge"),
            "error message should mention StrongholdKeyBridge: {detail}"
        );
        assert!(
            detail.contains("D-186"),
            "error message should reference D-186: {detail}"
        );
    }

    /// The expected return length constant is 60 bytes
    /// (12 IV + 32 plaintext + 16 GCM tag). The future
    /// JNI implementation will use this to validate the
    /// Kotlin-side return value. This test pins the
    /// constant so a refactor that changes the math
    /// (e.g. switching to ChaCha20-Poly1305) breaks the
    /// test loudly.
    #[test]
    fn expected_return_length_matches_aes_gcm_iv_plaintext_tag() {
        assert_eq!(EXPECTED_RETURN_LENGTH, 60);
        assert_eq!(
            GCM_IV_LENGTH_BYTES + ZERO_PLAINTEXT_LENGTH_BYTES + GCM_TAG_LENGTH_BYTES,
            EXPECTED_RETURN_LENGTH
        );
    }

    /// The class name + JNI signature constants match
    /// the Kotlin source. The future JNI implementation
    /// will use these to find the class + method. This
    /// test pins the contract so a Kotlin-side rename
    /// (e.g. `StrongholdKeyBridgeV2`) breaks the test
    /// loudly rather than failing at runtime.
    #[test]
    fn class_name_and_signature_match_kotlin_source() {
        assert_eq!(CLASS_NAME, "lipi/stronghold/StrongholdKeyBridge");
        assert_eq!(LOAD_KEY_SIGNATURE, "()[B");
    }
}
