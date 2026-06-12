Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$out = 'C:\Users\Pv Vimal Nair\lipi\src-tauri\lipi-window.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$gfx.Dispose()
$bmp.Dispose()
Write-Output "saved $out ($($screen.Width)x$($screen.Height))"
