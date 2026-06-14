# Decision #92 — Phase 3: a separate Rust `sign_license` CLI for production key issuance

**Date**: June 2026
**Phase**: 3 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

The production private key (the Ed25519 secret that
signs paid license keys) is sensitive:

- It should NOT be embedded in the app (that's the
  trial key, per Decision #86).
- It should NOT be in the git history (the project
  lead's laptop could be compromised).
- It should be in a CI secret store (GitHub Actions
  encrypted secrets) AND a local encrypted USB drive
  the project lead keeps offline.

When a purchase email comes in, the project lead needs
to issue a key. The question is: how?

## Decision

A **separate Rust binary** `sign_license` at
`src-tauri/src/bin/sign_license.rs` that:

1. Reads the production private key from the
   `TAURI_PROD_LICENSE_KEY_HEX` environment variable
   (32 hex chars → 32 bytes).
2. Takes three CLI args: `--plan <monthly|yearly>`,
   `--machine <64-char hex fingerprint>`, and
   `--out <path/to/license.txt>`.
3. Builds a `LicensePayload`, signs it with
   `licensing::sign_payload`, and writes the
   `LIP1.…` key to `--out`.
4. Prints a one-line success message:
   "Wrote license to {out} (plan: …, machine: …, expires: …)".

The binary is a one-shot command, not a long-running
server. The project lead runs it once per purchase
email. The binary is desktop-only
(`#[cfg(not(mobile))]`).

## Consequences

- **+** The production private key is NEVER in the
  source tree. It's read from the env var at
  invocation time. The project lead can keep the
  key in a CI secret store OR a local encrypted
  USB drive.
- **+** The CLI is auditable: every key issuance
  produces a one-line stdout log with the plan,
  fingerprint prefix, and expiry. The project
  lead can grep CI logs to answer "what did I
  issue to alice@example.com?".
- **+** The CLI is reusable for batch issuance
  (Phase 5 may add a `--batch` flag that reads
  CSV rows; Phase 3 just ships the single-key
  version).
- **+** The CLI uses the same `sign_payload`
  function as the trial-generation flow. No
  duplicated signing code.
- **−** The project lead has to install the Rust
  toolchain to run the CLI. This is a small
  tax (the lead already has Rust for the dev
  loop) but worth noting. A future phase
  could ship a pre-built `sign_license` binary
  via GitHub Releases, but Phase 3 doesn't.
- **−** The CLI doesn't talk to Stripe (the
  payment processor). The project lead runs
  the CLI manually after each purchase email.
  A future phase could auto-issue keys from a
  Stripe webhook, but that requires a backend
  (which violates the "no backend, ever"
  rule, Decision #17).
- **−** A malicious actor with access to the
  production private key can issue unlimited
  keys. The mitigation is operational: the
  key is in a CI secret + an offline USB
  drive, and the project lead rotates the
  keypair quarterly (Phase 5b).

## Alternatives considered

- **Web UI for key issuance**. A small React
  page where the project lead pastes a
  fingerprint and gets a key back. Simpler
  UX, but requires hosting a website
  (violates "no backend, ever") and the
  page would need to embed the private
  key (catastrophic if compromised). The
  CLI keeps the key in the dev environment
  only.
- **Stripe webhook auto-issuance**. A
  Lambda function that listens for
  `checkout.session.completed` and
  issues a key. Requires a backend
  (violates "no backend, ever"). The
  project lead's existing CI doesn't
  have a webhook target.
- **Email-driven (a "license email server"
  that watches licensing@lipi.ide and
  issues keys). Same backend issue as
  the webhook option.

The CLI is the lowest-friction option that
keeps the production key out of source
control. The operational tax ("run one
command per purchase") is acceptable for
v1.

## References

- `docs/plans/prod-p2-licensing-design.md §8`
  — the original "sign a license" flow.
- `docs/plans/prod-p3-subscription-ux-design.md`
  — the CLI section.
- `src-tauri/src/bin/sign_license.rs` —
  the implementation (~250 lines +
  ~150 lines of tests).
- `src-tauri/Cargo.toml` — the `[[bin]]`
  entry.
