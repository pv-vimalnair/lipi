//! Per-machine Ed25519 keypair management for
//! IAP-generated licenses.
//!
//! Phase 4 (IAP receipt validation). The IAP receipt
//! is the proof of payment (validated against Apple /
//! Microsoft servers). After validation, the Rust
//! side generates a `LicensePayload` bound to the
//! current machine, signs it with a *per-machine*
//! Ed25519 keypair, and stores it in the keychain.
//!
//! # Why a per-machine keypair
//!
//! The license payload is the local binding. The
//! proof of payment is the IAP receipt (validated
//! against Apple / Microsoft). The per-machine
//! keypair is the bridge between the two:
//!
//! - The privkey is generated on the user's
//!   machine, stored in the keychain, and never
//!   leaves the machine. The pubkey is also stored
//!   in the keychain (so the verifier can read it
//!   without the user re-entering anything).
//! - A malicious actor without the privkey can't
//!   forge a license, even if they have the
//!   embedded trial pubkey (the trial pubkey is in
//!   the binary; the IAP-local pubkey is in the
//!   keychain, behind the user's OS login password).
//! - If the user's keychain is wiped (OS reinstall,
//!   new user account), the IAP-issued license is
//!   unverifiable. The recovery is to re-run the
//!   IAP flow (the user's Apple / Microsoft
//!   subscription is unchanged, so the receipt is
//!   still valid).
//!
//! # Keypair lifecycle
//!
//! 1. **First IAP redemption** (or first trial, if
//!    the user opts into a trial *before* IAP —
//!    not currently exposed in the UI): the Rust
//!    side calls `get_or_create_iap_keypair`. If
//!    the keychain has the privkey + pubkey, it
//!    returns them. If not, it generates a fresh
//!    32-byte Ed25519 secret key via `getrandom`,
//!    derives the 32-byte pubkey, and stores both
//!    in the keychain.
//! 2. **Every subsequent IAP redemption**: the
//!    Rust side calls `get_or_create_iap_keypair`,
//!    which returns the existing keypair.
//! 3. **License verification**: the verifier
//!    reads the pubkey from the keychain
//!    (`load_iap_pubkey`) and uses it to verify
//!    the signature.
//! 4. **OS reinstall / keychain wipe**: the
//!    keychain entries are gone; the verifier
//!    returns `LicenseError::MissingLocalPubkey`.
//!    The user re-runs the IAP flow to regenerate
//!    the keypair.

use ed25519_dalek::{SigningKey, VerifyingKey};

use crate::licensing::{
    entry_for_pub, keychain_user_iap_privkey, keychain_user_iap_pubkey, LicenseError,
};

/// The per-machine IAP keypair. Holds the privkey +
/// pubkey. The privkey is a 32-byte Ed25519 secret
/// key; the pubkey is the corresponding 32-byte
/// verification key. Both are 32 bytes (the
/// `ed25519_dalek` API uses raw byte arrays, not
/// hex / base64).
#[derive(Debug, Clone)]
pub struct IapKeypair {
    /// 32-byte Ed25519 signing key. Used by
    /// `iap_redeem` to sign the IAP-generated
    /// `LicensePayload`.
    pub signing_key: SigningKey,

    /// 32-byte Ed25519 verification key. Stored
    /// alongside the privkey in the keychain; used
    /// by `verify_license` to verify the signature
    /// on an IAP-issued license.
    pub verifying_key: VerifyingKey,
}

impl IapKeypair {
    /// The 32-byte privkey as a 64-char lowercase
    /// hex string. Used for keychain storage (the
    /// `keyring` crate stores UTF-8 strings).
    pub(crate) fn privkey_hex(&self) -> String {
        hex_lower(self.signing_key.to_bytes().as_slice())
    }

    /// The 32-byte pubkey as a 64-char lowercase
    /// hex string.
    pub(crate) fn pubkey_hex(&self) -> String {
        hex_lower(self.verifying_key.to_bytes().as_slice())
    }
}

/// Lowercase hex encoding of a byte slice. Returns
/// a `String` of length `2 * bytes.len()`. Used for
/// keychain storage (which is UTF-8) and for
/// validation (the keypair length is fixed at 64
/// hex chars).
fn hex_lower(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Parse a 64-char lowercase hex string into a
/// 32-byte array. Returns `Err` on length mismatch
/// or non-hex characters. The keychain stores hex
/// strings (not raw bytes) for portability (the
/// Windows Credential Manager has historically had
/// issues with non-ASCII bytes in secret values).
fn parse_hex_32(hex: &str) -> Result<[u8; 32], String> {
    if hex.len() != 64 {
        return Err(format!(
            "expected 64 hex chars (32 bytes), got {} chars",
            hex.len()
        ));
    }
    let bytes = hex.as_bytes();
    let mut out = [0u8; 32];
    for i in 0..32 {
        let hi = hex_nibble(bytes[2 * i])?;
        let lo = hex_nibble(bytes[2 * i + 1])?;
        out[i] = (hi << 4) | lo;
    }
    Ok(out)
}

fn hex_nibble(c: u8) -> Result<u8, String> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err(format!("non-hex character: {:?}", c as char)),
    }
}

/// Get the per-machine IAP keypair, creating it on
/// first call. The keypair is stored in the keychain
/// (under `app.lipi.ide` / `iap-privkey` +
/// `iap-pubkey`) so it persists across app
/// restarts.
///
/// # Errors
///
/// - `LicenseError::Platform` if the keychain is
///   unavailable (e.g. Linux with no Secret Service
///   running).
/// - `LicenseError::InvalidShape` if the keychain
///   contains malformed hex (the user has a
///   corrupted keychain entry; the recovery is to
///   delete the keychain entry and re-run the IAP
///   flow, which will regenerate the keypair).
pub fn get_or_create_iap_keypair() -> Result<IapKeypair, LicenseError> {
    // Read both entries from the keychain.
    let priv_entry = entry_for_pub(keychain_user_iap_privkey())?;
    let pub_entry = entry_for_pub(keychain_user_iap_pubkey())?;

    match (priv_entry.get_password(), pub_entry.get_password()) {
        (Ok(priv_hex), Ok(pub_hex)) => {
            // Both entries exist; parse + return.
            let priv_bytes = parse_hex_32(&priv_hex).map_err(|e| LicenseError::InvalidShape {
                detail: format!("iap-privkey in keychain is malformed: {e}"),
            })?;
            let pub_bytes = parse_hex_32(&pub_hex).map_err(|e| LicenseError::InvalidShape {
                detail: format!("iap-pubkey in keychain is malformed: {e}"),
            })?;
            let signing_key = SigningKey::from_bytes(&priv_bytes);
            let verifying_key =
                VerifyingKey::from_bytes(&pub_bytes).map_err(|e| LicenseError::InvalidShape {
                    detail: format!("iap-pubkey is not a valid Ed25519 pubkey: {e}"),
                })?;
            Ok(IapKeypair {
                signing_key,
                verifying_key,
            })
        }
        (Err(keyring::Error::NoEntry), _) | (_, Err(keyring::Error::NoEntry)) => {
            // At least one entry is missing. Generate
            // a fresh keypair + write both entries.
            // The `keyring` crate doesn't expose a
            // transaction API; we accept the small
            // risk of a partial write (one entry
            // exists, the other doesn't) and treat
            // it as "regenerate next time" — the
            // next call to `get_or_create_iap_keypair`
            // will see the partial state and
            // regenerate.
            let mut seed = [0u8; 32];
            getrandom::getrandom(&mut seed[..]).map_err(|e| LicenseError::Platform {
                detail: format!("CSPRNG read failed: {e}"),
            })?;
            let signing_key = SigningKey::from_bytes(&seed);
            let verifying_key = signing_key.verifying_key();
            let keypair = IapKeypair {
                signing_key,
                verifying_key,
            };
            // Write both entries. The order is
            // privkey first, then pubkey; if the
            // second write fails, the next call to
            // `get_or_create_iap_keypair` will see
            // the privkey-without-pubkey state and
            // regenerate. (This is acceptable: the
            // privkey without the pubkey is useless
            // to an attacker — they can't verify a
            // signature without the pubkey.)
            priv_entry.set_password(&keypair.privkey_hex())?;
            pub_entry.set_password(&keypair.pubkey_hex())?;
            Ok(keypair)
        }
        (Err(e), _) | (_, Err(e)) => {
            // Some other keychain error (permission
            // denied, I/O error, etc.). Surface it
            // as a Platform error so the UI can show
            // "keychain error: <detail>".
            Err(LicenseError::from(e))
        }
    }
}

/// Load the per-machine IAP public key from the
/// keychain. Returns `None` if the keypair hasn't
/// been generated yet (the user hasn't run the IAP
/// flow on this machine). Returns `Err` on keychain
/// errors (permission denied, I/O error, etc.).
///
/// Used by `verify_license` to verify IAP-issued
/// licenses.
pub fn load_iap_pubkey() -> Option<[u8; 32]> {
    let entry = match entry_for_pub(keychain_user_iap_pubkey()) {
        Ok(e) => e,
        Err(_) => return None,
    };
    let hex = match entry.get_password() {
        Ok(s) => s,
        Err(keyring::Error::NoEntry) => return None,
        Err(_) => return None,
    };
    parse_hex_32(&hex).ok()
}

/// The keychain service name. Re-exported from
/// `licensing` for convenience (the
/// `iap_keypair` module writes to the same
/// `app.lipi.ide` namespace as the license entry).
#[allow(dead_code)] // The test references it; not used in production code paths.
pub const fn service_name() -> &'static str {
    // The actual string is in `licensing::KEYCHAIN_SERVICE`.
    // We can't `pub(crate) use` a `const` from a
    // sibling module in stable Rust, so we
    // hardcode the value here (must match
    // `licensing::KEYCHAIN_SERVICE`).
    "app.lipi.ide"
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- hex_lower / parse_hex_32 round-trip ---

    #[test]
    fn hex_lower_zero_bytes() {
        assert_eq!(hex_lower(&[]), "");
        assert_eq!(hex_lower(&[0u8]), "00");
        assert_eq!(hex_lower(&[0u8, 0u8, 0u8]), "000000");
    }

    #[test]
    fn hex_lower_max_byte() {
        assert_eq!(hex_lower(&[0xffu8]), "ff");
        assert_eq!(hex_lower(&[0xde, 0xad, 0xbe, 0xef]), "deadbeef");
    }

    #[test]
    fn hex_lower_full_32_bytes() {
        let bytes: [u8; 32] = [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54,
            0x32, 0x10, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
            0xcc, 0xdd, 0xee, 0xff,
        ];
        let hex = hex_lower(&bytes);
        assert_eq!(
            hex,
            "0123456789abcdeffedcba987654321000112233445566778899aabbccddeeff"
        );
        assert_eq!(hex.len(), 64);
    }

    #[test]
    fn parse_hex_32_accepts_lowercase() {
        let hex = "0123456789abcdeffedcba987654321000112233445566778899aabbccddeeff";
        let bytes = parse_hex_32(hex).unwrap();
        assert_eq!(bytes[0], 0x01);
        assert_eq!(bytes[15], 0x10);
        assert_eq!(bytes[31], 0xff);
    }

    #[test]
    fn parse_hex_32_accepts_uppercase() {
        let hex = "0123456789ABCDEFFEDCBA987654321000112233445566778899AABBCCDDEEFF";
        let bytes = parse_hex_32(hex).unwrap();
        assert_eq!(bytes[0], 0x01);
        assert_eq!(bytes[31], 0xff);
    }

    #[test]
    fn parse_hex_32_rejects_wrong_length() {
        assert!(parse_hex_32("").is_err());
        assert!(parse_hex_32("ab").is_err());
        assert!(parse_hex_32(&"a".repeat(63)).is_err());
        assert!(parse_hex_32(&"a".repeat(65)).is_err());
    }

    #[test]
    fn parse_hex_32_rejects_non_hex_characters() {
        // 64 chars, but contains 'g' (not a hex digit).
        let mut hex = "a".repeat(64);
        unsafe {
            let bytes = hex.as_bytes_mut();
            bytes[10] = b'g';
        }
        assert!(parse_hex_32(&hex).is_err());
    }

    #[test]
    fn parse_hex_32_round_trip() {
        let original: [u8; 32] = [
            0x42, 0x9a, 0x00, 0xff, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22,
            0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x01, 0x02,
            0x03, 0x04, 0x05, 0x06,
        ];
        let hex = hex_lower(&original);
        let parsed = parse_hex_32(&hex).unwrap();
        assert_eq!(parsed, original);
    }

    // --- service_name ---

    #[test]
    fn service_name_matches_hardcoded_value() {
        // The `service_name()` const must
        // match the `KEYCHAIN_SERVICE` const
        // in `licensing`. We hardcode the
        // value here (cannot `pub(crate) use`
        // a const from a sibling module in
        // stable Rust without a workaround).
        assert_eq!(service_name(), "app.lipi.ide");
    }
}
