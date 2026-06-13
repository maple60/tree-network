param(
    [string]$SourceDir = "private_input/hayashi_2019",
    [string]$OutputDir = "private_input/ocr/ndlocr_lite",
    [string]$ToolDir = "private_input/tools/ndlocr-lite",
    [int]$Limit = 0,
    [switch]$SkipExisting,
    [switch]$NoViz,
    [switch]$NoTcy,
    [string]$PythonExe = ""
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourcePath = Join-Path $repoRoot $SourceDir
$outputPath = Join-Path $repoRoot $OutputDir
$toolPath = Join-Path $repoRoot $ToolDir
$inputPath = Join-Path $outputPath "input"
$jsonPath = Join-Path $outputPath "json"

function Resolve-Python {
    param([string]$RequestedPython)
    if ($RequestedPython -and (Test-Path -LiteralPath $RequestedPython)) {
        return (Resolve-Path $RequestedPython).Path
    }
    $runtimePython = Join-Path $env:USERPROFILE ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe"
    if (Test-Path -LiteralPath $runtimePython) {
        return $runtimePython
    }
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand) {
        return $pythonCommand.Source
    }
    throw "Python executable was not found. Pass -PythonExe explicitly."
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Source directory not found: $sourcePath"
}

New-Item -ItemType Directory -Force -Path $inputPath, $jsonPath | Out-Null

if (-not (Test-Path -LiteralPath $toolPath)) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $toolPath) | Out-Null
    git clone --depth 1 https://github.com/ndl-lab/ndlocr-lite.git $toolPath
}

$python = Resolve-Python $PythonExe
$venvPython = Join-Path $toolPath ".venv/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    uv venv (Join-Path $toolPath ".venv") --python $python
}
uv pip install --python $venvPython -r (Join-Path $toolPath "requirements.txt")

$images = Get-ChildItem -LiteralPath $sourcePath -File |
    Where-Object { $_.Extension -match '^\.(png|jpg|jpeg|tif|tiff|bmp|webp|jp2)$' } |
    Sort-Object { [int](($_.BaseName -replace '^.*?_(\d+)$', '$1')) }

if ($Limit -gt 0) {
    $images = $images | Select-Object -First $Limit
}

foreach ($image in $images) {
    $target = Join-Path $inputPath $image.Name
    Copy-Item -LiteralPath $image.FullName -Destination $target -Force
}

if ($SkipExisting) {
    $pendingDir = Join-Path $outputPath "pending"
    if (Test-Path -LiteralPath $pendingDir) {
        Remove-Item -LiteralPath $pendingDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $pendingDir | Out-Null
    foreach ($image in $images) {
        $jsonFile = Join-Path $jsonPath ($image.BaseName + ".json")
        if (-not (Test-Path -LiteralPath $jsonFile)) {
            Copy-Item -LiteralPath (Join-Path $inputPath $image.Name) -Destination (Join-Path $pendingDir $image.Name) -Force
        }
    }
    $runSource = $pendingDir
} else {
    $runSource = $inputPath
}

$pendingCount = (Get-ChildItem -LiteralPath $runSource -File | Measure-Object).Count
if ($pendingCount -eq 0) {
    Write-Host "No pending images."
    exit 0
}

$args = @(
    (Join-Path $toolPath "src/ocr.py"),
    "--sourcedir", $runSource,
    "--output", $jsonPath,
    "--json-only",
    "--device", "cpu"
)
if (-not $NoViz) {
    $args += @("--viz", "True")
}
if (-not $NoTcy) {
    $args += "--enable-tcy"
}

Write-Host "Source images: $($images.Count)"
Write-Host "Pending OCR images: $pendingCount"
Write-Host "Output: $jsonPath"
Push-Location (Join-Path $toolPath "src")
try {
    & $venvPython @args
} finally {
    Pop-Location
}
