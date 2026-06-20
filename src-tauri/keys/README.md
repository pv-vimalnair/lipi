# Updater + license signing keys

This directory holds two related sets of Ed25519 keypairs:

1. **Updater signing keypair** (consumed by the Tauri
   auto-updater plugin). The public key is embedded in
   `tauri.conf.json` (`plugins.updater.pubkey`), and the
   private key signs the `updater.json` + per-target `.sig`
   files in CI on every release.

2. **Production license keypair** (consumed by the
   `sign_license` CLI when the project lead issues a
   license key for an offline purchase). The public key
   is embedded in `licensing::PROD_PUBKEY` (compiled into
   the binary), and the private key signs the
   `LicensePayload` for the issued `LIP1…` key.

Both keypairs are Ed25519, but they sign different things
and live in different CI secret slots. Don't cross them
up — the `sign_license` CLI will refuse a key it can't
parse, but the Tauri updater is more forgiving and will
quietly use whatever pubkey is in `tauri.conf.json`.

## Layout

```
src-tauri/keys/
├── README.md                          ← (this file)
├── dev/                               ← throwaway dev keypair
│   ├── lipi-dev.key                   ← PRIVATE — git-ignored
│   └── lipi-dev.key.pub               ← PUBLIC  — committed
└── production/                        ← production public material only
    └── production.key.pub             ← PUBLIC  — committed, embedded in tauri.conf.json
```

Production private material must live **outside** the repo tree. The
current local staging path is:

```text
%USERPROFILE%\.lipi-production-secrets\keys\production\
├── production.key                 ← PRIVATE updater signing key
└── production-license.key.txt     ← PRIVATE 64-char hex license signing key
```

That local staging folder is only a handoff point for importing the
secrets into the CI secret store and an offline vault / encrypted USB.
Do not copy those files back under `src-tauri/keys/production/`, even
though `.gitignore` would ignore them.

The current public key in `tauri.conf.json` is the
**production** key (so end users can verify update signatures
out of the box). CI signs with the **production** private
key (`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PATH`).

## Building locally

For a local release build that also produces signed updater
artifacts, point Tauri at the dev keypair:

```powershell
# Windows PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = "src-tauri/keys/dev/lipi-dev.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "lipi-dev-password"
npm run build:tauri
```

Or use the bundled `build-with-key.ps1` wrapper at the repo
root (which sets the same env vars + the dev password):

```powershell
.\build-with-key.ps1
```

For a **production** build, point Tauri at the production private key
from the CI secret store, e.g. GitHub Actions
`secrets.TAURI_PROD_UPDATER_KEY`. For a one-off local release dry run,
use a path outside the repo, for example:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.lipi-production-secrets\keys\production\production.key"
```

The CI workflow (`.github/workflows/release.yml`) sets
`TAURI_SIGNING_PRIVATE_KEY` from the secret and uploads the signed
`updater.json` to the GitHub release.

## Rotating the updater keypair

Use the `rotate_updater_key` CLI:

```bash
cargo run --bin rotate_updater_key -- \
  --pubkey-file src-tauri/keys/production/production.key.pub
```

This updates the embedded `plugins.updater.pubkey` in
`tauri.conf.json` to the new public key. After rotating,
ship a release that contains *both* the new public key AND
old updates still work for already-installed clients (the
Tauri updater supports a "transition window" of multiple
embedded pubkeys — see `docs/plans/prod-p5-release-pipeline-design.md`).

## Generating a new license keypair

Use the `gen_license_keypair` CLI:

```bash
cargo run --bin gen_license_keypair
```

This prints the new public key as a `const [u8; 32]` array
(paste it into `licensing::PROD_PUBKEY`) and the new
private key as a 64-char hex string (store it in the
`TAURI_PROD_LICENSE_KEY_HEX` CI secret, or in
`%USERPROFILE%\.lipi-production-secrets\keys\production\production-license.key.txt`
while preparing the CI/offline-vault import). Do not store the generated
private key under `src-tauri/keys/production/`. Any license keys signed
with the previous private key become invalid after a rotation;
communicate the rotation to customers before the cutover so they can
re-download a new license.

## Security

- **Never** commit a `.key` (private key) file. The
  `.gitignore` in the repo root is the source of truth.
- **Never** keep production private keys in the repo tree, even as
  ignored local files. Keep them in CI secrets plus an offline vault.
- **Never** reuse a dev key for a release artifact. The
  dev key is in source control's `.pub` companion — anyone
  with the public key can craft malicious updates.
- **Always** back up the production `.key` + password
  to an offline USB kept in a safe. If the project lead
  loses both, no further updates can be signed and users
  are stuck on whatever version they last installed.
