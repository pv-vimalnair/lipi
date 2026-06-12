Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WindowHelper2 {
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
[WindowHelper2]::ShowWindow($hwnd, [WindowHelper2]::SW_RESTORE) | Out-Null
Start-Sleep -Milliseconds 200
[WindowHelper2]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 300

$rect = New-Object WindowHelper2+RECT
[WindowHelper2]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

# The 3-pane grid in EditorWorkspace is:
#   tree (25%) | editor (45%) | side (30%)
# From the 4b screenshot, the side panel starts at
# approximately 0.78 of the way across the window. The
# tab bar is ~32px tall at the top of the side panel.
# The first tab (SOURCE CONTROL) is 0-110px from the
# side start, the second (TERMINAL) is 110-200px.
#
# To be safe, click in the middle of the TERMINAL text
# which I can see in the screenshot at screen-space
# roughly (1370, 195).

$winWidth = $rect.Right - $rect.Left
$sideStart = $rect.Left + [int]($winWidth * 0.85)
$terminalX = $sideStart + 65  # 65px into the side panel
$terminalY = $rect.Top + 24   # ~24px below window top

# Wait, the sideStart at 0.85 might be too far right.
# Let me use the actual screenshot coordinates directly:
# from the screenshot, TERMINAL text is at approximately
# screen x=1370, y=195. Just use those values.

$terminalX = 1370
$terminalY = 216

Write-Host "Window rect: ($($rect.Left),$($rect.Top)) - ($($rect.Right),$($rect.Bottom))"
Write-Host "Clicking at ($terminalX, $terminalY)"

[WindowHelper2]::SetCursorPos($terminalX, $terminalY) | Out-Null
Start-Sleep -Milliseconds 200
[WindowHelper2]::mouse_event([WindowHelper2]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[WindowHelper2]::mouse_event([WindowHelper2]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 300

Write-Host "Clicked"
