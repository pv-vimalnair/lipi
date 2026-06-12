$lines = Get-Content 'C:\Users\Pv Vimal Nair\lipi\CHANGELOG.md'
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match '^## |^### ') {
    Write-Host "$($i+1): $($lines[$i])"
  }
}
