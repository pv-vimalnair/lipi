Set-Location "C:\Users\Pv Vimal Nair\lipi"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
New-Item -ItemType Directory -Force -Path "C:\Users\Pv Vimal Nair\lipi\verify" | Out-Null
$proc = Start-Process -FilePath "cargo" -ArgumentList "tauri","dev" -WorkingDirectory "src-tauri" -RedirectStandardOutput "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_5a.out" -RedirectStandardError "C:\Users\Pv Vimal Nair\lipi\verify\tauri_dev_5a.err" -PassThru
Write-Host "started tauri dev pid=$($proc.Id)"
Start-Sleep -Seconds 40

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
public class W5a {
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X, Y; }
}
"@

Start-Sleep -Seconds 2
[W5a]::ShowWindow($lipi.MainWindowHandle, 9) | Out-Null
[W5a]::SetForegroundWindow($lipi.MainWindowHandle) | Out-Null
# Resize the window to a known size for repeatable screenshots
[W5a]::MoveWindow($lipi.MainWindowHandle, 0, 0, 1280, 800, $true) | Out-Null
Start-Sleep -Milliseconds 800

$rect = New-Object W5a+RECT
[W5a]::GetWindowRect($lipi.MainWindowHandle, [ref]$rect) | Out-Null
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
Write-Host "rect: $($rect.Left),$($rect.Top)  ${w}x${h}"

# Shot 1: editor screen
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
$out1 = "C:\Users\Pv Vimal Nair\lipi\verify\screenshot_5a_editor.png"
$bmp.Save($out1, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Host "saved $out1"

# Click the gear icon. The titlebar is 36px tall
# (per TitleBar.module.css), so the gear center is
# at y = 18. The gear is in the right slot, with
# min-width 80px. We click at the rightmost 24px
# of the titlebar.
$gearX = $rect.Right - 30
$gearY = $rect.Top + 18

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Mouse5a {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, IntPtr extra);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP   = 0x0004;
}
"@

[Mouse5a]::SetCursorPos($gearX, $gearY) | Out-Null
Start-Sleep -Milliseconds 200
[Mouse5a]::mouse_event([Mouse5a]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Milliseconds 80
[Mouse5a]::mouse_event([Mouse5a]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Start-Sleep -Seconds 1

# Shot 2: settings screen
$bmp2 = New-Object System.Drawing.Bitmap $w, $h
$g2 = [System.Drawing.Graphics]::FromImage($bmp2)
$g2.CopyFromScreen($rect.Left, $rect.Top, 0, 0, [System.Drawing.Size]::new($w, $h))
$out2 = "C:\Users\Pv Vimal Nair\lipi\verify\screenshot_5a_settings.png"
$bmp2.Save($out2, [System.Drawing.Imaging.ImageFormat]::Png)
$g2.Dispose()
$bmp2.Dispose()
Write-Host "saved $out2"

# Cleanup
if ((Get-Process -Id $proc.Id -ErrorAction SilentlyContinue) -ne $null) { Stop-Process -Id $proc.Id -Force }
Get-Process -Name "lipi" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name "WebView2*" -ErrorAction SilentlyContinue | Stop-Process -Force
