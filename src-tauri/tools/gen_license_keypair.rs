//! Phase 4.x: the `gen_license_keypair` CLI.
//!
//! A one-shot helper that generates a fresh
//! Ed25519 keypair for the production license
//! issuer. The public key is printed in the
//! `0x45, 0xf7, …` byte-array format expected by
//! `licensing::PROD_PUBKEY`; the private key is
//! printed in the 64-char hex format expected by
//! `sign_license`'s `TAURI_PROD_LICENSE_KEY_HEX`
//! env var.
//!
//! ## Why this exists
//!
//! The previous flow was:
//! 1. `openssl genpkey -algorithm ed25519 -out k.pem`
//! 2. `openssl pkey -in k.pem -text` → hand-copy 32 bytes
//! 3. `tail -c 32 k.pem | xxd -i -c 32` → hand-copy 32 bytes
//!
//! Easy to fat-finger a hex char. This CLI is a
//! self-contained way to do the same in 1 step,
//! with the output formatted for direct paste-into
//! code / env-var.
//!
//! ## Usage
//!
//! ```text
//! cargo run --bin gen_license_keypair
//! ```
//!
//! Then paste the printed public key into
//! `licensing::PROD_PUBKEY` (after regenerating
//! both key and pubkey) and store the printed
//! private key in the `TAURI_PROD_LICENSE_KEY_HEX`
//! CI secret (or the project lead's offline
//! backup).
//!
//! The public key is printed FIRST, the private
//! key SECOND. The convention is: paste the public
//! key into the source code, paste the private
//! key into a CI secret. Don't get them mixed up
//! (the signing CLI will refuse to start if the
//! hex string is wrong, but a `0x`-prefixed public
//! key looks like a valid private-key hex string
//! to the naked eye).

#![cfg(not(mobile))]

use ed25519_dalek::SigningKey;

fn main() {
    // Generate 32 fresh bytes from the OS CSPRNG and
    // build a SigningKey from them. We don't need
    // `rand` as a separate dep — `getrandom` is
    // already in the tree.
    let mut seed = [0u8; 32];
    getrandom::getrandom(&mut seed).expect("getrandom");
    let signing_key = SigningKey::from_bytes(&seed);
    let verifying_key = signing_key.verifying_key();

    // Zero the seed out of memory as soon as we've
    // built the SigningKey. The SigningKey itself
    // holds the private bytes; we don't need the
    // original seed copy anymore.
    let mut seed_zero = seed;
    for b in seed_zero.iter_mut() {
        *b = 0;
    }

    let priv_bytes = signing_key.to_bytes();
    let priv_hex: String = priv_bytes.iter().map(|b| format!("{b:02x}")).collect();

    println!("# Production license keypair (Ed25519)");
    println!();
    println!("# 1. Public key — paste this into licensing::PROD_PUBKEY:");
    print_pubkey_array("PROD_PUBKEY", verifying_key.as_bytes());
    println!();
    println!("# 2. Private key (hex) — store this in the TAURI_PROD_LICENSE_KEY_HEX CI secret:");
    println!("#    Length: {} chars", priv_hex.len());
    println!("TAURI_PROD_LICENSE_KEY_HEX={}", priv_hex);
    println!();
    println!("# Verify: the pubkey above is the Ed25519 public key");
    println!("# corresponding to this private key. signing_key.verify()");
    println!("# in a test will confirm the pair matches.");
}

fn print_pubkey_array(name: &str, bytes: &[u8; 32]) {
    print!("const {name}: [u8; 32] = [\n    ");
    for (i, b) in bytes.iter().enumerate() {
        print!("0x{b:02x}");
        if i < bytes.len() - 1 {
            print!(", ");
        }
        if (i + 1) % 8 == 0 && i < bytes.len() - 1 {
            print!("\n    ");
        }
    }
    println!("\n];");
}
