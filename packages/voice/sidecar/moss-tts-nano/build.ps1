# Builds a self-contained Windows sidecar; end users do not need Python.
param([switch]$Force)
$ErrorActionPreference = 'Stop'
$sidecarRoot = $PSScriptRoot
$buildRoot = Join-Path $sidecarRoot '.build'
$venvPath = Join-Path $buildRoot 'venv'
$officialRevision = 'cc7bdf19c7639c0870dab22045a33b442760f6be'
$outputPath = Join-Path $sidecarRoot 'dist/moss-tts-nano-sidecar.exe'

if (-not $Force -and (Test-Path -LiteralPath $outputPath)) {
  $outputTimestamp = (Get-Item -LiteralPath $outputPath).LastWriteTimeUtc
  $inputs = @('main.py', 'patch_onnx_runtime.py', 'requirements.lock', 'build.ps1') | ForEach-Object {
    Get-Item -LiteralPath (Join-Path $sidecarRoot $_)
  }
  if (($inputs | Where-Object { $_.LastWriteTimeUtc -gt $outputTimestamp }).Count -eq 0) {
    Write-Host 'MOSS sidecar is up to date.'
    exit 0
  }
}

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
python -m venv $venvPath
if ($LASTEXITCODE -ne 0) { throw "Could not create the MOSS sidecar virtual environment (exit $LASTEXITCODE)." }
$python = Join-Path $venvPath 'Scripts/python.exe'
& $python -m pip install --disable-pip-version-check -r (Join-Path $sidecarRoot 'requirements.lock')
if ($LASTEXITCODE -ne 0) { throw "Could not install the MOSS sidecar dependencies (exit $LASTEXITCODE)." }
& $python -m pip install --disable-pip-version-check --no-deps "git+https://github.com/OpenMOSS/MOSS-TTS-Nano.git@$officialRevision"
if ($LASTEXITCODE -ne 0) { throw "Could not install the pinned MOSS-TTS-Nano runtime (exit $LASTEXITCODE)." }
& $python (Join-Path $sidecarRoot 'patch_onnx_runtime.py') `
  (Join-Path $venvPath 'Lib/site-packages/onnx_tts_runtime.py')
if ($LASTEXITCODE -ne 0) { throw "Could not patch the pinned MOSS ONNX runtime (exit $LASTEXITCODE)." }
& $python -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name moss-tts-nano-sidecar `
  --distpath (Join-Path $sidecarRoot 'dist') `
  --workpath (Join-Path $buildRoot 'pyinstaller') `
  --specpath $buildRoot `
  --collect-all onnxruntime `
  --collect-all sentencepiece `
  (Join-Path $sidecarRoot 'main.py')
if ($LASTEXITCODE -ne 0) { throw "Could not package the MOSS sidecar (exit $LASTEXITCODE)." }
