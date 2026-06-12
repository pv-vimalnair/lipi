$ErrorActionPreference = "Continue"
$temp = [System.IO.Path]::Combine($env:TEMP, "lipi-verify.txt")
Remove-Item $temp -ErrorAction SilentlyContinue

function Step($name, $cmd) {
    Write-Host "=== $name ===" -ForegroundColor Cyan
    & $cmd
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        Write-Host "FAILED ($code): $name" -ForegroundColor Red
        exit $code
    }
    Write-Host "OK: $name" -ForegroundColor Green
}

Step "tsc"           { node node_modules/typescript/bin/tsc --noEmit }
Step "vitest"        { node node_modules/vitest/vitest.mjs run }
Step "vite build"    { npm run build }
Step "cargo check"   { cargo check --manifest-path src-tauri/Cargo.toml }

Write-Host ""
Write-Host "ALL GREEN." -ForegroundColor Green
