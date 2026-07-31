# Screenshot the browser pane to a PNG on disk.
#
# The in-app browser tool returns images into the conversation and cannot write
# files, so captures never survived the session. This grabs the screen natively
# and crops to the browser pane, so nothing outside it (chat, sidebar, taskbar)
# ends up in the repo.
#
#   powershell -File scripts/capture.ps1 -Name 01-landing
#   powershell -File scripts/capture.ps1 -Name 02-picker -Dir docs/screens/dropfleet
#
# Pane bounds default to the right-hand pane on a 1920x1080 display. Pass -Left
# / -Top / -Width / -Height to capture a different region, or -Full for the
# whole screen.

param(
  [Parameter(Mandatory = $true)][string]$Name,
  [string]$Dir = "docs/screens",
  [int]$Left = 666,
  [int]$Top = 110,
  [int]$Width = 1246,
  [int]$Height = 875,
  [switch]$Full
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
if ($Full) {
  $Left = 0; $Top = 0; $Width = $screen.Width; $Height = $screen.Height
}

# Keep the requested region inside the display, or CopyFromScreen throws.
if ($Left + $Width -gt $screen.Width) { $Width = $screen.Width - $Left }
if ($Top + $Height -gt $screen.Height) { $Height = $screen.Height - $Top }

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root $Dir
New-Item -ItemType Directory -Force $outDir | Out-Null

$bmp = New-Object System.Drawing.Bitmap $Width, $Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $g.CopyFromScreen(
    (New-Object System.Drawing.Point $Left, $Top),
    [System.Drawing.Point]::Empty,
    (New-Object System.Drawing.Size $Width, $Height))
  $out = Join-Path $outDir "$Name.png"
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  "{0}  ({1}x{2}, {3}KB)" -f $out, $Width, $Height, [math]::Round((Get-Item $out).Length / 1KB)
} finally {
  $g.Dispose(); $bmp.Dispose()
}
