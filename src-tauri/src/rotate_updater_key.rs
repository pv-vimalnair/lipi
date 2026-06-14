//! Phase 5: pure logic for the `rotate_updater_key`
//! CLI.
//!
//! This module is the *library* version of the CLI:
//! it contains the pure functions (argument parsing,
//! pubkey validation, JSON patching, diff printing)
//! that the `rotate_updater_key` binary in
//! `src/bin/rotate_updater_key.rs` shells out to.
//!
//! Why split? On Windows, `cargo test --bin …` for
//! binaries that are not the main `lipi` binary
//! sometimes hits an elevation error (os error 740)
//! that prevents the test runner from spawning the
//! test executable. Putting the logic in a library
//! module + a thin bin wrapper means the tests run
//! via `cargo test --lib` (which is reliable on
//! Windows) and the bin just does I/O + exit codes.
//!
//! See `src/bin/rotate_updater_key.rs` for the
//! binary, `docs/plans/prod-p5-release-pipeline-design.md`
//! for the design rationale, and
//! `docs/decisions/0094-p5-prod-keypair.md` for the
//! "why a separate prod + dev keypair" decision.

#![cfg(not(mobile))]

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

/// The minimum expected decoded length of a Tauri
/// updater pubkey. A real key is ~120 bytes (the
/// SPKI + the leading "untrusted comment: ..." line);
/// we check >= 32 to be lenient.
pub const MIN_PUBKEY_DECODED_LEN: usize = 32;

/// The Tauri "minisign public key" comment marker
/// that prefixes every updater pubkey. The
/// pubkey file format is:
///
/// ```text
/// untrusted comment: minisign public key XXXXX
/// <base64 SPKI>
/// =====
/// ```
pub const TAURI_PUBKEY_PREFIX: &str = "untrusted comment:";

/// Parsed CLI arguments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Args {
    pub pubkey_file: String,
    pub tauri_conf: String,
}

/// Parse the CLI args. Returns an error message
/// (printed to stderr by the caller) on bad input.
pub fn parse_args(argv: &[String]) -> Result<Args, String> {
    let mut pubkey_file: Option<String> = None;
    let mut tauri_conf: Option<String> = None;

    let mut iter = argv.iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--pubkey-file" => {
                pubkey_file = iter.next().cloned();
            }
            "--tauri-conf" => {
                tauri_conf = iter.next().cloned();
            }
            other => {
                return Err(format!("unknown argument: {other}"));
            }
        }
    }

    let pubkey_file =
        pubkey_file.ok_or_else(|| "missing --pubkey-file <path>".to_string())?;
    let tauri_conf =
        tauri_conf.unwrap_or_else(|| "src-tauri/tauri.conf.json".to_string());

    Ok(Args {
        pubkey_file,
        tauri_conf,
    })
}

/// Validate a Tauri updater pubkey. Returns the
/// canonical (single-line) pubkey string suitable
/// for embedding in `tauri.conf.json`.
///
/// The pubkey file format is:
///
/// ```text
/// untrusted comment: minisign public key XXXXX
/// <base64 SPKI>
/// =====
/// ```
///
/// We extract the base64 portion, validate it
/// (must be valid base64 + must decode to >= 32
/// bytes), and return it as a single string (the
/// comment lines are stripped — Tauri only stores
/// the base64 in `tauri.conf.json`).
pub fn validate_pubkey(text: &str) -> Result<String, String> {
    let mut lines = text.lines();
    let prefix_line = lines
        .next()
        .ok_or_else(|| "pubkey file is empty".to_string())?;
    if !prefix_line.starts_with(TAURI_PUBKEY_PREFIX) {
        return Err(format!(
            "first line must start with {TAURI_PUBKEY_PREFIX:?}, got: {prefix_line:?}"
        ));
    }

    let base64_line = lines
        .next()
        .ok_or_else(|| "pubkey file is missing the base64 line".to_string())?
        .trim();

    let decoded = STANDARD
        .decode(base64_line)
        .map_err(|e| format!("not valid base64: {e}"))?;

    if decoded.len() < MIN_PUBKEY_DECODED_LEN {
        return Err(format!(
            "decoded pubkey is too short ({} bytes; expected >= {})",
            decoded.len(),
            MIN_PUBKEY_DECODED_LEN
        ));
    }

    Ok(base64_line.to_string())
}

/// Truncate a pubkey for the diff output. A real
/// Tauri pubkey is ~200 characters; we don't want
/// to dump the whole thing to stdout twice.
pub fn short_for_diff(pubkey: &str) -> String {
    const PREFIX: usize = 16;
    const SUFFIX: usize = 16;
    if pubkey.len() <= PREFIX + SUFFIX + 3 {
        return pubkey.to_string();
    }
    format!(
        "{}…{}",
        &pubkey[..PREFIX],
        &pubkey[pubkey.len() - SUFFIX..]
    )
}

/// The result of patching a `tauri.conf.json` with
/// a new updater pubkey.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PatchResult {
    /// The new (patched) JSON text, ready to write
    /// back to `tauri.conf.json`.
    pub new_text: String,
    /// The old pubkey that was at
    /// `plugins.updater.pubkey` before the patch
    /// (or `None` if no previous pubkey was set).
    pub old_pubkey: Option<String>,
    /// The new pubkey that was written.
    pub new_pubkey: String,
}

/// Patch a `tauri.conf.json` JSON string with a
/// new updater pubkey at
/// `plugins.updater.pubkey`. The other fields
/// are preserved (the JSON is re-serialized, so
/// the exact formatting changes from the input,
/// but the structure is identical).
pub fn patch_tauri_conf(
    conf_text: &str,
    new_pubkey: &str,
) -> Result<PatchResult, String> {
    let mut conf: serde_json::Value =
        serde_json::from_str(conf_text).map_err(|e| format!("parse JSON: {e}"))?;

    let old_pubkey = conf
        .pointer("/plugins/updater/pubkey")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let plugins = conf
        .pointer_mut("/plugins")
        .and_then(|p| p.as_object_mut());
    match plugins {
        Some(p) => {
            let updater = p
                .entry("updater".to_string())
                .or_insert_with(|| serde_json::json!({}));
            if let Some(u) = updater.as_object_mut() {
                u.insert(
                    "pubkey".to_string(),
                    serde_json::Value::String(new_pubkey.to_string()),
                );
            } else {
                return Err(
                    "'plugins.updater' is not a JSON object".to_string()
                );
            }
        }
        None => {
            conf.as_object_mut()
                .ok_or_else(|| "tauri.conf.json root must be an object".to_string())?
                .insert(
                    "plugins".to_string(),
                    serde_json::json!({
                        "updater": { "pubkey": new_pubkey }
                    }),
                );
        }
    }

    let new_text = serde_json::to_string_pretty(&conf)
        .map_err(|e| format!("serialize JSON: {e}"))?;

    Ok(PatchResult {
        new_text,
        old_pubkey,
        new_pubkey: new_pubkey.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A valid-looking test pubkey. The base64 line
    /// decodes to >= 32 bytes (the content is
    /// arbitrary; we never verify the cryptographic
    /// validity in this CLI — Tauri does that at
    /// build time).
    const VALID_PUBKEY_FILE: &str = "\
untrusted comment: minisign public key 52229BC24C3F48D
RWRSN9MMkvCkiBXfnw1xQjN5PPwhH2cOEUgBfvCIRd1UgwCZgpQYNq7x
";

    /// A pubkey file that's missing the
    /// "untrusted comment:" prefix.
    const INVALID_NO_PREFIX: &str =
        "RWRSN9MMkvCkiBXfnw1xQjN5PPwhH2cOEUgBfvCIRd1UgwCZgpQYNq7x\n";

    /// A pubkey file with an invalid base64 character.
    const INVALID_BASE64: &str = "\
untrusted comment: minisign public key 52229BC24C3F48D
!!!NOT-VALID-BASE64!!!
";

    /// A pubkey that decodes to fewer than 32 bytes.
    const INVALID_TOO_SHORT: &str = "\
untrusted comment: minisign public key 52229BC24C3F48D
aGVsbG8=
";

    #[test]
    fn validate_pubkey_accepts_valid_tauri_pubkey() {
        let result = validate_pubkey(VALID_PUBKEY_FILE);
        assert!(result.is_ok(), "expected Ok, got: {result:?}");
        let pubkey = result.unwrap();
        assert_eq!(pubkey, "RWRSN9MMkvCkiBXfnw1xQjN5PPwhH2cOEUgBfvCIRd1UgwCZgpQYNq7x");
    }

    #[test]
    fn validate_pubkey_rejects_missing_prefix() {
        let result = validate_pubkey(INVALID_NO_PREFIX);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("untrusted comment:"),
            "error should mention the missing prefix, got: {err}"
        );
    }

    #[test]
    fn validate_pubkey_rejects_invalid_base64() {
        let result = validate_pubkey(INVALID_BASE64);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("base64"),
            "error should mention base64, got: {err}"
        );
    }

    #[test]
    fn validate_pubkey_rejects_too_short_decoded() {
        let result = validate_pubkey(INVALID_TOO_SHORT);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("too short"),
            "error should mention length, got: {err}"
        );
    }

    #[test]
    fn validate_pubkey_rejects_empty_file() {
        let result = validate_pubkey("");
        assert!(result.is_err());
    }

    #[test]
    fn short_for_diff_truncates_long_pubkeys() {
        let pubkey = "a".repeat(100);
        let short = short_for_diff(&pubkey);
        assert!(short.len() < pubkey.len());
        assert!(short.contains('…'));
    }

    #[test]
    fn short_for_diff_does_not_truncate_short_pubkeys() {
        let pubkey = "short-key";
        let short = short_for_diff(pubkey);
        assert_eq!(short, pubkey);
    }

    #[test]
    fn parse_args_extracts_pubkey_file() {
        let argv = vec![
            "--pubkey-file".to_string(),
            "/tmp/test.key.pub".to_string(),
        ];
        let args = parse_args(&argv).unwrap();
        assert_eq!(args.pubkey_file, "/tmp/test.key.pub");
        assert_eq!(args.tauri_conf, "src-tauri/tauri.conf.json");
    }

    #[test]
    fn parse_args_extracts_both_args() {
        let argv = vec![
            "--pubkey-file".to_string(),
            "/tmp/a.pub".to_string(),
            "--tauri-conf".to_string(),
            "/tmp/c.json".to_string(),
        ];
        let args = parse_args(&argv).unwrap();
        assert_eq!(args.pubkey_file, "/tmp/a.pub");
        assert_eq!(args.tauri_conf, "/tmp/c.json");
    }

    #[test]
    fn parse_args_rejects_missing_pubkey_file() {
        let argv = vec![];
        let result = parse_args(&argv);
        assert!(result.is_err());
    }

    #[test]
    fn parse_args_rejects_unknown_argument() {
        let argv = vec!["--bogus".to_string()];
        let result = parse_args(&argv);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown argument"));
    }

    #[test]
    fn patch_tauri_conf_replaces_pubkey_in_place() {
        let conf_text = r#"{
  "productName": "Lipi",
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "OLD_KEY"
    }
  }
}"#;
        let result = patch_tauri_conf(conf_text, "NEW_KEY").unwrap();
        assert_eq!(result.old_pubkey.as_deref(), Some("OLD_KEY"));
        assert_eq!(result.new_pubkey, "NEW_KEY");

        let updated: serde_json::Value =
            serde_json::from_str(&result.new_text).unwrap();
        let pubkey = updated
            .pointer("/plugins/updater/pubkey")
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(pubkey, "NEW_KEY");

        // Other fields are preserved.
        let active = updated
            .pointer("/plugins/updater/active")
            .and_then(|v| v.as_bool())
            .unwrap();
        assert_eq!(active, true);

        let product_name = updated
            .pointer("/productName")
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(product_name, "Lipi");
    }

    #[test]
    fn patch_tauri_conf_creates_plugins_key_if_missing() {
        let conf_text = r#"{
  "productName": "Lipi"
}"#;
        let result = patch_tauri_conf(conf_text, "NEW_KEY").unwrap();
        assert_eq!(result.old_pubkey, None);
        assert_eq!(result.new_pubkey, "NEW_KEY");

        let updated: serde_json::Value =
            serde_json::from_str(&result.new_text).unwrap();
        let pubkey = updated
            .pointer("/plugins/updater/pubkey")
            .and_then(|v| v.as_str())
            .unwrap();
        assert_eq!(pubkey, "NEW_KEY");
    }

    #[test]
    fn patch_tauri_conf_rejects_invalid_json() {
        let result = patch_tauri_conf("not valid json", "NEW_KEY");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("parse JSON"));
    }
}
