# Dumps images to raw 32bpp (B,G,R,A) byte files so the Node extractor can work
# without any image-decoding dependencies. Writes <out>.rgba plus <out>.json (dims).
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$OutBase,
  [int]$Frame = 0
)

Add-Type -AssemblyName System.Drawing | Out-Null

$img = [System.Drawing.Image]::FromFile($Source)

# Animated GIFs: explicitly select the requested frame.
try {
  $fd = New-Object System.Drawing.Imaging.FrameDimension $img.FrameDimensionsList[0]
  $count = $img.GetFrameCount($fd)
  if ($count -gt 1) { $img.SelectActiveFrame($fd, $Frame) | Out-Null }
} catch { $count = 1 }

[int]$w = $img.Width
[int]$h = $img.Height

# Normalize into a known 32bpp ARGB surface.
$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$g.DrawImage($img, (New-Object System.Drawing.Rectangle(0, 0, $w, $h))) | Out-Null
$g.Dispose()

$rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
[int]$stride = $data.Stride
[int]$bytes = $stride * $h
$buf = New-Object byte[] $bytes
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $bytes)
$bmp.UnlockBits($data)

[System.IO.File]::WriteAllBytes("$OutBase.rgba", $buf)

$meta = @{ width = $w; height = $h; stride = $stride; frames = $count; source = $Source }
$meta | ConvertTo-Json -Compress | Out-File -FilePath "$OutBase.json" -Encoding utf8

$bmp.Dispose()
$img.Dispose()

Write-Output "$Source -> $OutBase.rgba ($w x $h, stride $stride, frames $count)"
