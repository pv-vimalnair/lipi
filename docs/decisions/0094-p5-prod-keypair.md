# Decision #94 — Phase 5: ship a separate production updater keypair (don't reuse the dev keypair for releases)

**Date**: June 2026
**Phase**: 5 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

The Tauri updater plugin signs each `.msi` / `.exe` /
`.app` / `.AppImage` / `.deb` artifact with an Ed25519
keypair at build time, and embeds the public key in
`tauri.conf.json` so the running app can verify
future updates. The private key is read from
`TAURI_SIGNING_PRIVATE_KEY` (a CI secret for releases;
`lipi-dev.key` for dev builds).

Phase 5 is the "production release pipeline" phase.
The pipeline must be able to ship a release to the
public with one command. The v0.0.2 dev keypair has
a known password (`lipi-dev-not-a-real-secret`) and
is committed at `lipi-dev.key.pub` (with the
private at `lipi-dev.key`, git-ignored). It works
fine for `cargo tauri build --debug` runs, but it's
not safe for public distribution:

- A malicious contributor could extract the
  dev key from a leaked dev build, sign a fake
  "v0.1.0" updater, and trick existing users into
  installing it (Tauri's pubkey check would pass
  because the user's installed binary trusts
  the dev pubkey).
- The dev pubkey is committed in the repo. If
  the repo is ever made public (or a contributor
  leaks a build with the dev pubkey), the dev
  key is effectively public knowledge.

The question: do we (a) ship the v0.1.0 release
with the dev keypair, accepting the risks; or
(b) generate a new keypair for the first public
release?

## Decision

**Generate a new production keypair for v0.1.0.**
The production keypair is generated via `tauri
signer generate -w src-tauri/keys/production/
production.key`. The private key is stored in
the CI secret store (`TAURI_PROD_UPDATER_KEY`)
and the public key is committed at
`src-tauri/keys/production/production.key.pub`
(separate from the dev `lipi-dev.key.pub`).

The release workflow has a **`keypair-guard` job**
that fails the release if `tauri.conf.json`'s
`plugins.updater.pubkey` still matches the dev
pubkey. The guard runs only on the release
workflow (not on PR CI — that would block every
merge to main until the project lead rotates
the key).

A new **`rotate_updater_key` CLI** ships in
`src-tauri/src/bin/rotate_updater_key.rs` (with
the pure logic in `src-tauri/src/rotate_updater_key.rs`).
The CLI patches `tauri.conf.json` in place to
reference the new pubkey and prints a unified-diff
for the project lead's review.

## Why

**The dev keypair's password is in the repo** —
even though `lipi-dev.key` is git-ignored, the
password (`lipi-dev-not-a-real-secret`) is
documented in `HANDOFF.md` so contributors can
build locally. A malicious actor with read
access to the repo can extract the dev key
from any local dev build. The dev key must never
sign a public release.

**The "Unknown Publisher" warning is a marketing
problem.** macOS / Windows SmartScreen both
flag unsigned / weakly-signed binaries. A
production release with proper code signing
shows the project lead's name, not "Unknown
Publisher". The dev keypair is "weakly signed"
(it has a public key embedded in the binary, so
it's *technically* signed, but the private key
is compromised).

**The CI guard catches "I forgot to rotate" at
release time, not at customer time.** The
`keypair-guard` job fails the release workflow
in 10 seconds. Without it, a project lead could
ship a v0.1.0 release signed with the dev key
and not realize the mistake until a security
researcher writes a blog post about it.

**The separate production key dir is intentional.**
A future `lipi-staging.key` (for the staging
release channel) can be added to the same
`src-tauri/keys/` directory without
contaminating the dev or production keys.

## Alternatives considered

### A) Ship v0.1.0 with the dev keypair

**Pros**: zero setup; the v1 release can go out
in 5 minutes.

**Cons**: the dev key is compromised (password
is in the repo); users are at risk; the release
doesn't model the "rotation" workflow that every
future release will need.

**Rejected** because the dev key is a known
public key, not a private key. Shipping a release
with it would be equivalent to "no signing".

### B) Use the same keypair for dev + production, but rotate the password

**Pros**: the dev pubkey is still in `tauri.conf.json`
(no need to change the existing tauri config);
the project lead just needs to change the dev
key's password.

**Cons**: doesn't fix the "dev pubkey is committed"
problem (the project lead still can't ship a
release without rotating the pubkey, which
requires a `tauri.conf.json` change).

**Rejected** because the rotation is the point —
the dev pubkey is committed, and that's the
thing that needs to change for a release.

### C) Auto-generate a new keypair on every CI run

**Pros**: zero operational overhead; no
"keypair-guard" needed; impossible to ship a
release with the dev key.

**Cons**: the keypair would change every build,
which means *every* build would be a "first
build" from the user's perspective. Existing
users couldn't update to the new build (their
installed binary trusts the OLD pubkey, not
the NEW one). Tauri 2.10's runtime pubkey
override solves this, but only with the
"dual-pubkey transition" future-phase feature
that we haven't built yet.

**Rejected** for v0.1.0; **accepted** as a
future-phase feature for v0.2.0+ (once the
"dual-pubkey transition" support is built).

### D) Use a third-party signing service (e.g. SignPath, Azure Trusted Signing)

**Pros**: enterprise-grade key management;
compliance with FIPS 140-2 / Common Criteria.

**Cons**: $300-$5000/year; requires
KYC/business verification; another vendor to
manage; overkill for a v0.1.0 release from
a single project lead.

**Rejected** for v0.1.0; **accepted** as a
future-phase feature for v1.0+ (once Lipi
has a business entity + revenue).

## What this means for the v0.1.0 release

1. The project lead runs `npx tauri signer
   generate -w src-tauri/keys/production/
   production.key` (one-time setup).
2. The project lead sets the `TAURI_PROD_UPDATER_KEY`
   and `TAURI_PROD_UPDATER_KEY_PASSWORD` GitHub
   secrets.
3. The project lead runs `rotate_updater_key
   --pubkey-file src-tauri/keys/production/
   production.key.pub` to patch `tauri.conf.json`.
4. The project lead commits the patched
   `tauri.conf.json` and pushes.
5. The project lead runs `git tag v0.1.0 &&
   git push --follow-tags`. The release
   workflow runs; the `keypair-guard` passes;
   the build signs the artifacts with the
   production key; the updater is live.

## What this does NOT cover

- **macOS / Windows code signing** (Authenticode
  + Apple notarization) is a separate concern,
  handled in `docs/plans/prod-p5-release-pipeline-design.md`
  §"Code signing wiring". This ADR is only
  about the *updater* keypair.
- **The "dual-pubkey transition" for key
  rotation** (existing users trust the OLD
  pubkey, new users trust the NEW pubkey)
  is a future phase. The current model is
  "rotate the key, ship a new release,
  wait for the user base to update".
- **SBOM (Software Bill of Materials)
  generation** for enterprise customers is
  a future phase.
