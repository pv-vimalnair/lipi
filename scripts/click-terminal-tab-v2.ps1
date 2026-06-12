Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Bring Lipi to foreground aggressively.
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hwnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }

    public const int SW_RESTORE = 9;
    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@

$lipi = Get-Process -Name lipi -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $lipi) { Write-Error "Lipi not running"; exit 1 }

$hwnd = $lipi.MainWindowHandle

# Show + restore + bring to foreground. This is the same
# sequence as alt-tab.
[WindowHelper]::ShowWindow($hwnd, [WindowHelper]::SW_RESTORE) | Out-Null
Start-Sleep -Milliseconds 200
[WindowHelper]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 200

# Get window rect.
$rect = New-Object WindowHelper+RECT
[WindowHelper]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

# Compute tab coordinates. From the 4b screenshot, the
# tab bar starts at about x=1180 (right side of the
# window) and the Terminal tab is at about x=1340.
# y is about 30px below the title bar.
# Window rect: (rect.Left, rect.Top) - (rect.Right, rect.Bottom)
# The Tauri webview starts at (rect.Left, rect.Top) after
# the OS chrome.

$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top

# Side panel starts at ~70% of the width (3-pane grid:
# tree 25% / editor 45% / side 30%).
$sideStart = $rect.Left + [int]($width * 0.70)
# Tab bar y is about 30px below the top (after title bar).
$tabY = $rect.Top + 30

# SOURCE CONTROL tab: x in [$sideStart + 8, $sideStart + 128]
# TERMINAL tab:       x in [$sideStart + 128, $sideStart + 200]
# (rough)
$terminalX = $sideStart + 165

Write-Host "Window: ($($rect.Left),$($rect.Top)) - ($($rect.Right),$($rect.Bottom))  ${width}x${height}"
Write-Host "Side panel starts at x=$sideStart"
Write-Host "Clicking Terminal tab at ($terminalX, $tabY)"

[WindowHelper]::SetCursorPos($terminalX, $tabY) | Out-Null
Start-Sleep -Milliseconds 200
[WindowHelper]::mouse_event([WindowHelper]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[WindowHelper]::mouse_event([WindowHelper]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 200

Write-Host "Clicked Terminal tab"
