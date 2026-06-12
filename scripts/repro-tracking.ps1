Set-Location $env:TEMP
$dir = New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "lipi-repro-$([System.Diagnostics.Stopwatch]::GetTimestamp())")
git init -q -b main $dir.FullName
git -C $dir.FullName config user.email "lipi@test"
git -C $dir.FullName config user.name "Lipi"
"hello" | Out-File "$($dir.FullName)\hello.txt" -Encoding ascii
git -C $dir.FullName add .
git -C $dir.FullName commit -q -m "init"
"v2" | Out-File "$($dir.FullName)\hello.txt" -Encoding ascii
git -C $dir.FullName add .
git -C $dir.FullName commit -q -m "v2"
$headparent = git -C $dir.FullName rev-parse HEAD~1
Write-Host "HEAD~1: $headparent"
git -C $dir.FullName update-ref refs/remotes/origin/main $headparent
git -C $dir.FullName config branch.main.remote origin
git -C $dir.FullName config branch.main.merge refs/heads/main
# Also configure the remote so @u can resolve. Without these, git
# thinks "I don't know what branches the origin remote has" and
# refuses to resolve the tracking ref.
git -C $dir.FullName config remote.origin.url "file:///dev/null"
git -C $dir.FullName config remote.origin.fetch "+refs/heads/*:refs/remotes/origin/*"
Write-Host "rev-parse main@{u}:"
# Escape @ for PowerShell: use single quotes and backtick
$out = git -C $dir.FullName rev-parse 'main@{u}' 2>&1
Write-Host "  result: '$out' (exit=$LASTEXITCODE)"
Write-Host "for-each-ref refs/remotes:"
git -C $dir.FullName for-each-ref refs/remotes
Write-Host "branch config:"
git -C $dir.FullName config --get-regexp 'branch\..*'
Write-Host "Cleaning up..."
Remove-Item -Recurse -Force $dir.FullName
