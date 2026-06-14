# build-with-key.ps1
# Wrapper that sets the updater signing env vars and runs `tauri build`.
# The Tauri CLI's bundle command reads `TAURI_SIGNING_PRIVATE_KEY`
# (NOT `TAURI_SIGNING_PRIVATE_KEY_PATH` — that's only used by the
# `tauri signer` subcommand). The value can be either the raw key
# contents OR a file path; the CLI detects which it is. The
# keypair lives at `src-tauri/keys/production/production.key`
# (git-ignored). In CI, the same key is provided via the
# `TAURI_PROD_UPDATER_KEY` secret (raw PEM contents) — see
# `.github/workflows/release.yml`.
#
# The local-dev password is checked in here (it's a throwaway dev
# key, not a production one — see `.gitignore`). For real CI, the
# `TAURI_PROD_UPDATER_KEY_PASSWORD` GitHub secret is what matters.
$ErrorActionPreference = "Stop"
$env:TAURI_SIGNING_PRIVATE_KEY = "C:\Users\Pv Vimal Nair\lipi\src-tauri\keys\production\production.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "lipi-dev-password-change-me-in-prod"
Write-Host "Using TAURI_SIGNING_PRIVATE_KEY = $env:TAURI_SIGNING_PRIVATE_KEY"
Write-Host "Using TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
Push-Location "C:\Users\Pv Vimal Nair\lipi"
try {
    npm run build:tauri
} finally {
    Pop-Location
}
