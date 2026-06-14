# Decision #96 — Phase 5: matrix builds across 3 OSes (macOS, Windows, Linux) in CI, not Docker

**Date**: June 2026
**Phase**: 5 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

The Tauri build for macOS, Windows, and Linux
each requires a platform-native toolchain:

- **macOS**: Xcode + the macOS SDK (for
  `aarch64-apple-darwin` and
  `x86_64-apple-darwin` targets). Code signing
  uses the `codesign` binary; notarization uses
  `notarytool`.
- **Windows**: MSVC + the Windows SDK (for
  `x86_64-pc-windows-msvc` and
  `aarch64-pc-windows-msvc` targets). Code
  signing uses `signtool` (part of the Windows
  SDK).
- **Linux**: `gcc` + `libwebkit2gtk-4.1-dev` +
  `libgtk-3-dev` + `libayatana-appindicator3-dev`
  + `librsvg2-dev` + `patchelf` (for
  `x86_64-unknown-linux-gnu` and
  `aarch64-unknown-linux-gnu` targets). Code
  signing for `.deb` uses `dpkg-sig`; for
  `.AppImage` it's optional.

The Tauri team's official recommendation is to
use **GitHub Actions matrix builds** with one
runner per platform. The question for Phase 5
is: do we follow Tauri's recommendation, or
try to do something cleverer (Docker, single
self-hosted runner, etc.)?

## Decision

**Follow Tauri's recommendation: GitHub Actions
matrix builds with one runner per platform.**
The release workflow (`.github/workflows/release.yml`)
has a `build` job with a matrix that includes
three entries (one per OS), each on a
GitHub-hosted runner:

- `macos-latest` → builds `.app` + `.dmg` +
  `.app.tar.gz` (the updater bundle)
- `windows-latest` → builds `.msi` + `.exe` (NSIS)
- `ubuntu-22.04` → builds `.AppImage` + `.deb`

The matrix runs in parallel; the project lead
sees a single workflow with 3 platform-specific
build steps + a final `release` job that uploads
all 3 sets of artifacts to a GitHub Release.

The `cargo tauri build` command is run on each
runner with the platform-appropriate
`TAURI_SIGNING_PRIVATE_KEY` +
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env vars
(plus the macOS / Windows-specific secrets for
code signing).

## Why

**Each Tauri build needs a native toolchain.**
You cannot cross-compile from Linux to macOS
(the macOS SDK is EULA-restricted to macOS
hardware). You cannot build a Windows `.msi`
from a Linux runner (the WiX toolchain is
Windows-specific). Each platform must be built
on its native OS.

**GitHub-hosted runners are platform-native.**
`macos-latest` is a real macOS VM with Xcode
pre-installed. `windows-latest` is a real
Windows VM with Visual Studio Build Tools
pre-installed. `ubuntu-22.04` is a real Ubuntu
VM. The setup time per job is ~30s; the build
time is ~10-25 minutes per platform (the
matrix runs in parallel; total wall time is
~25 minutes, not 75).

**GitHub-hosted runners are ephemeral.** Each
job gets a clean VM; no state persists between
jobs. This is exactly what we want for a
release build — no risk of stale state, no
risk of "I built v0.1.0 with the v0.0.9 cache".

**GitHub Actions is free for public repos.**
The release workflow uses ~3 build-minutes
per release on macOS (which costs ~$0.08/min
on the free tier; free for public repos),
~5 build-minutes on Windows, ~3 build-
minutes on Linux. Total cost: ~$0.50 per
release, free for public repos.

**Matrix builds scale linearly.** Adding a
new platform (e.g. FreeBSD, if Tauri ever
supports it) is a 5-line change to the
matrix in `release.yml`.

## Alternatives considered

### A) Docker-based cross-compilation

**Pros**: a single CI runner (cheaper); no
need for 3 different runner types; the
build environment is reproducible (a
checked-in `Dockerfile`).

**Cons**:
- **macOS cannot be cross-compiled to.** The
  macOS SDK is EULA-restricted to Apple
  hardware. We'd still need a macOS runner
  for the macOS builds; the Docker approach
  only saves us the Windows + Linux runners.
- **Cross-compiling from Linux to Windows
  is technically possible** (via
  `cargo-xwin` + the Windows SDK), but
  produces inferior binaries (the resulting
  `.msi` doesn't include the Windows
  manifest correctly, the SmartScreen
  warnings are louder, etc.). Tauri's docs
  explicitly recommend native builds.
- **Cross-compiling from Linux to Linux
  (aarch64 from x86_64) is fine** for
  simple projects but the Tauri build pulls
  in many native deps (WebKit, GTK) that
  don't cross-compile cleanly.
- **Docker adds a layer of indirection**
  that's hard to debug. "Why did the
  build fail in CI but pass locally?"
  becomes "the Docker image has
  package versions that differ from your
  laptop".

**Rejected** because the cost savings
(saving 2 runners) are negligible (~$0.30
per release) and the complexity tax
(Dockerfile maintenance + cross-compile
debugging) is high.

### B) Self-hosted runner on the project lead's Mac mini

**Pros**: full control over the build
environment; can pre-install Xcode + iOS
SDK for future iOS support; no GitHub
runner minute costs (but GitHub is free
for public repos anyway).

**Cons**:
- **Single point of failure** — if the
  Mac mini is offline, no releases can
  ship. A future phase could add a
  second self-hosted runner, but that's
  another machine to maintain.
- **No Linux + Windows builds** — a
  single Mac mini can only build macOS
  (cross-compiling to Windows / Linux
  is fragile, as discussed above).
- **Manual upgrade burden** — the project
  lead has to keep the macOS version,
  Xcode version, Node version, Rust
  version in sync with the rest of the
  project. GitHub-hosted runners
  auto-update.
- **Security** — a self-hosted runner
  has the project lead's GitHub token
  on a physical machine. If the machine
  is compromised, an attacker could
  push to `main` and read all the
  secrets.

**Rejected** for v0.1.0. **Accepted** as
a future-phase feature for v0.2.0+
(when iOS support is added and the
project lead wants to keep the iOS
builds in-house).

### C) Single platform only (e.g. only ship macOS for v0.1.0)

**Pros**: smallest CI footprint; no need
to maintain Windows + Linux runners; the
project lead only has to procure one code
signing cert (Apple Developer ID, $99/year).

**Cons**: only Mac users can use Lipi.
Lose ~75% of the potential user base
(Windows is the largest desktop OS;
Linux is the developer stronghold).

**Rejected** because Lipi's whole pitch
is "cross-platform IDE"; shipping a
single-platform v0.1.0 would be
inconsistent with the project's identity.

### D) Cloud-based build services (e.g. CircleCI, Buildkite, Travis)

**Pros**: CircleCI / Buildkite have
better matrix-build UX than GitHub
Actions (or did, historically); Travis
has been the de-facto standard for
open-source Rust projects for years.

**Cons**: yet another vendor to set up;
yet another `secrets` store; the
project lead would have to maintain
2 CI configs (GitHub Actions for
the on-PR CI, CircleCI for the
release builds). Most of these services
charge per build-minute (and Lipi
shipped as a public repo on GitHub,
so GitHub Actions is free).

**Rejected** because GitHub Actions
is sufficient and the project is
already on GitHub. Adding a second
CI vendor is operational overhead
with no benefit.

## What this means for the v0.1.0 release

1. The project lead pushes a `vX.Y.Z` tag.
2. The release workflow creates 3 parallel
   build jobs (one per OS).
3. Each job:
   - Installs platform deps (Linux only)
   - Runs the test suite
   - Runs the build
   - Signs the build (if the code-signing
     secrets are set)
   - Uploads the artifacts
4. The `keypair-guard` job validates
   `tauri.conf.json`'s pubkey (release
   only).
5. The `updater-json` job generates
   `updater.json` from the artifacts.
6. The `release` job uploads everything
   to GitHub.
7. The `smoke-test` job (matrix across
   the 3 OSes) downloads each platform's
   binary, launches it, confirms it
   stays alive for 5s, and exits.
8. The Release is published.

Total wall time: ~25-35 minutes (the
smoke test waits for the release to
publish; the matrix builds run in
parallel).

## What this does NOT cover

- **iOS / Android builds.** The release
  pipeline is desktop-only. Mobile
  distribution (App Store Connect +
  Google Play Console) is a separate
  pipeline with its own signing
  requirements; future phase.
- **Linux distribution channels** (Snap,
  Flathub, AUR). The Tauri build
  produces a `.deb` and `.AppImage`;
  the project lead can submit those to
  the channel maintainers manually.
  A future phase could automate this.
- **Reproducible builds** (a build
  produces a bit-for-bit identical
  binary regardless of the build
  environment). This requires
  `SOURCE_DATE_EPOCH` + a fixed Rust
  toolchain version, both of which
  Phase 5 partially does. A future
  phase could lock the toolchain
  to a specific Docker image.
- **Build caching** (cargo caches
  dependencies across builds).
  GitHub Actions supports this via
  the `actions/cache@v4` action;
  Phase 5 doesn't use it because
  the build time is already
  acceptable (~10-25 minutes per
  platform). A future phase could
  add it.
