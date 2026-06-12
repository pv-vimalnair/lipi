Set-Location "C:\Users\Pv Vimal Nair\lipi\src-tauri"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Run lib tests (covers all 5a unit tests).
Write-Host "=== cargo test --lib ==="
& cargo test --lib 2>&1 | Select-String -Pattern "test result" | ForEach-Object { Write-Host $_.Line }

# Run integration tests (covers wire-shape and 5a IPC).
Write-Host "=== cargo test --test secrets_ai_smoke ==="
& cargo test --test secrets_ai_smoke 2>&1 | Select-String -Pattern "test result" | ForEach-Object { Write-Host $_.Line }

# Run terminal smoke (4c) to make sure we didn't regress.
Write-Host "=== cargo test --test terminal_smoke ==="
& cargo test --test terminal_smoke 2>&1 | Select-String -Pattern "test result" | ForEach-Object { Write-Host $_.Line }

# Run terminal tauri smoke.
Write-Host "=== cargo test --test terminal_tauri_smoke ==="
& cargo test --test terminal_tauri_smoke 2>&1 | Select-String -Pattern "test result" | ForEach-Object { Write-Host $_.Line }

# Run git status smoke.
Write-Host "=== cargo test --test git_status_smoke ==="
& cargo test --test git_status_smoke 2>&1 | Select-String -Pattern "test result" | ForEach-Object { Write-Host $_.Line }
