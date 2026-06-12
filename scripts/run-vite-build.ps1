Set-Location "C:\Users\Pv Vimal Nair\lipi"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
& npm run build *> "C:\Users\Pv Vimal Nair\lipi\verify\vite_build_3b.log"
$exitCode = $LASTEXITCODE
Write-Host "Vite build exit: $exitCode"
