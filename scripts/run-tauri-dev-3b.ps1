Set-Location "C:\Users\Pv Vimal Nair\lipi"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
# Run tauri dev in background, redirect output
$proc = Start-Process -FilePath "cargo" -ArgumentList "tauri","dev" -WorkingDirectory "C:\Users\Pv Vimal Nair\lipi" -RedirectStandardOutput "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_3b.out" -RedirectStandardError "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_3b.err" -PassThru -WindowStyle Hidden
Write-Host "Started tauri dev, pid=$($proc.Id)"
$proc.Id | Out-File "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_3b.pid"
