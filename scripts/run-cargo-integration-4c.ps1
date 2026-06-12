Set-Location "C:\Users\Pv Vimal Nair\lipi\src-tauri"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
& cargo test --test terminal_smoke *> "C:\Users\Pv Vimal Nair\lipi\verify\cargo_integration_4c_terminal_smoke.log"
$ec1 = $LASTEXITCODE
& cargo test --test terminal_tauri_smoke *> "C:\Users\Pv Vimal Nair\lipi\verify\cargo_integration_4c_terminal_tauri_smoke.log"
$ec2 = $LASTEXITCODE
Write-Host "terminal_smoke: $ec1, terminal_tauri_smoke: $ec2"
