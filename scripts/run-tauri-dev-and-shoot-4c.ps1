Set-Location "C:\Users\Pv Vimal Nair\lipi"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
$proc = Start-Process -FilePath "cargo" -ArgumentList "tauri","dev" -WorkingDirectory "src-tauri" -RedirectStandardOutput "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_4c.out" -RedirectStandardError "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_4c.err" -PassThru
Write-Host "started tauri dev pid=$($proc.Id)"
Start-Sleep -Seconds 18

$lipi = Get-Process -Name "lipi" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $lipi) {
  Write-Host "lipi process not found"
  if ((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null) { Stop-Process -Id $proc.Id -Force }
  exit 1
}
Write-Host "lipi pid=$($lipi.Id) mainWindowHandle=$($lipi.MainWindowHandle)"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

Start-Sleep -Seconds 2
[W]::ShowWindow($lipi.MainWindowHandle, 9) | Out-Null
[W]::SetForegroundWindow($lipi.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 800

$rect = New-Object W+RECT
[W]::GetWindowRect($lipi.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "rect: $($rect.Left),$($rect.Top)  ${w}x${h}"

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
$out = "C:\Users\Pv Vimal Nair\lipi\verify\screenshot_4c.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "saved $out"

# Cleanup
if ((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null) { Stop-Process -Id $proc.Id -Force }
Get-Process -Name "lipi" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "WebView2*" -ErrorAction SilentlyContinue | Stop-Process -Force
