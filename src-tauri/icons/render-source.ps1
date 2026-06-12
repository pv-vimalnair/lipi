# Render the SVG master into the 32-icon set.
#
# Source of truth: src-tauri/icons/app-icon.svg (hand-drawn monogram
# with brand gradient + accent dot). This script calls
# `cargo tauri icon` which reads the SVG and generates:
#   - 32x32.png, 128x128.png, 128x128@2x.png (Linux / cross-platform)
#   - icon.icns (macOS bundle icon)
#   - icon.ico (Windows executable icon + multiple embedded sizes)
#   - Square*.png (Windows Store tile sizes)
#   - StoreLogo.png (Windows Store small tile)
#   - android/  (Android mipmap + adaptive icon layers; empty
#     until we wire mobile, but the directory is created)
#   - ios/      (iOS AppIcon.appiconset; empty until we wire mobile)
#
# The CLI's [INPUT] path is the source icon (PNG or SVG with
# transparency). SVG input is supported as of tauri-cli 2.x; the
# CLI uses the resvg crate under the hood. Re-run this script
# after editing app-icon.svg.
#
# Note: keep the SVG ASCII-only. The bundled usvg parser (used by
# tauri-cli 2.11.x) is strict and will panic with "ParsingFailed"
# on non-ASCII characters, "--" inside a comment body (invalid
# XML per the W3C spec), or unsupported features. See the
# commits in HANDOFF for the full root-cause analysis.
$ErrorActionPreference = "Stop"
$iconsDir = $PSScriptRoot
$sourceSvg = Join-Path $iconsDir "app-icon.svg"
$sourcePng = Join-Path $iconsDir "app-icon.png"
$out = [System.IO.Path]::Combine($env:TEMP, "tauri-icon-stdout.txt")
$err = [System.IO.Path]::Combine($env:TEMP, "tauri-icon-stderr.txt")
Remove-Item $out -ErrorAction SilentlyContinue
Remove-Item $err -ErrorAction SilentlyContinue

if (-not (Test-Path $sourceSvg)) {
    Write-Host "missing $sourceSvg - write the master icon first" -ForegroundColor Red
    exit 1
}

# Use Start-Process with -RedirectStandardOutput / -RedirectStandardError
# so we get a clean exit code (PowerShell's `2>&1 | Out-File` is
# unreliable for capturing exit codes from native commands).
$proc = Start-Process -FilePath "cargo" -ArgumentList "tauri","icon",$sourceSvg -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
if ($proc.ExitCode -ne 0) {
    Write-Host "FAILED ($($proc.ExitCode)): cargo tauri icon" -ForegroundColor Red
    Get-Content $err
    exit $proc.ExitCode
}

# The tauri CLI does not write `app-icon.png`; it writes the per-size
# set into icons/. We synthesise a 1024x1024 PNG from the SVG with
# a simple copy of the largest generated PNG (icon.png is 256x256 -
# the largest square the CLI emits by default; good enough for
# READMEs and IDE icon previews).
$previewPng = Join-Path $iconsDir "icon.png"
if (Test-Path $previewPng) {
    Copy-Item $previewPng $sourcePng -Force
}

Write-Host "OK: 32-icon set regenerated from $sourceSvg" -ForegroundColor Green
Get-Content $out | Where-Object { $_ -match "Creating" } | ForEach-Object { Write-Host "  $_" }
exit 0
