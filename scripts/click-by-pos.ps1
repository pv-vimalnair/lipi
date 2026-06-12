Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# The Lipi side panel is in the right ~30% of the window.
# The tab bar is at the top of the side panel, ~32px tall.
# In the default Lipi window size, the Terminal tab is
# roughly at:
#   x = window.X + window.Width * 0.85
#   y = window.Y + 30  (below the title bar)
# We use SendInput via P/Invoke to send a real click.

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class MouseHelper {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@

$lipi = Get-Process -Name lipi -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $lipi) { Write-Error "Lipi not running"; exit 1 }

# Get the window's bounding rectangle via the MainWindowHandle
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class WinRect {
    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT lpRect);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left, Top, Right, Bottom;
    }
}
"@

$hwnd = $lipi.MainWindowHandle
$rect = New-Object WinRect+RECT
[WinRect]::GetWindowRect($hwnd, [ref]$rect) | Out-Null

# Window: (Left, Top) - (Right, Bottom). Tauri webview
# starts inside the OS window chrome. The "Terminal" tab
# in the side panel is at approximately:
#   - x = rect.Right - 90  (~50% across the side panel,
#                            which is the right ~30% of
#                            the window; Terminal is the
#                            2nd tab, ~120px wide)
#   - y = rect.Top + 30    (below the title bar)
# These are rough; we click and hope the underlying React
# handler picks it up.

$x = $rect.Right - 90
$y = $rect.Top + 30

Write-Host "Clicking at ($x, $y) on window rect $($rect.Left),$($rect.Top) - $($rect.Right),$($rect.Bottom)"

[MouseHelper]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 100
[MouseHelper]::mouse_event([MouseHelper]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MouseHelper]::mouse_event([MouseHelper]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [UIntPtr]::Zero)

Write-Host "Clicked at ($x, $y)"
