Set-Location "C:\Users\Pv Vimal Nair\lipi\src-tauri"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
& cargo test --lib *> "C:\Users\Pv Vimal Nair\lipi\verify\cargo_test_3b.log"
$exitCode = $LASTEXITCODE
Write-Host "Cargo test exit: $exitCode"
