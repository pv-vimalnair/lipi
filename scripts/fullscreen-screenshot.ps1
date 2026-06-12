# Fullscreen capture, then a window-specific one. This is the
# last-resort approach when WebView2 doesn't render in
# headless capture.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W4 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")]
  public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, int flags);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$proc = Get-Process -Name lipi -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host "Lipi not running"; exit 1 }
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "No window"; exit 1 }

[W4]::ShowWindow($hwnd, 5) | Out-Null
[W4]::ShowWindow($hwnd, 9) | Out-Null
[W4]::MoveWindow($hwnd, 50, 50, 1280, 800, $true) | Out-Null
[W4]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 2500

$rect = New-Object W4+RECT
[W4]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "Window: $($rect.Left),$($rect.Top) $w x $h"

# Use PrintWindow — it works for WebView2 when foreground capture
# doesn't (PrintWindow routes the render through WM_PAINT which
# the WebView2 host honours even off-screen).
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
# PW_RENDERFULLCONTENT = 0x00000002 — needed for WebView2 + DirectComposition
$ok = [W4]::PrintWindow($hwnd, $hdc, 2)
$g.ReleaseHdc($hdc)
$g.Dispose()
Write-Host "PrintWindow result: $ok"

# Save the result
$bmp.Save('C:\Users\Pv Vimal Nair\lipi\screenshots\phase-5b-3-ai-panel.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "Saved"
