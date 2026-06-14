# Releasing Lipi

The 5-step process for shipping a public release.
The whole thing is `git tag → push → wait → verify`,
so a release can be done in under 30 minutes
(mostly waiting for CI to build the 3 platform
binaries).

> **Audience**: project lead (the only person with
> write access to `main` + the CI secrets) and any
> future release captain (a contributor the project
> lead trusts to ship a patch release in their
> absence).

> **Pre-requisites**: Phase 5 must be shipped
> (the `release.yml` workflow must exist in
> `.github/workflows/`). If you don't see the
> `Release` workflow in the GitHub Actions tab,
> see `docs/plans/prod-p5-release-pipeline-design.md`
> for the design + `HANDOFF.md §9.26` for the
> implementation log.

## The 5 steps

### 1. Pre-flight (5 minutes)

Confirm everything is green on `main`:

```bash
# 1.1 — pull the latest main
git checkout main
git pull origin main

# 1.2 — run the local test suite
npm ci
npm test -- --run              # vitest
npm run build                  # vite + tsc
cd src-tauri
cargo test --workspace         # cargo test
cargo check --all-targets      # cargo check
cd ..

# 1.3 — confirm no in-progress work
git status                     # should be clean
```

If any test fails, fix it before continuing. A
release with a failing test goes out broken.

### 2. Bump versions (2 minutes)

Three files must agree on the new version. The
CI version-guard will block the release if they
don't.

| File | Field |
|------|-------|
| `package.json` | `"version": "X.Y.Z"` |
| `src-tauri/Cargo.toml` | `version = "X.Y.Z"` |
| `src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` |

Also update `CHANGELOG.md`: move the
`## [Unreleased]` section's content into a new
`## [X.Y.Z] - YYYY-MM-DD` section, and start a
fresh empty `## [Unreleased]` above it.

Commit the version bump + CHANGELOG:

```bash
git add -A
git commit -m "Bump version to X.Y.Z"
```

### 3. Tag the release (1 minute)

```bash
# Tags follow SemVer: vMAJOR.MINOR.PATCH.
# - MAJOR: breaking change (e.g. settings file
#   format change, paid → free → paid model).
# - MINOR: new feature, backward-compatible
#   (e.g. a new editor view, a new IPC
#   command).
# - PATCH: bug fix, no new features.
git tag vX.Y.Z
git push --follow-tags
```

The `git push --follow-tags` is critical — it
pushes the tag in the same operation as the
commit, so CI sees both atomically. The release
workflow triggers on the tag push.

### 4. Wait for CI (15-30 minutes)

The release workflow runs 4 jobs in parallel:

1. **build** (matrix across macOS, Windows, Linux)
   — ~10-25 minutes per platform
2. **keypair-guard** — ~10 seconds
3. **updater-json** — ~30 seconds (after `build`
   + `keypair-guard` complete)
4. **release** — ~30 seconds (after `build` +
   `updater-json` complete)
5. **smoke-test** (matrix across macOS, Windows,
   Linux) — ~1 minute per platform

Total wall time: ~15-30 minutes (the matrix
builds run in parallel; the smoke test waits
for the release to publish).

**What to do if a job fails**:

| Failed job | What it means | What to do |
|------------|---------------|------------|
| `build` (one platform) | The Tauri build failed on that OS (e.g. a Windows-specific Rust bug, a missing Linux dep). | Fix the bug, delete the tag (`git push --delete origin vX.Y.Z`), commit the fix, re-tag (`git tag -f vX.Y.Z && git push --follow-tags --force`). |
| `keypair-guard` | `tauri.conf.json` still references the dev keypair. | Run the `rotate_updater_key` CLI: `rotate_updater_key --pubkey-file src-tauri/keys/production/production.key.pub`. Commit the patched `tauri.conf.json`. Re-tag. |
| `updater-json` | No platform produced a valid `.sig` file (the updater signing was probably skipped because the `TAURI_PROD_UPDATER_KEY` secret is missing). | Add the secret to GitHub repo settings, re-tag. |
| `release` | The `softprops/action-gh-release@v2` step failed (e.g. permissions). | Check the workflow logs. If it's a permissions issue, add the missing permission to `permissions:` in the workflow file. Re-tag. |
| `smoke-test` (one platform) | The binary crashed within 5 seconds of launch. | This is a real bug. Fix it, re-tag. Do NOT publish a release with a known broken platform — instead, publish a "Linux-only" or "Windows-only" release by removing the broken matrix entry temporarily. |

**Important**: if the release workflow has already
published the GitHub Release before a downstream
job (like `smoke-test`) fails, you must manually
unpublish the Release on GitHub (Repo →
Releases → Edit → uncheck "Publish" or delete
the release). The CI doesn't auto-unpublish on
failure.

### 5. Verify the release (5 minutes)

Once the workflow is green:

1. **Visit the GitHub Release**: open
   `https://github.com/lipi-dev/lipi/releases/tag/vX.Y.Z`.
2. **Confirm the assets are present**: the Release
   should have:
   - `Lipi_X.Y.Z_x64_en-US.msi` (Windows MSI)
   - `Lipi_X.Y.Z_x64-setup.exe` (Windows NSIS)
   - `Lipi_X.Y.Z_aarch64.dmg` (macOS Apple Silicon)
   - `Lipi_X.Y.Z_x64.dmg` (macOS Intel)
   - `Lipi_X.Y.Z_amd64.AppImage` (Linux x86_64)
   - `Lipi_X.Y.Z_amd64.deb` (Linux Debian package)
   - `updater.json` (the updater manifest)
3. **Download one of the installers** and install
   it on a clean machine (a VM, or your personal
   laptop — NOT your dev machine, where you might
   have leftover state from previous runs):
   - **macOS**: open the `.dmg`, drag the app to
     Applications, launch it. The OS should NOT
     show "cannot be opened because the developer
     cannot be verified" (if it does, the
     notarization step failed — check the CI logs).
   - **Windows**: run the `.msi` or `setup.exe`.
     SmartScreen should NOT show "Unknown
     Publisher" (if it does, the Authenticode
     signing failed).
   - **Linux**: `chmod +x Lipi_*.AppImage && ./Lipi_*.AppImage`.
     Should launch cleanly. The `.deb` installs
     via `sudo dpkg -i Lipi_*.deb`.
4. **Confirm the app launches**: the splash
   screen, then the editor. The "About Lipi"
   panel should show:
   - "Lipi X.Y.Z" in the version line
   - "✓ reachable" in the Updater row
5. **Confirm the updater works**: on the same
   machine, install vX.Y.Z - 1 (the previous
   release). Launch it. After a few seconds, the
   app should show a "vX.Y.Z is available" dialog.
   Click "Update", wait for the download, and
   confirm the app re-launches as vX.Y.Z.

If all 5 checks pass, the release is shipped.

## After the release

- **Post the release notes** to the project
  website / mailing list / social media. The
  release body on GitHub is auto-generated from
  the commit log; the project lead can edit it
  to add a user-facing summary.
- **Update the download links** on the project
  website. The release workflow doesn't touch
  the website (we don't have a website builder
  in CI; that's a future phase).
- **Close the milestone** in the issue tracker
  (the "vX.Y.Z" milestone). Any issues that
  weren't fixed in this release can be moved
  to the "vX.Y+1.Z" milestone.
- **Announce in the project chat** (Slack,
  Discord, etc.).

## What if the release has a critical bug?

If a bug is found after the release is
published:

1. **Fix the bug** (commit on `main`).
2. **Bump to X.Y.Z+1** (e.g. from v0.1.0 to
   v0.1.1) — a PATCH release.
3. **Re-tag** (`git tag -f vX.Y.Z+1`).
4. **Push** (`git push --follow-tags --force`).
5. The release workflow re-runs and publishes
   vX.Y.Z+1. The `latest` endpoint points to
   the new release; existing users get the
   update via the in-app updater.

If the bug is so critical that existing users
need to be stopped from downloading vX.Y.Z:

1. **Unpublish the release** on GitHub (Repo →
   Releases → Edit → uncheck "Publish" or
   delete).
2. **Fix the bug**.
3. **Bump + re-tag** as above.

There's no "yank" workflow in Phase 5 — a
future phase will add one. For now, unpublishing
+ re-tagging is the workaround.

## Appendix: the CI secrets cheat sheet

The release workflow reads these secrets from
the GitHub repo settings. The project lead sets
them up **once**, before the first release:

| Secret | Source | Used by |
|--------|--------|---------|
| `TAURI_PROD_UPDATER_KEY` | Contents of `src-tauri/keys/production/production.key` (the PEM). | All platforms. |
| `TAURI_PROD_UPDATER_KEY_PASSWORD` | The password set when the key was generated. | All platforms. |
| `APPLE_ID` | Apple Developer account email. | macOS. |
| `APPLE_PASSWORD` | App-specific password for the Apple Developer account (created at appleid.apple.com). | macOS. |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID. | macOS. |
| `WINDOWS_CERT_FILE` | Base64-encoded `.pfx` (the EV or OV code signing certificate). | Windows. |
| `WINDOWS_CERT_PASSWORD` | The password for the `.pfx`. | Windows. |

If any secret is missing, the corresponding
platform's build **still goes out** (the
workflow doesn't fail on missing secrets), but
the OS will show "Unknown Publisher" on first
launch. The project lead's call whether to ship
a release with unsigned binaries or wait until
the secret is set up.

**For the v1 release (v0.1.0)**, the project
lead may choose to ship without macOS / Windows
code signing (only updater signing), accepting
the "Unknown Publisher" warning. The project
lead enrolls in the Apple Developer Program +
procures an EV cert for the v0.2.0 release.

## Appendix: how to generate the production keypair

This is a **one-time** operation, done before
the v0.1.0 release:

```bash
# 1. Generate the keypair. The Tauri CLI
#    produces a .key (private) and a .key.pub
#    (public) in the home directory by default.
npx tauri signer generate -w src-tauri/keys/production/production.key

# 2. The CLI prompts for a password. Set a
#    strong 32+ character password. Save it in
#    your password manager.

# 3. Copy the .key file's contents to the
#    TAURI_PROD_UPDATER_KEY GitHub secret.
cat src-tauri/keys/production/production.key
# → paste into GitHub repo settings → Secrets

# 4. Add the password to the
#    TAURI_PROD_UPDATER_KEY_PASSWORD secret.

# 5. Update tauri.conf.json to reference the
#    new pubkey. The rotate_updater_key CLI
#    does this in-place:
./src-tauri/target/debug/rotate_updater_key \
  --pubkey-file src-tauri/keys/production/production.key.pub

# 6. Commit the patched tauri.conf.json.
git add src-tauri/tauri.conf.json
git commit -m "Rotate to production updater keypair"
```

The `.key` file should also be backed up to an
encrypted offline USB (the project lead's
personal backup). If the GitHub secret is ever
lost, the project lead can recover the key from
the USB.

## References

- `docs/plans/prod-p5-release-pipeline-design.md`
  — the design doc for Phase 5
- `HANDOFF.md §6 "Current phase: Phase 5 —
  Production release pipeline — SHIPPED"`
- `HANDOFF.md §9.26` — the per-phase writeup
  of Phase 5
- `.github/workflows/release.yml` — the release
  pipeline (matrix builds + code signing +
  updater.json + smoke test)
- `.github/workflows/ci.yml` — the on-PR CI
  (vitest + cargo test + version guard)
- `docs/decisions/0094-p5-prod-keypair.md` —
  why a separate production + dev keypair
- `docs/decisions/0095-p5-update-server.md` —
  why GitHub Releases as the updater server
- `docs/decisions/0096-p5-ci-platforms.md` —
  why matrix builds across 3 OSes
