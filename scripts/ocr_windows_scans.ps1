param(
  [string]$InputDir = "private_input/hayashi_2019",
  [string]$OutputDir = "private_input/ocr/hayashi_2019",
  [switch]$SplitHalves = $true
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$inputPath = if ([System.IO.Path]::IsPathRooted($InputDir)) { $InputDir } else { Join-Path $repoRoot $InputDir }
$outputPath = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $repoRoot $OutputDir }
$tempPath = Join-Path $outputPath "_crops"

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
New-Item -ItemType Directory -Force -Path $tempPath | Out-Null

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapPixelFormat, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapAlphaMode, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null

$asTaskOperation = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.ToString() -eq 'System.Threading.Tasks.Task`1[TResult] AsTask[TResult](Windows.Foundation.IAsyncOperation`1[TResult])'
})[0]

function Await-Operation($operation, [Type]$resultType) {
  $task = $script:asTaskOperation.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}

function Invoke-WindowsOcr([string]$imagePath, $engine) {
  $file = Await-Operation ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
  $stream = Await-Operation ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  $decoder = Await-Operation ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-Operation ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await-Operation ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $result.Text
}

function Save-HalfCrops([System.IO.FileInfo]$file, [string]$destinationDir) {
  $bitmap = [System.Drawing.Bitmap]::FromFile($file.FullName)
  try {
    $halfWidth = [int]($bitmap.Width / 2)
    $leftRect = [System.Drawing.Rectangle]::new(0, 0, $halfWidth, $bitmap.Height)
    $rightRect = [System.Drawing.Rectangle]::new($halfWidth, 0, $bitmap.Width - $halfWidth, $bitmap.Height)
    $leftPath = Join-Path $destinationDir ($file.BaseName + "_left.png")
    $rightPath = Join-Path $destinationDir ($file.BaseName + "_right.png")
    $left = $bitmap.Clone($leftRect, $bitmap.PixelFormat)
    $right = $bitmap.Clone($rightRect, $bitmap.PixelFormat)
    try {
      $left.Save($leftPath, [System.Drawing.Imaging.ImageFormat]::Png)
      $right.Save($rightPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
      $left.Dispose()
      $right.Dispose()
    }
    @(
      [pscustomobject]@{ Side = "left"; Path = $leftPath },
      [pscustomobject]@{ Side = "right"; Path = $rightPath }
    )
  }
  finally {
    $bitmap.Dispose()
  }
}

function Get-RepoRelativePath([string]$path) {
  $fullPath = [System.IO.Path]::GetFullPath($path)
  $fullRoot = [System.IO.Path]::GetFullPath($script:repoRoot).TrimEnd("\") + "\"
  if ($fullPath.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $fullPath.Substring($fullRoot.Length)
  }
  return $fullPath
}

function Get-DetectedTerms([string]$text) {
  $compactText = $text -replace "\s+", ""
  $terms = @(
    "常緑", "落葉", "針葉", "広葉", "単葉", "複葉", "羽状複葉", "掌状複葉",
    "互生", "対生", "輪生", "束生", "全縁", "鋸歯", "細鋸歯", "重鋸歯", "粗鋸歯", "波状"
  )
  $terms | Where-Object { $compactText -match [regex]::Escape($_) } | Sort-Object -Unique
}

$lang = [Windows.Globalization.Language]::new("ja")
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if ($null -eq $engine) {
  throw "Windows Japanese OCR is unavailable on this machine."
}

$extensions = @(".png", ".jpg", ".jpeg", ".tif", ".tiff")
$images = Get-ChildItem -Path $inputPath -File | Where-Object { $extensions -contains $_.Extension.ToLowerInvariant() } | Sort-Object Name
if (-not $images) {
  throw "No image files found in $inputPath"
}

$summary = New-Object System.Collections.Generic.List[object]
foreach ($image in $images) {
  $targets = if ($SplitHalves) { Save-HalfCrops $image $tempPath } else { @([pscustomobject]@{ Side = "full"; Path = $image.FullName }) }
  foreach ($target in $targets) {
    Write-Host "OCR $($image.Name) [$($target.Side)]"
    $text = Invoke-WindowsOcr $target.Path $engine
    $textFile = Join-Path $outputPath ($image.BaseName + "_" + $target.Side + ".txt")
    Set-Content -Path $textFile -Encoding UTF8 -Value $text
    $summary.Add([pscustomobject]@{
      file = $image.Name
      side = $target.Side
      text_file = Get-RepoRelativePath $textFile
      text_length = $text.Length
      detected_terms = (Get-DetectedTerms $text) -join ";"
    })
  }
}

$summaryPath = Join-Path $outputPath "ocr_summary.csv"
$summary | Export-Csv -Path $summaryPath -Encoding UTF8 -NoTypeInformation
Write-Host "Wrote $($(Get-RepoRelativePath $summaryPath))"
