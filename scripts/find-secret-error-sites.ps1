$lines = Get-Content 'C:\Users\Pv Vimal Nair\lipi\src-tauri\src\secrets.rs'
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match 'SecretError::') {
    Write-Host "$($i+1): $($lines[$i])"
  }
}
