param(
  [string]$ProjectDir = "C:\health-timeline-server-ready",
  [string]$DeployScript = "C:\health-timeline-server-ready\deploy.ps1",
  [string]$RemoteName = "origin"
)

$ErrorActionPreference = "Stop"
$LogFile = Join-Path $ProjectDir "deploy.log"
$LockFile = Join-Path $ProjectDir "auto-deploy.lock"

function Write-DeployLog {
  param([string]$Message)
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$time] $Message"
  Write-Host $line

  for ($i = 1; $i -le 5; $i++) {
    try {
      Add-Content -Path $LogFile -Value $line -Encoding UTF8 -ErrorAction Stop
      return
    } catch {
      if ($i -eq 5) { throw }
      Start-Sleep -Milliseconds 300
    }
  }
}

try {
  if (!(Test-Path $ProjectDir)) {
    throw "Project directory not found: $ProjectDir"
  }

  Set-Location $ProjectDir

  if (!(Test-Path $LogFile)) {
    New-Item -Path $LogFile -ItemType File -Force | Out-Null
  }

  if (Test-Path $LockFile) {
    $lockAge = (Get-Date) - (Get-Item $LockFile).LastWriteTime
    if ($lockAge.TotalMinutes -lt 10) {
      Write-DeployLog "Auto deploy skipped because another deploy is running."
      exit 0
    }
    Write-DeployLog "Removing stale auto deploy lock."
    Remove-Item $LockFile -Force
  }

  New-Item -Path $LockFile -ItemType File -Force | Out-Null

  if (!(Test-Path ".git")) {
    throw "This directory is not a git repository. Auto deploy needs a GitHub clone."
  }

  Write-DeployLog "========== Auto deploy check started =========="
  Write-DeployLog "Fetching remote changes..."
  git fetch $RemoteName 2>&1 | ForEach-Object { Write-DeployLog $_ }
  if ($LASTEXITCODE -ne 0) {
    throw "git fetch failed with exit code $LASTEXITCODE"
  }

  $localHead = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read local HEAD."
  }

  $upstreamOutput = git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null
  $upstream = ""
  if ($upstreamOutput) {
    $upstream = ($upstreamOutput | Select-Object -First 1).Trim()
  }
  if (!$upstream) {
    $branch = (git branch --show-current).Trim()
    if (!$branch) {
      throw "Unable to detect current git branch."
    }
    $upstream = "$RemoteName/$branch"
  }

  $remoteHead = (git rev-parse $upstream).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read remote HEAD: $upstream"
  }

  Write-DeployLog "Local HEAD:  $localHead"
  Write-DeployLog "Remote HEAD: $remoteHead ($upstream)"

  if ($localHead -eq $remoteHead) {
    Write-DeployLog "No new commit found. Auto deploy finished without changes."
    Write-DeployLog "========== Auto deploy check finished =========="
    exit 0
  }

  if (!(Test-Path $DeployScript)) {
    throw "Deploy script not found: $DeployScript"
  }

  Write-DeployLog "New commit found. Running deploy script..."
  powershell -ExecutionPolicy Bypass -File $DeployScript
  if ($LASTEXITCODE -ne 0) {
    throw "deploy.ps1 failed with exit code $LASTEXITCODE"
  }

  Write-DeployLog "Auto deploy finished successfully."
  Write-DeployLog "========== Auto deploy check finished =========="
} catch {
  Write-DeployLog "AUTO DEPLOY FAILED: $($_.Exception.Message)"
  Write-DeployLog "========== Auto deploy aborted =========="
  exit 1
} finally {
  if (Test-Path $LockFile) {
    Remove-Item $LockFile -Force
  }
}
