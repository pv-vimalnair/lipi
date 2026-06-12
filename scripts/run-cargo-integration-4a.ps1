Set-Location "C:\Users\Pv Vimal Nair\lipi\src-tauri"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
& cargo test --test terminal_smoke *> "C:\Users\Pv Vimal Nair\lipi\verify\cargo_integration_4a.log"
$exitCode = $LASTEXITCODE
Write-Host "Cargo integration test exit: $exitCode"
