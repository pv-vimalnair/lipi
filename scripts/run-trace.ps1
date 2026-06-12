Set-Location "C:\Users\Pv Vimal Nair\lipi"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
& npx tsc --noEmit --traceResolution *> "C:\Users\Pv Vimal Nair\lipi\verify\trace.log"
$exitCode = $LASTEXITCODE
Write-Host "Exit: $exitCode"
