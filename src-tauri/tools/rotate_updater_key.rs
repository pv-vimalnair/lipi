//! Phase 5: the `rotate_updater_key` CLI (thin
//! binary wrapper).
//!
//! The pure logic (argument parsing, pubkey
//! validation, JSON patching) lives in
//! `src-tauri/src/rotate_updater_key.rs` so the
//! tests can run via `cargo test --lib` (which is
//! reliable on Windows; the test runner for
//! `cargo test --bin …` can hit an elevation
//! error on some Windows machines). This file
//! is the thin I/O + exit-code wrapper that
//! shells out to the library.
//!
//! ## Usage
//!
//! ```text
//! rotate_updater_key \
//!   --pubkey-file <path/to/production.key.pub> \
//!   [--tauri-conf <path/to/tauri.conf.json>]
//! ```
//!
//! If `--tauri-conf` is omitted, the CLI defaults
//! to `src-tauri/tauri.conf.json`. The
//! `--pubkey-file` is required.
//!
//! See `src-tauri/src/rotate_updater_key.rs` for
//! the pure logic, and
//! `docs/plans/prod-p5-release-pipeline-design.md`
//! for the design rationale.

#![cfg(not(mobile))]

use std::env;
use std::fs;
use std::process::ExitCode;

use lipi_lib::rotate_updater_key::{parse_args, patch_tauri_conf, short_for_diff, validate_pubkey};

fn main() -> ExitCode {
    let raw_args: Vec<String> = env::args().skip(1).collect();
    let args = match parse_args(&raw_args) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("rotate_updater_key: {e}");
            print_usage();
            return ExitCode::from(2);
        }
    };

    // Step 1: read the new pubkey file.
    let pubkey_text = match fs::read_to_string(&args.pubkey_file) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "rotate_updater_key: failed to read pubkey file {:?}: {e}",
                args.pubkey_file
            );
            return ExitCode::from(1);
        }
    };

    // Step 2: validate the new pubkey.
    let pubkey = match validate_pubkey(&pubkey_text) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("rotate_updater_key: invalid pubkey: {e}");
            return ExitCode::from(3);
        }
    };

    // Step 3: read + parse the tauri.conf.json.
    let conf_text = match fs::read_to_string(&args.tauri_conf) {
        Ok(s) => s,
        Err(e) => {
            eprintln!(
                "rotate_updater_key: failed to read tauri config {:?}: {e}",
                args.tauri_conf
            );
            return ExitCode::from(1);
        }
    };

    // Step 4: patch the JSON.
    let result = match patch_tauri_conf(&conf_text, &pubkey) {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "rotate_updater_key: failed to patch {:?}: {e}",
                args.tauri_conf
            );
            return ExitCode::from(5);
        }
    };

    // Step 5: print the diff for human review.
    match result.old_pubkey.as_deref() {
        Some(old) if old == result.new_pubkey => {
            println!("rotate_updater_key: pubkey unchanged (already rotated)");
            return ExitCode::SUCCESS;
        }
        Some(old) => {
            println!("# Diff for {}", args.tauri_conf);
            println!("-    \"pubkey\": \"{}\"", short_for_diff(old));
            println!(
                "+    \"pubkey\": \"{}\"",
                short_for_diff(&result.new_pubkey)
            );
        }
        None => {
            println!(
                "# No previous pubkey found at plugins.updater.pubkey; adding the new pubkey."
            );
            println!(
                "+    \"pubkey\": \"{}\"",
                short_for_diff(&result.new_pubkey)
            );
        }
    }

    // Step 6: write the patched JSON.
    if let Err(e) = fs::write(&args.tauri_conf, &result.new_text) {
        eprintln!(
            "rotate_updater_key: failed to write {:?}: {e}",
            args.tauri_conf
        );
        return ExitCode::from(1);
    }

    println!(
        "rotate_updater_key: wrote rotated pubkey to {}",
        args.tauri_conf
    );
    ExitCode::SUCCESS
}

fn print_usage() {
    eprintln!(
        "Usage: rotate_updater_key \\\n\
         \n  --pubkey-file <path/to/production.key.pub> \\\n\
         \n  [--tauri-conf <path/to/tauri.conf.json>]\n\n\
         \nRotates the Tauri updater pubkey in tauri.conf.json.\n\
         \nThe pubkey file is the .key.pub produced by `tauri signer generate`.\n\
         \nIf --tauri-conf is omitted, defaults to 'src-tauri/tauri.conf.json'."
    );
}
