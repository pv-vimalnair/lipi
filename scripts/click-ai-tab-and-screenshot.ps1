# Click the AI tab in the side panel, then capture a screenshot.
# Phase 5b-3 verification: shows the new AIPanel with header, empty thread, and composer.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int w, int h, bool repaint);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

$out = 'C:\Users\Pv Vimal Nair\lipi\screenshots\phase-5b-3-ai-panel.png'
$outEmpty = 'C:\Users\Pv Vimal Nair\lipi\screenshots\phase-5b-3-ai-panel-empty.png'

$proc = Get-Process -Name lipi -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host "Lipi not running"; exit 1 }
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "No window"; exit 1 }

# Bring to front and resize.
[W2]::ShowWindow($hwnd, 9) | Out-Null
[W2]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500
[W2]::MoveWindow($hwnd, 100, 100, 1280, 800, $true) | Out-Null
Start-Sleep -Milliseconds 1500

# Get window rect for screenshot coordinates.
$rect = New-Object W2+RECT
[W2]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$winX = $rect.Left
$winY = $rect.Top
Write-Host "Window at $winX,$winY"

# Click the AI tab. Tab bar is at top of side panel.
# Side panel starts ~ x=1037 (with the 3-pane layout: file tree 270, editor ~735, side ~275).
# Tab bar y is ~ 130 (just below title bar).
# Tabs are left-to-right: Source Control (~80px wide), Terminal (~70px), AI (~30px).
# AI tab center: x = 1037 + 80 + 70 + 15 = ~1202
# Actually the side panel is gridArea 'side'; let me use empirical placement.
# Side panel width ~ 275, AI is third tab.
$aiTabX = 1200
$aiTabY = 142

[W2]::SetCursorPos($aiTabX, $aiTabY) | Out-Null
Start-Sleep -Milliseconds 200
[W2]::mouse_event(0x0002, 0, 0, 0, 0) | Out-Null   # LEFTDOWN
Start-Sleep -Milliseconds 60
[W2]::mouse_event(0x0004, 0, 0, 0, 0) | Out-Null   # LEFTUP
Start-Sleep -Milliseconds 1500

# Capture the AI panel screenshot.
$rect = New-Object W2+RECT
[W2]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "Saved: $out"
