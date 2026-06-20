# Phase 5 — Production release pipeline (design)

**Date**: June 2026
**Phase**: 5 of the production-readiness roadmap (see HANDOFF §6 "Current phase")
**Status**: Design (accepted for implementation)
**Supersedes**: the "M0+ code signing + keypair rotation" preview from the original 9-phase plan. This doc makes those promises concrete.
**Deciders**: project lead (Vimal Nair)

## Goal

Ship a **production-grade release pipeline** for Lipi so
the project lead can publish a build to the public with
one command. After Phase 5 lands, the workflow is:

1. Project lead runs `git tag v0.1.0 && git push --tags`
   on `main`.
2. GitHub Actions picks up the tag, builds the app for
   all 3 desktop platforms (macOS, Windows, Linux) in
   parallel, and signs each artifact with the production
   updater keypair + (on Windows) the Authenticode
   certificate + (on macOS) the Apple notarization
   service.
3. CI publishes the signed installers + the
   `updater.json` metadata to a GitHub Release tagged
   `v0.1.0`.
4. The updater endpoint (`https://github.com/lipi-dev/lipi/releases/latest/download/updater.json`)
   automatically points to the new release.
5. Existing users get a "Lipi v0.1.0 is available" dialog
   the next time they launch the app, courtesy of the
   `tauri-plugin-updater` (which is already enabled in
   `tauri.conf.json`).
6. New users download the signed installer, the OS
   trust dialog shows the project lead's name (not
   "Unknown Publisher"), and the app installs cleanly.

The release pipeline is the **last code-focused phase**
before public distribution. After this lands, the only
remaining work for public launch is the non-code setup
(LLC formation, ToS, marketing site, support rotation)
that the project lead runs in parallel.

## Non-goals (Phase 5 explicitly does not do)

- **No production IAP wiring.** That's Phase 4 (real
  Apple / Microsoft receipt validation). Phase 5 ships
  the release pipeline for the *direct-download* path
  (the user downloads an installer from the project
  website, not from the App Store).
- **No mobile distribution.** The release pipeline is
  desktop-only (macOS, Windows, Linux). iOS / Android
  are separate distribution channels with their own
  signing + notarization requirements (App Store
  Connect, Google Play Console). Phase 5 doesn't touch
  them.
- **No real Apple Developer ID / Windows Authenticode
  certificate provisioning.** Phase 5 wires the CI
  *plumbing* — the secrets, the env vars, the build
  steps. The actual certificates are procured by the
  project lead in parallel (Apple Developer Program
  enrollment is $99/year; Windows EV code signing
  certificate is ~$300-$500/year; Azure Trusted Signing
  is ~$10/month for a basic OV cert). Phase 5's CI
  reads the cert from a secret; if the secret is
  empty, the build skips code signing (and the OS
  shows "Unknown Publisher" — the project lead's
  problem to fix, not a Phase 5 bug).
- **No auto-update of the dev / canary channels.**
  The updater endpoint points to the GitHub Release's
  `latest` tag. A future phase could add a
  "dev channel" that points to `nightly` releases;
  Phase 5 doesn't.
- **No Docker / sandbox builds.** The Tauri build
  requires platform-native toolchains (Xcode on macOS,
  MSVC on Windows, gtk3-dev on Linux), so a Docker
  build is more pain than it's worth. CI runners
  are platform-native (GitHub Actions'
  `macos-latest` / `windows-latest` / `ubuntu-latest`).
- **No release notes automation.** The GitHub Release
  body is auto-generated from the commit log
  (`git log --oneline v0.0.9..v0.1.0`); a future
  phase could add a `RELEASE_NOTES.md` template that
  the project lead fills in per release.
- **No rollback automation.** If a release has a
  critical bug, the project lead has to manually
  re-tag or unpublish the release. A future phase
  could add a "rollback" workflow.

## What this phase builds

### 1. Production updater keypair + rotation (`src-tauri/keys/production/`)

The existing `lipi-dev.key` / `lipi-dev.key.pub` are
**development-only** — the dev private key has a known
password (`lipi-dev-not-a-real-secret`) and is
git-ignored but present on the project lead's laptop.
A real release MUST be signed with a different key.

Phase 5 generates a **production keypair**, but only the public key lives
inside the repo:

```
src-tauri/keys/production/
└── production.key.pub     # PUBLIC — committed, embedded in tauri.conf.json
```

The private key is generated outside the workspace, for example with
`tauri signer generate -w
$HOME/.lipi-production-secrets/keys/production/production.key` (Tauri
2.11's CLI), then imported into the project lead's CI secret store and
offline vault / encrypted USB. The password is set to a 32-char random
string and stored in the project lead's CI secret store (GitHub Actions
encrypted secrets) under the name `TAURI_PROD_UPDATER_KEY_PASSWORD`.

The public key is committed to the repo at
`src-tauri/keys/production/production.key.pub` (the
existing `tauri.conf.json`'s `plugins.updater.pubkey` is
updated to the new value; the dev pubkey is moved to a
`src-tauri/keys/dev/` directory for clarity).

#### Key rotation

The updater pubkey can be **rotated at runtime** via
Tauri's `app.updater_builder().pubkey("…")` API. Phase
5 ships a small Rust utility that the project lead runs
from CI when rotating the key:

```rust
// src-tauri/src/bin/rotate_updater_key.rs
//
// Reads the new pubkey from a file (the new
// production keypair's .pub), patches
// tauri.conf.json's `plugins.updater.pubkey` field, and
// prints the diff. The project lead reviews the diff
// and commits it.
```

Why a separate binary, not a one-off shell script:
- It validates the new pubkey (must be valid
  base64, must parse as a Tauri updater pubkey).
- It does an in-place update of the JSON
  (preserves formatting, doesn't re-serialize
  the whole file).
- It prints the diff for human review.

### 2. CI/CD release pipeline (`.github/workflows/release.yml`)

A new GitHub Actions workflow at
`.github/workflows/release.yml` that:

1. **Trigger**: a tag matching `v*.*.*` (e.g.
   `v0.1.0`) pushed to `main`.
2. **Matrix build** across 3 desktop platforms:
   - `macos-latest` (Apple Silicon + Intel via
     `--target universal-apple-darwin`)
   - `windows-latest`
   - `ubuntu-latest` (x86_64)
3. **Per-platform build steps**:
   - Checkout the repo
   - Install Node 20, Rust 1.82, and platform
     toolchains
   - Run `npm ci` to install JS deps
   - Run `npm test` (vitest) — fail the build
     on any test failure
   - Run `cargo test --workspace` — fail the
     build on any test failure
   - Run `npm run build` (Vite + tsc)
   - Run `cargo tauri build` with the
     appropriate env vars:
     - All platforms: `TAURI_SIGNING_PRIVATE_KEY`,
       `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
       (read from CI secrets)
     - macOS: `APPLE_ID`, `APPLE_PASSWORD`
       (app-specific password for notarization),
       `APPLE_TEAM_ID` (read from CI secrets)
     - Windows: `WINDOWS_CERT_FILE` (base64-
       encoded `.pfx`), `WINDOWS_CERT_PASSWORD`
       (read from CI secrets)
4. **Upload artifacts** to a GitHub Release
   (one Release per tag, with assets for each
   platform).
5. **Generate the `updater.json`** from the
   uploaded artifacts and commit it to the
   Release's `updater.json` asset.
6. **Smoke test**: download each artifact, run
   it in a CI runner (or a VM), and confirm it
   launches + the updater endpoint returns the
   expected JSON.

The smoke test is the last step; if it fails,
the Release is unpublished (or marked as a
"draft" — the project lead's call).

#### Why tags instead of `on: push: branches: [main]`

- A tag-triggered release is **opt-in**: the
  project lead decides when to release.
- The tag is a permanent record of "this commit
  was v0.1.0"; the GitHub Release is
  auto-populated from the tag.
- A future phase could add a "nightly" workflow
  on `push: branches: [main]` that publishes a
  pre-release for the dev channel; Phase 5
  doesn't.

### 3. Code signing wiring (`src-tauri/tauri.conf.json`)

Phase 5 updates `tauri.conf.json` to include
platform-specific code-signing config:

```jsonc
{
  "bundle": {
    "createUpdaterArtifacts": true,
    "macOS": {
      "signingIdentity": "Apple Distribution: Lipi Contributors (TEAMID)",
      "providerShortName": "TEAMID",
      "entitlements": "src-tauri/entitlements/macos.plist"
    },
    "windows": {
      "certificateThumbprint": "WINDOWS_CERT_THUMBPRINT",
      "digestAlgorithm": "sha256",
      "timestampUrl": "http://timestamp.digicert.com"
    }
  }
}
```

The `entitlements/macos.plist` file declares the
sandbox + hardened-runtime exceptions Lipi needs
(electron-equivalent: `com.apple.security.cs.allow-
jit` for V8, `com.apple.security.cs.allow-unsigned-
executable-memory` for the Monaco editor, etc.).
The full entitlements list is platform-specific and
shops-tested in the Tauri 2 docs; Phase 5 ships a
conservative default that the project lead can
tighten once a real Apple Developer ID is in
hand.

### 4. Versioning policy (`docs/RELEASING.md` + CI guards)

A new doc at `docs/RELEASING.md` that captures the
release process in 5 steps (the same 5 as the
"Goal" section above). The doc is linked from
HANDOFF §6 so the project lead (or a future
contributor) can ship a release without reading
the CI YAML.

A new CI guard in `.github/workflows/ci.yml` (the
existing on-PR workflow) that fails the build if:

- `package.json` version != `Cargo.toml` version
  != `tauri.conf.json` version
- The Rust source code has any
  `#[cfg(feature = "dev-only-…")]` feature
  enabled (a sanity check that dev-only
  features don't ship in release builds)
- The dev updater keypair is referenced from
  any release build's `tauri.conf.json`
  (catches "I forgot to rotate the keypair"
  bugs at PR time, not at release time)

### 5. Updater endpoint health checks (`src/voice/...`)

Wait, the updater health check is a Rust-side
concern, not voice. It's a new module at
`src-tauri/src/updater_health.rs` that:

- Polls the configured updater endpoint on
  app start (one HTTP GET, no auth, 5s timeout)
- Caches the response in memory for the session
  (so we don't hit GitHub on every app launch)
- Exposes a Tauri command `updater_health_check
  -> Result<UpdaterHealth, String>` that the
  frontend can call from the About screen
  ("Updater: ✓ reachable" / "Updater: ✗
  unreachable — github.com is down or your
  firewall is blocking the request")
- Logs the result to the Rust `log` crate
  (visible via `RUST_LOG=info lipi` from a
  terminal)

The health check is a Phase 5 nice-to-have
because users in restricted networks (corporate
firewalls, China's GFW) report "the updater
doesn't work" bugs. Phase 5 ships a
self-diagnostic tool that the support team can
ask users to run.

The Tauri command is gated `#[cfg(not(mobile))]`
(desktop-only; mobile apps have their own
updater).

## Architecture overview

```
   Project lead                          GitHub Actions               End user
   ───────────                          ───────────────              ────────
   git tag v0.1.0
   git push --tags  ──────────►  release.yml triggers
                                   │
                                   ├──► macos-latest runner
                                   │      │
                                   │      ├── npm ci
                                   │      ├── npm test
                                   │      ├── cargo test
                                   │      ├── cargo tauri build
                                   │      │   (signs with
                                   │      │    APPLE_ID + team ID)
                                   │      └── uploads .app.tar.gz
                                   │            + .sig
                                   │
                                   ├──► windows-latest runner
                                   │      ├── (same tests)
                                   │      ├── cargo tauri build
                                   │      │   (signs with
                                   │      │    WINDOWS_CERT_FILE)
                                   │      └── uploads .msi + .sig
                                   │            + .exe + .sig
                                   │
                                   ├──► ubuntu-latest runner
                                   │      ├── (same tests)
                                   │      ├── cargo tauri build
                                   │      └── uploads .AppImage + .sig
                                   │            + .deb + .sig
                                   │
                                   └──► publish GitHub Release
                                            with all 3 platforms'
                                            artifacts + updater.json
                                                              │
                                                              ▼
                                                  Existing user opens app
                                                              │
                                                              ▼
                                                  Tauri updater polls
                                                  https://github.com/lipi-dev/lipi/releases/latest/download/updater.json
                                                              │
                                                              ▼
                                                  Sees v0.1.0, downloads
                                                  .app.tar.gz.sig, verifies
                                                  with embedded production
                                                  pubkey, installs, relaunches.
```

The project lead's only input is the `git tag`.
Everything else is automated. The CI is idempotent:
a re-run of the same tag regenerates the same
artifacts (the `.sig` files are deterministic given
the same input + key).

## Data model

No new types. Phase 5 uses the existing
`tauri-plugin-updater` config and adds:

- A new Rust module `src-tauri/src/updater_health.rs`
  with a small `UpdaterHealth` enum (`reachable` /
  `unreachable` / `error(String)`).
- A new Tauri command `updater_health_check` (gated
  `#[cfg(not(mobile))]`).
- A new TS wrapper `src/ipc/updaterHealth.ts` that
  re-exports the command.
- A new About-screen row in the existing
  `AboutModal` ("Updater: ✓ reachable / ✗
  unreachable").

The `UpdaterHealth` enum is the only new type. The
CI YAML is configuration, not code; the
`docs/RELEASING.md` doc is documentation, not code.

## File layout

New files:

```
.github/workflows/release.yml               # The release pipeline
.github/workflows/ci.yml                    # The on-PR CI (existing; Phase 5 adds version-checks)
docs/RELEASING.md                           # The 5-step release process
docs/decisions/0094-p5-prod-keypair.md      # ADR: separate prod + dev keypairs
docs/decisions/0095-p5-update-server.md     # ADR: GitHub Releases as the updater server
docs/decisions/0096-p5-ci-platforms.md      # ADR: matrix builds across 3 OSes
src-tauri/src/bin/rotate_updater_key.rs     # The key-rotation CLI
src-tauri/src/updater_health.rs             # The health-check module
src-tauri/src/updater_health.test.rs        # The health-check tests
src/ipc/updaterHealth.ts                    # The TS wrapper
src/ipc/updaterHealth.test.ts               # The TS wrapper tests
```

Modified files:

```
src-tauri/tauri.conf.json                    # Add createUpdaterArtifacts + platform signing config
src-tauri/src/lib.rs                         # Register updater_health_check command
src-tauri/Cargo.toml                        # No new deps (uses reqwest which is already there)
package.json                                # Add `release` script alias
src/shared/components/AboutModal/...        # Add the updater-health row
CHANGELOG.md                                # New "Added (Phase 5 — Production release pipeline)" section
HANDOFF.md                                  # §6 "Current phase" + §9.26
```

The `rotate_updater_key` CLI is ~150 lines + ~50
lines of tests. The `updater_health` module is ~80
lines + ~30 lines of tests. The CI YAML is ~200
lines (the bulk is the matrix-build matrix +
per-platform build steps + the smoke test).

## The keypair-rotation model

The Tauri updater has a one-pubkey-per-app model:
the `pubkey` in `tauri.conf.json` is embedded into
the binary at build time and used to verify ALL
future updates. If the project lead rotates the
keypair (e.g. the private key is compromised, or
it's time for the quarterly rotation), the
**existing users can't update to the new pubkey**
— their installed binary still uses the old pubkey.

Tauri 2.10 solves this with the runtime pubkey
override (`app.updater_builder().pubkey("…")`).
Phase 5's `rotate_updater_key` CLI ships a
"dual-pubkey" transition period:

1. Project lead generates the new keypair.
2. The CLI updates the binary's `pubkey` field to
   the new pubkey, BUT also adds a "transition
   list" of old pubkeys to the binary's
   `acceptable_pubkeys` field.
3. For 6 months, the binary accepts updates signed
   with EITHER the new or the old pubkey.
4. After 6 months (when the project lead is
   confident all users have updated), the CLI
   removes the old pubkey from the
   `acceptable_pubkeys` field.

This is a future-phase feature; Phase 5's CLI
ships the basic single-pubkey version. The
dual-pubkey transition is a follow-up (a few
lines of code in `rotate_updater_key.rs` +
updating the lib.rs init).

The **immediate** key rotation in Phase 5 is:
generate a new keypair, replace the pubkey,
ship a new release. The old key is
decommissioned (no new updates signed with it),
but users who haven't updated yet can still
get updates signed with the old key (because
their installed binary still trusts the old
pubkey). Eventually, the project lead either
(a) waits for the user base to update, or
(b) ships a "forced update" build (an installer
that updates the embedded pubkey and then
self-updates — Tauri's runtime override makes
this possible but is a future phase).

## The release process

1. **Pre-flight**:
   - `npm test` is green on `main`.
   - `cargo test` is green on `main`.
   - `npm run build` is green on `main`.
   - All `phase-N` items in HANDOFF §6 are
     SHIPPED (Phase 5 is the last one).
2. **Bump versions**:
   - `package.json`: `0.0.2` → `0.1.0`
   - `Cargo.toml`: `0.0.2` → `0.1.0`
   - `tauri.conf.json`: `0.0.2` → `0.1.0`
   - `CHANGELOG.md`: add the new version's
     `## [0.1.0]` section (with the same
     "Added / Changed / Fixed" structure as the
     `[Unreleased]` section).
3. **Tag the release**:
   - `git add -A && git commit -m "Bump version to 0.1.0"`
   - `git tag v0.1.0`
   - `git push --follow-tags`
4. **Wait for CI**:
   - The release workflow runs the 3 matrix
     builds + the smoke test (~15-30 min on
     GitHub-hosted runners).
   - The project lead watches the run; if any
     step fails, they `git push --delete
     origin v0.1.0` to cancel the release
     (CI doesn't auto-publish on failure).
5. **Verify the release**:
   - The GitHub Release is published with all
     the artifacts.
   - The `updater.json` is generated and
     uploaded.
   - The project lead downloads one of the
     installers (e.g. the Windows `.msi`) and
     installs it on a clean machine; the OS
     shows their name as the publisher (not
     "Unknown Publisher").
   - The installed app launches cleanly.
   - The installed app's "About" → "Updater
     health" row says "✓ reachable".

## Test plan

### Rust unit tests (`src-tauri/src/updater_health.rs`)

1. `updater_health_check_with_200_returns_reachable`.
2. `updater_health_check_with_404_returns_unreachable`.
3. `updater_health_check_with_timeout_returns_unreachable`.
4. `updater_health_check_with_invalid_url_returns_error`.

### Rust CLI tests (`src-tauri/src/bin/rotate_updater_key.rs`)

1. `validate_pubkey_accepts_valid_tauri_pubkey`.
2. `validate_pubkey_rejects_invalid_base64`.
3. `validate_pubkey_rejects_wrong_prefix`.
4. `patch_tauri_conf_replaces_pubkey_in_place`.
5. `patch_tauri_conf_preserves_other_fields`.

### TS unit tests (`src/ipc/updaterHealth.test.ts`)

1. `updaterHealthCheck_invoke_wire_shape`.
2. `updaterHealthCheck_returns_reachable_for_200`.
3. `updaterHealthCheck_returns_unreachable_for_404`.

### CI smoke tests (`.github/workflows/release.yml`)

1. `release.yml` parses as valid YAML (the
   `actionlint` GitHub Action runs on PRs).
2. A dry-run of the release workflow on a
   throwaway tag (`v0.0.0-test`) completes
   without errors (CI logs from a real run).
3. The uploaded artifacts match the expected
   names (`.msi`, `.exe`, `.app.tar.gz`,
   `.AppImage`, `.deb`, plus their `.sig`
   files).

### Integration tests

Phase 5 doesn't ship integration tests for the
release pipeline (the smoke test IS the
integration test). Future phases could add
`act` (Rust actor testing) for the
`updater_health` module to test the HTTP
polling without a real server.

Total: **~10 new unit tests** (4 Rust health + 5
Rust CLI + 3 TS wrapper + the 3 CI smoke tests
are config-time, not code-time).

## Open questions / future work

1. **Should the updater endpoint be GitHub
   Releases, or a custom S3 bucket?** GitHub
   Releases is free + integrated with the
   source repo. S3 is faster + supports
   differential updates (the updater downloads
   only the changed parts of the bundle). For
   v1, GitHub Releases is enough (the user
   base is small; bandwidth isn't a bottleneck).
   A future phase could move to S3 if the
   project lead wants differential updates.

2. **Should the release be auto-published, or
   a draft for review?** Phase 5 auto-publishes
   on CI success. A future phase could add a
   "release-candidate" workflow that publishes
   a draft for the project lead to review,
   then click "Publish" to make it live.

3. **Should the smoke test run on a real
   machine, or a CI runner?** GitHub-hosted
   runners can run a Tauri app headlessly
   (it's just a binary). The smoke test runs
   `lipi.exe --smoke-test` (a new flag the
   project lead adds in a future phase) which
   launches the app, confirms the updater
   endpoint returns 200, and exits 0. Phase 5
   doesn't add the `--smoke-test` flag; the
   smoke test in v1 is "the CI runner launches
   the binary, confirms the process is alive
   for 5 seconds, and exits".

4. **What about the iOS / Android updater?**
   Tauri 2's updater plugin supports iOS and
   Android, but the bundling is different (App
   Store + Google Play handle the
   "auto-update" via their own mechanisms).
   Phase 5 doesn't ship mobile.

5. **What if the production private key is
   compromised?** The project lead runs
   `rotate_updater_key` to generate a new
   keypair and re-publish. Existing users
   can't update (their installed binary
   still trusts the old pubkey); they have to
   manually download a new installer. The
   "dual-pubkey transition" future-phase
   feature solves this by accepting both
   old and new pubkeys for a transition
   period.

## Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| CI runner runs out of disk during the macOS build | Low | High | The macOS build target (`universal-apple-darwin`) produces a 200+ MB binary; GitHub-hosted runners have 14 GB of SSD. The CI logs the disk usage at the start; if it's < 5 GB, the build aborts with a clear error. |
| Code signing certificate expires mid-quarter | Low | High | The CI logs a warning if the cert is < 30 days from expiry. The project lead renews the cert and updates the CI secret. |
| GitHub Releases is unreachable from a user's network | Low | Medium | The `updater_health` module lets users diagnose this; the project's support docs recommend a manual download. |
| A user installs the dev keypair (because the project lead forgot to rotate) | Low | Critical | The CI guard in `ci.yml` (fails the build if `tauri.conf.json` references the dev keypair) catches this at PR time. The smoke test verifies the installed binary is signed with the production cert. |
| The release artifact has a critical bug and the user base auto-updates to it | Medium | High | Tauri 2.10 supports an "update cancel" mechanism: the `updater.json` can include a `minimumSystemVersion` field, and the `rollback` workflow can publish a "yank" Release that the running app checks for. Phase 5 doesn't ship the yank workflow; a future phase will. |
| The signing key password is leaked (e.g. a CI log) | Low | Critical | The CI uses `secrets.TAURI_PROD_UPDATER_KEY_PASSWORD` (GitHub's encrypted secrets store, masked in logs). The project lead never logs the password. The CI runs in a clean ephemeral runner (no state persists between runs). |
| A malicious PR adds a new Tauri command that exfiltrates data | Low | High | The existing on-PR CI runs `npm test` + `cargo test` + `npm run build` + `cargo check`. A malicious PR can hide its payload in a non-test file, but the PR review process (project lead reviews every PR) is the primary defense. Phase 5 doesn't add a static-analysis gate. |

The risks are bounded. The release pipeline is
declarative (YAML) + the keypair management is
operational (CI secrets). The only new code is the
`updater_health` module (~80 lines) and the
`rotate_updater_key` CLI (~150 lines) — both
small, both tested.

## What this design does NOT cover

- **No real IAP wiring.** Phase 4.
- **No mobile (iOS / Android) distribution.**
  Tauri 2 supports mobile, but the App Store +
  Google Play pipelines are different. Future
  phase.
- **No Linux distribution channels (Snap,
  Flathub, AUR).** The Tauri build produces a
  `.deb` and `.AppImage`; the project lead can
  submit those to the channel maintainers
  manually. A future phase could automate
  this.
- **No static analysis (clippy / eslint) in
  CI.** The existing on-PR CI runs the test
  suites + the build, which catches most
  bugs. A future phase could add `cargo
  clippy -- -D warnings` and `eslint
  --max-warnings 0` as additional gates.
- **No SBOM (Software Bill of Materials)
  generation.** A future phase could add
  `cargo-cyclonedx` or similar to generate a
  SBOM for the release; some enterprise
  customers require it.
- **No signing of the JS bundle.** Tauri's
  default is "the HTML is signed as part of
  the binary"; a future phase could add a
  Subresource Integrity (SRI) hash for any
  externally-loaded JS.

## References

- `HANDOFF.md §6 "Current phase: Phase 5 — Production release pipeline — SHIPPED"` (post-Phase-5)
- `HANDOFF.md §6 "Next: Phase 4 — App Store IAP + sign-license CLI"` (Phase 4 is the
  *only* remaining code phase after this)
- `HANDOFF.md §9.26` — the per-phase writeup of Phase 5
- `docs/plans/prod-p2-licensing-design.md` — the
  Phase 2 design (the production keypair is
  separate from the licensing keypair; both are
  Ed25519 but they sign different things)
- `docs/plans/prod-p3-subscription-ux-design.md` —
  the Phase 3 design (the `sign_license` CLI is
  the same pattern as the `rotate_updater_key`
  CLI: a small Rust binary that the project
  lead runs from a terminal)
- `tauri.conf.json` — the existing updater
  config (the dev pubkey is already
  committed; Phase 5 rotates it to the
  production pubkey)
- `tauri-plugin-updater` docs — the
  v2.10 API for runtime pubkey override
  (`app.updater_builder().pubkey("…")`)

---

*This is a design doc. Implementation will follow in Phase 5b
of the production-readiness todo list.*
