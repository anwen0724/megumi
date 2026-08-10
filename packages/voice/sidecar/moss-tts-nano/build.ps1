# Builds a self-contained Windows sidecar; end users do not need Python.
$ErrorActionPreference = 'Stop'
$sidecarRoot = $PSScriptRoot
$buildRoot = Join-Path $sidecarRoot '.build'
$venvPath = Join-Path $buildRoot 'venv'
$officialRevision = 'cc7bdf19c7639c0870dab22045a33b442760f6be'

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
python -m venv $venvPath
$python = Join-Path $venvPath 'Scripts/python.exe'
& $python -m pip install --disable-pip-version-check -r (Join-Path $sidecarRoot 'requirements.lock')
& $python -m pip install --disable-pip-version-check --no-deps "git+https://github.com/OpenMOSS/MOSS-TTS-Nano.git@$officialRevision"
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
