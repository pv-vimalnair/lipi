Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Find the Lipi window
$proc = Get-Process -Name "lipi" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $proc) {
  Write-Host "lipi not running"
  exit 1
}
Write-Host "lipi pid=$($proc.Id) mainWindowHandle=$($proc.MainWindowHandle)"

# Wait a moment for the window to fully render
Start-Sleep -Seconds 3

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

[W]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
[W]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
Start-Sleep -Milliseconds 600

$rect = New-Object W+RECT
[W]::GetWindowRect($proc.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "rect: $($rect.Left),$($rect.Top)  ${w}x${h}"
if ($w -le 0 -or $h -le 0) { exit 2 }

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
$out = "C:\Users\Pv Vimal Nair\lipi\verify\screenshot_4c.png"
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "saved $out"
