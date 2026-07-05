param(
  [string]$ProjectDir = "C:\health-timeline-server-ready",
  [string]$ZipPath = "C:\health-timeline-update.zip",
  [int]$Port = 8080,
  [string]$EntryFile = "server.js"
)

$ErrorActionPreference = "Stop"
$LogFile = Join-Path $ProjectDir "deploy.log"
$NodeOutLog = Join-Path $ProjectDir "node.out.log"
$NodeErrLog = Join-Path $ProjectDir "node.err.log"
$StagingDir = Join-Path $env:TEMP ("health-timeline-update-" + (Get-Date -Format "yyyyMMddHHmmss"))
$EnvBackup = Join-Path $env:TEMP ("health-timeline-env-" + (Get-Date -Format "yyyyMMddHHmmss") + ".backup")

function Write-DeployLog {
  param([string]$Message)
  $time = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  $line = "[$time] $Message"
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Get-ListeningPidsByPort {
  param([int]$ListenPort)

  $pids = @()
  $lines = netstat -ano -p tcp | Select-String "LISTENING"
  foreach ($line in $lines) {
    $parts = ($line.ToString().Trim() -split "\s+")
    if ($parts.Length -lt 5) { continue }

    $localAddress = $parts[1]
    $pidText = $parts[$parts.Length - 1]
    if (($localAddress -match ":$ListenPort$") -and ($pidText -match "^\d+$")) {
      $pids += [int]$pidText
    }
  }

  return $pids | Sort-Object -Unique
}

function Get-PackageRoot {
  param([string]$Root)

  if (Test-Path (Join-Path $Root "package.json")) {
    return $Root
  }

  $children = Get-ChildItem -Path $Root -Directory
  if ($children.Count -eq 1) {
    $candidate = $children[0].FullName
    if (Test-Path (Join-Path $candidate "package.json")) {
      return $candidate
    }
  }

  throw "Cannot find package.json in extracted zip."
}

try {
  if (!(Test-Path $ProjectDir)) {
    New-Item -Path $ProjectDir -ItemType Directory -Force | Out-Null
  }

  if (!(Test-Path $ZipPath)) {
    throw "Zip file not found: $ZipPath"
  }

  if (!(Test-Path $LogFile)) {
    New-Item -Path $LogFile -ItemType File -Force | Out-Null
  }

  Write-DeployLog "========== Zip deploy started =========="
  Write-DeployLog "ProjectDir: $ProjectDir"
  Write-DeployLog "ZipPath: $ZipPath"
  Write-DeployLog "Port: $Port"
  Write-DeployLog "EntryFile: $EntryFile"

  $envFile = Join-Path $ProjectDir ".env"
  if (Test-Path $envFile) {
    Copy-Item $envFile $EnvBackup -Force
    Write-DeployLog "Backed up .env to $EnvBackup"
  } else {
    Write-DeployLog "No existing .env found. You may need to create it after deploy."
  }

  Write-DeployLog "Extracting zip to staging directory..."
  New-Item -Path $StagingDir -ItemType Directory -Force | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $StagingDir -Force
  $PackageRoot = Get-PackageRoot -Root $StagingDir
  Write-DeployLog "Package root: $PackageRoot"

  Write-DeployLog "Copying package files into project directory..."
  Copy-Item (Join-Path $PackageRoot "*") $ProjectDir -Recurse -Force

  if (Test-Path $EnvBackup) {
    Copy-Item $EnvBackup $envFile -Force
    Write-DeployLog "Restored existing .env"
  }

  Set-Location $ProjectDir

  if (!(Test-Path $EntryFile)) {
    throw "Entry file not found after copy: $EntryFile"
  }

  Write-DeployLog "Running npm install..."
  npm install 2>&1 | ForEach-Object { Write-DeployLog $_ }
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE"
  }

  Write-DeployLog "Checking old process on port $Port..."
  $oldPids = Get-ListeningPidsByPort -ListenPort $Port
  foreach ($oldPid in $oldPids) {
    Write-DeployLog "Stopping old process PID $oldPid on port $Port..."
    Stop-Process -Id $oldPid -Force -ErrorAction Stop
  }

  if ($oldPids.Count -gt 0) {
    Start-Sleep -Seconds 2
  }

  $nodeCommand = Get-Command node -ErrorAction Stop
  Write-DeployLog "Starting Node service in background..."
  Write-DeployLog "stdout: $NodeOutLog"
  Write-DeployLog "stderr: $NodeErrLog"

  $process = Start-Process `
    -FilePath $nodeCommand.Source `
    -ArgumentList $EntryFile `
    -WorkingDirectory $ProjectDir `
    -RedirectStandardOutput $NodeOutLog `
    -RedirectStandardError $NodeErrLog `
    -WindowStyle Hidden `
    -PassThru

  Start-Sleep -Seconds 3

  $newPids = Get-ListeningPidsByPort -ListenPort $Port
  if (!$newPids -or $newPids.Count -eq 0) {
    Write-DeployLog "Node process PID $($process.Id) started, but port $Port is not listening."
    Write-DeployLog "Check error log: $NodeErrLog"
    throw "Deploy failed because port $Port is not listening after restart."
  }

  Write-DeployLog "Node service started. Process PID: $($process.Id). Listening PID(s): $($newPids -join ', ')"
  Write-DeployLog "========== Zip deploy finished =========="
} catch {
  Write-DeployLog "ZIP DEPLOY FAILED: $($_.Exception.Message)"
  Write-DeployLog "========== Zip deploy aborted =========="
  exit 1
} finally {
  if (Test-Path $StagingDir) {
    Remove-Item $StagingDir -Recurse -Force
  }
}
