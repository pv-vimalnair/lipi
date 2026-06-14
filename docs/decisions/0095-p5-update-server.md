# Decision #95 — Phase 5: use GitHub Releases as the updater server (don't run our own)

**Date**: June 2026
**Phase**: 5 of the production-readiness roadmap
**Deciders**: project lead (Vimal Nair)

## Context

The Tauri updater plugin polls a URL on app start
to check for new versions. The response is a JSON
file (`updater.json`) that lists the latest
version, the platform-specific download URLs, and
the Ed25519 signatures (signed at build time by
the production keypair from Decision #94). The
URL is configured in `tauri.conf.json`'s
`plugins.updater.endpoints` array; the existing
value is
`https://github.com/lipi-dev/lipi/releases/latest/download/updater.json`.

The question: do we use GitHub Releases as the
updater server, or run our own (S3 + CloudFront,
a dedicated `update.lipi.app` server, etc.)?

## Decision

**Use GitHub Releases.** The release workflow
(`.github/workflows/release.yml`) builds the
binaries, uploads them to a GitHub Release
tagged `vX.Y.Z`, and uploads the `updater.json`
as a Release asset. The existing
`tauri.conf.json` endpoint
(`…/releases/latest/download/updater.json`)
points to the latest Release's
`updater.json`, which the running Tauri app
fetches on every launch.

The release workflow generates `updater.json`
from the build artifacts' filenames + their
`.sig` files. The generation is a small Python
script embedded in the workflow (no separate
tool to maintain).

## Why

**GitHub Releases is free + integrated.** The
project is already on GitHub. Releases + assets
are free for public repos. The release workflow
is a one-line `softprops/action-gh-release@v2`
call. No separate server to provision, monitor,
or pay for.

**GitHub Releases is fast enough for a v0.1.0
release.** GitHub's CDN serves the assets from
~30 PoPs worldwide. A 12 MB `.msi` downloads
in ~10-15s for most users. S3+CloudFront would
be ~5s faster, but the user base is small
(hundreds, not millions), and 10-15s is
acceptable for an "update" download (the
download is in the background; the user can
keep using the app).

**GitHub Releases is "good enough" for the
updater contract.** The updater plugin only
needs:
1. A URL that returns a JSON file
2. URLs in the JSON that point to the platform-
   specific downloads
3. A signature in the JSON for each download

GitHub Releases provides all three out of the
box. The "downloader" is the user's browser
(or `gh release download` for CLI users); the
"server" is the GitHub API. We don't need to
build or maintain either.

**Versioning via tags is built-in.** A new
release is `git tag vX.Y.Z && git push --follow-tags`.
The Release is auto-created. The
`releases/latest/download/updater.json` URL
auto-points to the most recent release. No
"current version" database to manage.

**Rollback is built-in.** If v0.1.0 has a
critical bug, the project lead can mark it
as a "pre-release" on GitHub (which makes it
not the "latest"); the updater would then
offer v0.0.2 to existing users. Or the
project lead can delete the Release
(`gh release delete v0.1.0`) and re-push
a v0.1.1 tag.

## Alternatives considered

### A) Self-hosted S3 + CloudFront

**Pros**: faster downloads (CloudFront's
~200 PoPs vs GitHub's ~30); no rate limits;
custom domain (`update.lipi.app`); differential
updates (Tauri's updater could download only
the changed parts of the bundle).

**Cons**: $5-$50/month for the bucket +
CloudFront; another AWS account to manage;
IAM policies to write; another vendor to
monitor (S3 outages have happened); no
versioning built-in (we'd need a "current
version" file); rollback is manual (we'd
need to re-upload the previous release's
artifacts).

**Rejected** for v0.1.0 because the cost +
complexity aren't worth the 5s download
speedup at our scale.

### B) Dedicated `update.lipi.app` server (Rust + PostgreSQL)

**Pros**: full control over the API; can do
differential updates; can do per-channel
updates (stable / beta / nightly); can do
A/B testing (different update URLs for
different cohorts).

**Cons**: $20-$100/month for a VPS; another
service to operate + monitor + back up;
another attack surface; another thing that
can break at 3am.

**Rejected** because the Tauri updater
protocol is simple enough that GitHub
Releases is sufficient. A custom server
is a future-phase feature for v2.0+ (when
Lipi has 100k+ users and a full-time ops
person).

### C) Static JSON in the GitHub repo (no Releases)

**Pros**: simplest possible — the JSON is
in the repo, the Tauri app fetches it.

**Cons**: doesn't work for "differential
updates" (the artifacts need to live
somewhere); the JSON would need to be
manually updated per release (CI would
commit to `main` on every tag, which
requires write access from CI); no rollback
(reverting a commit doesn't unpublish the
"current" version); the JSON would have to
reference absolute URLs to the artifacts,
which means committing the artifact URLs
into the repo.

**Rejected** because the workflow would
be more complex (CI commits on every
release) and the result would be less
robust (a misconfigured commit could
unpublish all updates).

### D) jsDelivr / unpkg CDN

**Pros**: free; fast (~200 PoPs); no vendor
lock-in.

**Cons**: designed for npm packages, not
release artifacts; the URLs don't follow
Tauri's expected `{{target}}` / `{{arch}}`
template; the artifacts would need to be
uploaded to a public npm-style registry,
which doesn't make sense for a desktop app.

**Rejected** because jsDelivr / unpkg aren't
designed for this use case.

## What this means for the v0.1.0 release

1. The project lead pushes a `vX.Y.Z` tag.
2. The release workflow builds the 3
   platform-specific binaries + signs them
   with the production keypair.
3. The `updater-json` job generates
   `updater.json` from the artifacts + .sig
   files.
4. The `release` job creates a GitHub
   Release, uploads the binaries + the
   `updater.json`.
5. The existing `tauri.conf.json` endpoint
   (`…/releases/latest/download/updater.json`)
   now serves the new `updater.json`.
6. Existing users, on next launch, get
   "Lipi vX.Y.Z is available" dialog.

## What this does NOT cover

- **Differential updates** (Tauri's updater
  could download only the changed parts of
  the bundle, not the whole `.msi`). A future
  phase could add this by switching to an
  S3+CloudFront server.
- **Per-channel updates** (stable / beta /
  nightly). A future phase could add
  separate `releases/beta/latest/download/updater.json`
  endpoints and a "channel selector" in
  settings.
- **A/B testing of updates** (different
  cohorts get different update URLs). A
  future phase.
- **Update analytics** (how many users
  updated, how many declined, etc.). A
  future phase; for now, the only signal is
  the GitHub Release's download counts.
