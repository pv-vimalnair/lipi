# Capture a screenshot of the Lipi Tauri window to verify
# the new AI tab is visible. Phase 5b-3 verification.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/screenshot-ai-panel.ps1

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\screenshots\phase-5b-3-ai-panel.png'
$outDir = Split-Path $out -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

# Find the Lipi window.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")]
  public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")]
  public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hwnd, int x, int y, int w, int h, bool repaint);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

# Try to find a window with "Lipi" in the title.
$proc = Get-Process -Name lipi -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
  Write-Host "Lipi process not found"
  exit 1
}
Write-Host "Lipi PID: $($proc.Id)"

# Get the main window handle. Try MainWindowHandle first.
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) {
  # Enumerate threads to find a window.
  $proc.Refresh()
  $hwnd = $proc.MainWindowHandle
}
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Host "No main window handle for Lipi"
  exit 1
}
Write-Host "Window handle: $hwnd"

# Bring to front.
[W]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE
[W]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

# Get window rect.
$rect = New-Object W+RECT
[W]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "Window rect: $($rect.Left),$($rect.Top) $w x $h"

if ($w -le 0 -or $h -le 0) {
  Write-Host "Bad window dimensions, retrying"
  Start-Sleep -Milliseconds 1000
  [W]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
  $w = $rect.Right - $rect.Left
  $h = $rect.Bottom - $rect.Top
  Write-Host "Window rect: $($rect.Left),$($rect.Top) $w x $h"
}

# Resize / move to a known good size for the screenshot.
[W]::MoveWindow($hwnd, 100, 100, 1280, 800, $true) | Out-Null
Start-Sleep -Milliseconds 500
[W]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "Resized to: $($rect.Left),$($rect.Top) $w x $h"

# Screenshot the window region.
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()

Write-Host "Saved: $out"
