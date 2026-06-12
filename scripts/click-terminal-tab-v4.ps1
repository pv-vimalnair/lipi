Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WindowHelper3 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hwnd, int nCmdShow);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);

    [DllImport("user32.dll")]
    public static extern bool MoveWindow(IntPtr hwnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

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
[WindowHelper3]::ShowWindow($hwnd, [WindowHelper3]::SW_RESTORE) | Out-Null
Start-Sleep -Milliseconds 200

# Move Lipi to known position (50, 50) with a slightly
# taller window so we can see the tab bar clearly.
[WindowHelper3]::MoveWindow($hwnd, 50, 50, 1200, 700, $true) | Out-Null
Start-Sleep -Milliseconds 300
[WindowHelper3]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300

$rect = New-Object WindowHelper3+RECT
[WindowHelper3]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
Write-Host "Window rect: ($($rect.Left),$($rect.Top)) - ($($rect.Right),$($rect.Bottom))"

# With Lipi at (50, 50, 1200, 700):
#   - OS title bar: 0-30px = [50, 80] in screen space
#   - React TitleBar: 30-60px = [80, 110] in screen space
#   - 3-pane grid below
#   - Side panel is rightmost 30% = 840-1200 in x, or
#     [890, 1200] in screen space
#   - Tab bar at top of side panel, 32px tall
#   - Tab bar y in screen space: [110, 142]
#   - SOURCE CONTROL tab x: [890, 1010] (120px wide)
#   - TERMINAL tab x: [1010, 1200] (190px wide, but the
#     visible text is centered at ~x=1060)
#   - TERMINAL text center: x=1060, y=126 (center of tab bar)

$terminalX = 1060
$terminalY = 126

Write-Host "Clicking at ($terminalX, $terminalY)"
[WindowHelper3]::SetCursorPos($terminalX, $terminalY) | Out-Null
Start-Sleep -Milliseconds 200
[WindowHelper3]::mouse_event([WindowHelper3]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[WindowHelper3]::mouse_event([WindowHelper3]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300

Write-Host "Clicked"
