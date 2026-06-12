# Force a redraw by clicking the file tree, then click AI tab, then screenshot.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W3 {
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

$proc = Get-Process -Name lipi -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Write-Host "Lipi not running"; exit 1 }
$hwnd = $proc.MainWindowHandle
if ($hwnd -eq [IntPtr]::Zero) { Write-Host "No window"; exit 1 }

# Bring to front, resize, wait for full render.
[W3]::ShowWindow($hwnd, 5) | Out-Null    # SW_SHOW
[W3]::ShowWindow($hwnd, 9) | Out-Null    # SW_RESTORE
Start-Sleep -Milliseconds 500
[W3]::MoveWindow($hwnd, 100, 100, 1280, 800, $true) | Out-Null
[W3]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 2000

# Click in the middle of the window to ensure focus, then click AI tab.
$centerX = 640
$centerY = 400
[W3]::SetCursorPos($centerX, $centerY) | Out-Null
Start-Sleep -Milliseconds 100
[W3]::mouse_event(0x0002, 0, 0, 0, 0) | Out-Null
Start-Sleep -Milliseconds 60
[W3]::mouse_event(0x0004, 0, 0, 0, 0) | Out-Null
Start-Sleep -Milliseconds 800

# AI tab.
$aiTabX = 1200
$aiTabY = 142
[W3]::SetCursorPos($aiTabX, $aiTabY) | Out-Null
Start-Sleep -Milliseconds 200
[W3]::mouse_event(0x0002, 0, 0, 0, 0) | Out-Null
Start-Sleep -Milliseconds 60
[W3]::mouse_event(0x0004, 0, 0, 0, 0) | Out-Null
Start-Sleep -Milliseconds 1500

# Screenshot.
$rect = New-Object W3+RECT
[W3]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "Capturing $w x $h from $($rect.Left),$($rect.Top)"

$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size $w, $h))
$bmp.Save('C:\Users\Pv Vimal Nair\lipi\screenshots\phase-5b-3-ai-panel.png', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "Saved"
