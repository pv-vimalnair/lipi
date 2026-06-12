Get-Process -Name lipi,cargo,rustc -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Get-Process -Name lipi,cargo,rustc -ErrorAction SilentlyContinue | Format-Table Id, ProcessName
Write-Host "---DONE---"
