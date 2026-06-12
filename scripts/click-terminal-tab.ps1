Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Find Lipi's main window by its title (set in lib.rs
# setup: "Lipi 0.0.2").
$lipiWindow = $root.FindFirst(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "Lipi 0.0.2"
    ))
)

if ($null -eq $lipiWindow) {
    Write-Error "Lipi window not found"
    exit 1
}

# Find the "Terminal" tab button. WebView2 in Tauri exposes
# DOM elements as UIA buttons; the accessible name is the
# button's text content.
$terminalTab = $null
$allButtons = $lipiWindow.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
    ))
)

foreach ($btn in $allButtons) {
    if ($btn.Current.Name -eq "Terminal") {
        $terminalTab = $btn
        break
    }
}

if ($null -eq $terminalTab) {
    Write-Error "Terminal tab not found in Lipi window"
    exit 2
}

# Invoke the button (equivalent to a click).
$invokePattern = $terminalTab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invokePattern.Invoke()
Write-Host "Clicked Terminal tab"
