# Build the Lipi desktop installer end-to-end.
#
# Outputs land in `src-tauri/target/debug/bundle/`:
#   - msi/Lipi_0.0.2_x64_en-US.msi         (12 MB, WiX)
#   - nsis/Lipi_0.0.2_x64-setup.exe        (7 MB,  NSIS)
#
# The dev signing key (lipi-dev.key) is committed-public-only; the
# private half is git-ignored. The hard-coded password here is
# intentional — production CI rotates to a real key from a
# secret store, never commits the private key.
$out = [System.IO.Path]::Combine($env:TEMP, "tauri-build.txt")
Remove-Item $out -ErrorAction SilentlyContinue
$env:TAURI_SIGNING_PRIVATE_KEY = "lipi-dev.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = 'lipi-dev-not-a-real-secret'
cargo tauri build --debug 2>&1 | Out-File $out -Append
$code = $LASTEXITCODE
$env:TAURI_SIGNING_PRIVATE_KEY = $null
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $null
Write-Host "exit=$code"
Get-Content $out
exit $code
