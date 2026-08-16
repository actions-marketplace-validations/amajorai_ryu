# Ryu one-line installer for Windows (PowerShell).
#
#   irm https://raw.githubusercontent.com/amajorai/ryu/main/install.ps1 | iex
#
# Installs and starts the headless stack — ryu-core, ryu-gateway, ryu-cli — in
# %USERPROFILE%\.ryu\bin. Starting Core is part of the install so the same entry
# point also kicks off the bundled models, engines, skills, and built-in defaults.
# Core owns those defaults. Island and Ghost are intentionally NOT part of the
# default closure yet.
#
# Environment overrides:
#   $env:RYU_INSTALL_DIR    install location   (default: $HOME\.ryu\bin)
#   $env:RYU_VERSION        release tag e.g. v0.0.4   (default: latest)
#   $env:RYU_SKIP_CHECKSUM  1 to skip sha256 verify   (default: verify, abort on failure)
#   $env:RYU_START_CORE     0 to install without starting Core (default: 1)
#   $env:RYU_CORE_BIND      Core bind address (default: 127.0.0.1:7980)
#   $env:RYU_CORE_URL       Core health URL (default: http://127.0.0.1:7980)
#   $env:RYU_PROGRESS_FORMAT json to emit RYU_INSTALL_EVENT JSON lines
#   $env:RYU_INSTALL_MARKER  version marker written beside installed binaries

$ErrorActionPreference = 'Stop'

$repo       = 'amajorai/ryu'
$installDir = if ($env:RYU_INSTALL_DIR) { $env:RYU_INSTALL_DIR } else { Join-Path $HOME '.ryu\bin' }
$binaries   = @('ryu-core', 'ryu-gateway', 'ryu-cli')
$progressFormat = if ($env:RYU_PROGRESS_FORMAT) { $env:RYU_PROGRESS_FORMAT } else { 'human' }
$startCore  = if ($env:RYU_START_CORE) { $env:RYU_START_CORE } else { '1' }
$installDefaults = if ($env:RYU_INSTALL_DEFAULTS) { $env:RYU_INSTALL_DEFAULTS } else { '1' }
$coreBind   = if ($env:RYU_CORE_BIND) { $env:RYU_CORE_BIND } else { '127.0.0.1:7980' }
$coreUrl    = if ($env:RYU_CORE_URL) { $env:RYU_CORE_URL } else { 'http://127.0.0.1:7980' }
$installMarker = if ($env:RYU_INSTALL_MARKER) { $env:RYU_INSTALL_MARKER } else { 'latest' }
$forceInstall = $env:RYU_FORCE_INSTALL -eq '1'

function Emit-Progress {
  param(
    [string]$Phase,
    [string]$Component,
    [string]$Status,
    [int]$Percent
  )
  if ($progressFormat -ne 'json') { return }
  $payload = [ordered]@{
    version = 1
    phase = $Phase
    component = $Component
    status = $Status
    percent = $Percent
  }
  Write-Output ('RYU_INSTALL_EVENT:' + ($payload | ConvertTo-Json -Compress))
}

function Fail-Install {
  param([string]$Component, [string]$Message)
  Emit-Progress 'error' $Component 'failed' 0
  throw $Message
}

# --- detect arch ------------------------------------------------------------
$arch = $env:PROCESSOR_ARCHITECTURE
if ($arch -ne 'AMD64') {
  throw "Windows $arch is not supported by the prebuilt binaries (only x86_64/AMD64). Build from source: https://github.com/$repo#quick-start-self-host"
}
$suffix = 'windows-x86_64'

$base = if ($env:RYU_VERSION) {
  "https://github.com/$repo/releases/download/$($env:RYU_VERSION)"
} else {
  "https://github.com/$repo/releases/latest/download"
}

Write-Host "Installing Ryu ($suffix) into $installDir"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

for ($index = 0; $index -lt $binaries.Count; $index++) {
  $bin = $binaries[$index]
  $asset = "$bin-$suffix.exe"
  $url   = "$base/$asset"
  $out   = Join-Path $installDir "$bin.exe"
  $before = $index * 15
  $after = ($index + 1) * 15
  if ((Test-Path $out) -and -not $forceInstall) {
    Write-Host "  $bin already installed"
    Set-Content -Path "$out.version" -Value $installMarker -NoNewline
    Emit-Progress 'binary' $bin 'skipped' $after
    continue
  }

  Write-Host "  $bin"
  Emit-Progress 'binary' $bin 'started' $before
  $download = "$out.download"
  try {
    Invoke-WebRequest -Uri $url -OutFile $download -UseBasicParsing
  } catch {
    Fail-Install $bin "download failed: $url — $_"
  }

  # Checksum verification — fail closed. Releases publish a .sha256 next to
  # every binary, so a missing/failed checksum download aborts the install
  # instead of silently skipping verification. Emergency escape hatch:
  # $env:RYU_SKIP_CHECKSUM = '1'.
  if ($env:RYU_SKIP_CHECKSUM -eq '1') {
    Write-Host '  RYU_SKIP_CHECKSUM=1 — skipping checksum verification (not recommended)'
  } else {
    try {
      $shaContent = (Invoke-WebRequest -Uri "$url.sha256" -UseBasicParsing).Content
    } catch {
      Fail-Install $bin "could not download checksum $url.sha256 — refusing to install an unverified binary (set `$env:RYU_SKIP_CHECKSUM = '1' to bypass): $_"
    }
    if ($shaContent -is [byte[]]) { $shaContent = [System.Text.Encoding]::ASCII.GetString($shaContent) }
    $want = ([string]$shaContent -split '\s+')[0].Trim()
    if ($want -notmatch '^[0-9a-fA-F]{64}$') {
      Fail-Install $bin "malformed checksum file at $url.sha256 — refusing to install (set `$env:RYU_SKIP_CHECKSUM = '1' to bypass)"
    }
    $got = (Get-FileHash -Algorithm SHA256 -Path $download).Hash.ToLower()
    if ($want.ToLower() -ne $got) { Fail-Install $bin "checksum mismatch for $asset (want $want, got $got)" }
  }
  Move-Item -Force -Path $download -Destination $out
  Set-Content -Path "$out.version" -Value $installMarker -NoNewline
  Emit-Progress 'binary' $bin 'complete' $after
}

# --- PATH (user scope) ------------------------------------------------------
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $installDir) {
  $newPath = if ([string]::IsNullOrEmpty($userPath)) { $installDir } else { "$userPath;$installDir" }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  $env:Path = "$env:Path;$installDir"
  Write-Host "Added $installDir to your user PATH — open a new terminal to pick it up."
}

Write-Host ''
Write-Host "Done. Installed: $($binaries -join ', ')"

if ($startCore -eq '1') {
  $ryuHome = Split-Path -Parent $installDir
  $corePath = Join-Path $installDir 'ryu-core.exe'
  $coreLog = if ($env:RYU_CORE_LOG) { $env:RYU_CORE_LOG } else { Join-Path $ryuHome 'ryu-core.log' }
  $coreErrorLog = "$coreLog.err"
  $coreParent = Split-Path -Parent $coreLog
  New-Item -ItemType Directory -Force -Path $coreParent | Out-Null
  Emit-Progress 'core' 'ryu-core' 'started' 55

  function Test-CoreHealthy {
    try {
      $null = Invoke-WebRequest -Uri "$coreUrl/api/health" -UseBasicParsing -TimeoutSec 3
      return $true
    } catch {
      return $false
    }
  }

  if (-not (Test-CoreHealthy)) {
    Write-Host '  starting Ryu Core'
    Start-Process -FilePath $corePath -ArgumentList "--bind=$coreBind" -WorkingDirectory $ryuHome -WindowStyle Hidden -RedirectStandardOutput $coreLog -RedirectStandardError $coreErrorLog | Out-Null
  } else {
    Write-Host '  Ryu Core is already running'
  }

  $healthy = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-CoreHealthy) {
      $healthy = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $healthy) { Fail-Install 'ryu-core' "Ryu Core did not become healthy at $coreUrl" }
  Emit-Progress 'core' 'ryu-core' 'complete' 75

  if ($installDefaults -eq '1') {
    Write-Host '  Core is provisioning bundled models, engines, skills, and defaults'
    Emit-Progress 'defaults' 'bundled-defaults' 'started' 80
  } else {
    Write-Host '  bundled defaults were not requested'
    Emit-Progress 'defaults' 'bundled-defaults' 'skipped' 80
  }
  Write-Host '  Island and Ghost installs are disabled for this release'
  Emit-Progress 'defaults' 'island' 'skipped' 85
  Emit-Progress 'defaults' 'ghost' 'skipped' 85
}

Emit-Progress 'bootstrap' 'ryu' 'complete' 100
Write-Host ''
Write-Host 'Next:'
Write-Host '  ryu-core     # already running; starts the Gateway + local defaults if restarted'
Write-Host '  ryu-cli      # in another terminal, connect the TUI to it'
Write-Host ''
Write-Host 'Point any OpenAI-compatible client at the Gateway: http://127.0.0.1:7981/v1'
