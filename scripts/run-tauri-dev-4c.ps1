Set-Location "C:\Users\Pv Vimal Nair\lipi"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
$proc = Start-Process -FilePath "cargo" -ArgumentList "tauri","dev" -WorkingDirectory "src-tauri" -RedirectStandardOutput "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_4c.out" -RedirectStandardError "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_4c.err" -PassThru
Write-Host "started tauri dev pid=$($proc.Id)"
Start-Sleep -Seconds 18
$running = (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null
Write-Host "running=$running"
if ($running) { Stop-Process -Id $proc.Id -Force }
Get-Process -Name "lipi" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "WebView2*" -ErrorAction SilentlyContinue | Stop-Process -Force
