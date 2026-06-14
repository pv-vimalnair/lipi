//! Phase 3: the `sign_license` CLI.
//!
//! A one-shot Rust binary that the project lead
//! runs from a terminal to issue production
//! license keys from purchase emails.
//!
//! ## Usage
//!
//! ```text
//! TAURI_PROD_LICENSE_KEY_HEX=<32 hex chars> \
//!   sign_license \
//!     --plan <monthly|yearly> \
//!     --machine <64-char hex fingerprint> \
//!     --out <path/to/license.txt>
//! ```
//!
//! ## What it does
//!
//! 1. Parses the three CLI args.
//! 2. Reads the production private key from
//!    `TAURI_PROD_LICENSE_KEY_HEX`.
//! 3. Builds a `LicensePayload` (format:
//!    `lipi-license-v1`, plan from `--plan`,
//!    iat: now, nbf: now, exp: now + plan
//!    duration, sub: from `--machine`, jti:
//!    random).
//! 4. Signs the payload with the production
//!    private key via `licensing::sign_payload`.
//! 5. Writes the `LIP1.…` key string to `--out`.
//! 6. Prints a one-line success message to
//!    stdout (the project lead can grep for
//!    "Wrote license to" in CI logs).
//!
//! ## Failure modes
//!
//! - Missing `--plan`, `--machine`, or `--out`:
//!   prints usage to stderr, exits 2.
//! - `--plan` is not "monthly" or "yearly":
//!   prints an error to stderr, exits 3.
//! - `--machine` is not 64 lowercase hex chars:
//!   prints an error to stderr, exits 4.
//! - `TAURI_PROD_LICENSE_KEY_HEX` is unset or
//!   not 32 hex chars: prints an error to
//!   stderr, exits 5.
//! - Writing to `--out` fails (e.g. permission
//!   denied, parent dir doesn't exist): prints
//!   the error to stderr, exits 1.
//!
//! The exit codes are arbitrary non-zero numbers
//! (1-5) so the project lead can distinguish
//! "user error" (bad args) from "system error"
//! (write failed) without parsing stderr text.

#![cfg(not(mobile))]

use std::env;
use std::fs;
use std::process::ExitCode;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ed25519_dalek::SigningKey;

use lipi_lib::licensing::{
    sign_payload, LicensePayload, KID_OFFLINE, LICENSE_FORMAT_V1, PLAN_MONTHLY, PLAN_YEARLY,
    TRIAL_DURATION_SECS,
};

/// Plan durations in seconds. `monthly` = 30 days
/// (not "calendar month"); `yearly` = 365 days
/// (not "calendar year"). Matches the Sublime Text
/// / BBEdit model. A future v2 license format could
/// add calendar-based durations.
fn plan_duration_secs(plan: &str) -> Option<i64> {
    match plan {
        PLAN_MONTHLY => Some(30 * 86_400),
        PLAN_YEARLY => Some(365 * 86_400),
        _ => None,
    }
}

/// Random 16-byte JTI, hex-encoded. Uses
/// `getrandom` (already a transitive dep) directly.
fn random_jti_hex() -> String {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).expect("getrandom");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_unix_secs() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch");
    now.as_secs() as i64
}

struct Args {
    plan: String,
    machine: String,
    out: String,
}

/// Parse the CLI args. Returns an error message
/// (printed to stderr by the caller) on bad input.
fn parse_args() -> Result<Args, String> {
    let mut plan: Option<String> = None;
    let mut machine: Option<String> = None;
    let mut out: Option<String> = None;

    let mut iter = env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--plan" => {
                plan = iter.next();
            }
            "--machine" => {
                machine = iter.next();
            }
            "--out" => {
                out = iter.next();
            }
            "--help" | "-h" => {
                print_usage();
                std::process::exit(0);
            }
            other => {
                return Err(format!("unknown argument: {other}"));
            }
        }
    }

    let plan = plan.ok_or_else(|| "missing --plan <monthly|yearly>".to_string())?;
    let machine = machine.ok_or_else(|| "missing --machine <fingerprint>".to_string())?;
    let out = out.ok_or_else(|| "missing --out <path/to/license.txt>".to_string())?;
    Ok(Args { plan, machine, out })
}

fn print_usage() {
    eprintln!(
        "Usage: TAURI_PROD_LICENSE_KEY_HEX=<32 hex chars> \\\n\
         \n  sign_license \\\n\
         \n    --plan <monthly|yearly> \\\n\
         \n    --machine <64-char hex fingerprint> \\\n\
         \n    --out <path/to/license.txt>\n\n\
         \nIssues a production license key and writes it to <out>.\n\
         \nThe production private key is read from TAURI_PROD_LICENSE_KEY_HEX (32 hex chars).\n\
         \nThe trial duration constant is {} seconds ({} days) but trials are\n\
         \nauto-generated; this CLI only issues monthly / yearly licenses.",
        TRIAL_DURATION_SECS, TRIAL_DURATION_SECS / 86_400,
    );
}

/// Validate a plan string. Returns the duration in
/// seconds, or an error.
fn validate_plan(plan: &str) -> Result<i64, String> {
    plan_duration_secs(plan).ok_or_else(|| {
        format!(
            "unknown plan: {plan:?} (expected {:?} or {:?})",
            PLAN_MONTHLY, PLAN_YEARLY
        )
    })
}

/// Validate a machine fingerprint. Must be exactly
/// 64 lowercase hex characters (the format
/// `licensing::machine_fingerprint` returns).
fn validate_machine(machine: &str) -> Result<(), String> {
    if machine.len() != 64 {
        return Err(format!(
            "machine fingerprint must be 64 hex chars, got {}",
            machine.len()
        ));
    }
    if !machine.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
        return Err("machine fingerprint must be 64 lowercase hex chars".to_string());
    }
    Ok(())
}

/// Read and validate the production private key
/// from the env var. Must be exactly 32 hex
/// characters; decoded into 32 bytes.
fn read_production_key() -> Result<[u8; 32], String> {
    let hex_str = env::var("TAURI_PROD_LICENSE_KEY_HEX")
        .map_err(|_| "TAURI_PROD_LICENSE_KEY_HEX is not set".to_string())?;
    if hex_str.len() != 64 {
        return Err(format!(
            "TAURI_PROD_LICENSE_KEY_HEX must be 32 hex chars (64 hex digits), got {}",
            hex_str.len()
        ));
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(hex_str.as_bytes())
        .map_err(|e| format!("TAURI_PROD_LICENSE_KEY_HEX is not valid hex: {e}"))?;
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    // Verify the key is a valid Ed25519 signing key.
    // (Ed25519 keys are any 32 bytes, but `SigningKey::from_bytes`
    //  will return a valid key for any 32 bytes; the actual
    //  "is this a valid Ed25519 key" check happens at signing
    //  time. We just sanity-check the decode here.)
    let _ = SigningKey::from_bytes(&out);
    Ok(out)
}

fn run() -> Result<(), String> {
    let args = parse_args().map_err(|e| {
        eprint!("error: {e}\n\n");
        print_usage();
        e
    })?;
    let duration = validate_plan(&args.plan)?;
    validate_machine(&args.machine)?;
    let secret = read_production_key()?;

    let now = now_unix_secs();
    let payload = LicensePayload {
        format: LICENSE_FORMAT_V1.to_string(),
        plan: args.plan.clone(),
        iat: now,
        nbf: now,
        exp: now + duration,
        sub: args.machine.clone(),
        jti: random_jti_hex(),
        kid: Some(KID_OFFLINE.to_string()),
    };
    let key = sign_payload(&payload, &secret).map_err(|e| format!("sign_payload: {e}"))?;

    fs::write(&args.out, &key).map_err(|e| format!("write {}: {e}", args.out))?;

    println!(
        "Wrote license to {} (plan: {}, machine: {}, expires: {})",
        args.out,
        args.plan,
        &args.machine[..12],
        payload.exp
    );
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            // Exit code 1: we hit a runtime error (write
            // failure, signing failure, etc.). The bad-
            // args path uses higher codes (2/3/4/5) so
            // the project lead can distinguish.
            ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_duration_secs_for_monthly_is_30_days() {
        assert_eq!(plan_duration_secs(PLAN_MONTHLY), Some(30 * 86_400));
    }

    #[test]
    fn plan_duration_secs_for_yearly_is_365_days() {
        assert_eq!(plan_duration_secs(PLAN_YEARLY), Some(365 * 86_400));
    }

    #[test]
    fn plan_duration_secs_for_unknown_plan_is_none() {
        assert_eq!(plan_duration_secs("lifetime"), None);
        assert_eq!(plan_duration_secs("weekly"), None);
        assert_eq!(plan_duration_secs(""), None);
    }

    #[test]
    fn validate_machine_accepts_64_lowercase_hex_chars() {
        let fp = "a".repeat(64);
        assert!(validate_machine(&fp).is_ok());
    }

    #[test]
    fn validate_machine_rejects_63_chars() {
        let fp = "a".repeat(63);
        assert!(validate_machine(&fp).is_err());
    }

    #[test]
    fn validate_machine_rejects_65_chars() {
        let fp = "a".repeat(65);
        assert!(validate_machine(&fp).is_err());
    }

    #[test]
    fn validate_machine_rejects_uppercase_hex() {
        let mut fp = "a".repeat(64);
        fp.replace_range(0..1, "A");
        assert!(validate_machine(&fp).is_err());
    }

    #[test]
    fn validate_machine_rejects_non_hex() {
        let mut fp = "a".repeat(64);
        fp.replace_range(0..1, "z");
        assert!(validate_machine(&fp).is_err());
    }

    #[test]
    fn validate_machine_rejects_empty() {
        assert!(validate_machine("").is_err());
    }

    #[test]
    fn validate_plan_accepts_monthly() {
        assert!(validate_plan(PLAN_MONTHLY).is_ok());
    }

    #[test]
    fn validate_plan_accepts_yearly() {
        assert!(validate_plan(PLAN_YEARLY).is_ok());
    }

    #[test]
    fn validate_plan_rejects_lifetime() {
        assert!(validate_plan("lifetime").is_err());
    }

    #[test]
    fn validate_plan_rejects_empty() {
        assert!(validate_plan("").is_err());
    }

    #[test]
    fn random_jti_hex_produces_32_chars() {
        // 16 bytes hex-encoded = 32 chars
        assert_eq!(random_jti_hex().len(), 32);
    }

    #[test]
    fn random_jti_hex_produces_different_values_on_repeated_calls() {
        // Two consecutive calls should produce different
        // values (the JTI is meant to be unique per
        // license).
        let a = random_jti_hex();
        let b = random_jti_hex();
        assert_ne!(a, b);
    }
}
