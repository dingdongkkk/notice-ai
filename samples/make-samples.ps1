# Draws each samples\*.txt file as a notice image (samples\*.png).
# These are synthetic test notices, not real ones.
Add-Type -AssemblyName System.Drawing
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
foreach ($file in Get-ChildItem -Path $dir -Filter *.txt) {
  $lines = Get-Content -Path $file.FullName -Encoding UTF8
  $bmp = New-Object System.Drawing.Bitmap 1100, 1300
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(250, 248, 240))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 3
  $g.DrawRectangle($pen, 30, 30, 1040, 1240)
  $head = New-Object System.Drawing.Font 'Nirmala UI', 30, ([System.Drawing.FontStyle]::Bold)
  $body = New-Object System.Drawing.Font 'Nirmala UI', 26
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = [System.Drawing.StringAlignment]::Center
  $y = 80
  $i = 0
  foreach ($line in $lines) {
    $font = if ($i -lt 2) { $head } else { $body }
    $rect = New-Object System.Drawing.RectangleF 60, $y, 980, 90
    $g.DrawString($line, $font, [System.Drawing.Brushes]::Black, $rect, $center)
    $y += 78
    $i++
  }
  $out = [System.IO.Path]::ChangeExtension($file.FullName, '.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Output "wrote $out"
}
