param(
  [string]$ProjectDir = "C:\health-timeline-server-ready",
  [int]$Port = 8080,
  [string]$EntryFile = "server.js"
)

$ErrorActionPreference = "Stop"
$LogFile = Join-Path $ProjectDir "deploy.log"
$NodeOutLog = Join-Path $ProjectDir "node.out.log"
$NodeErrLog = Join-Path $ProjectDir "node.err.log"

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

function Test-CommandExists {
  param([string]$CommandName)
  return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Invoke-LoggedCommand {
  param(
    [string]$Command,
    [string]$Arguments,
    [string]$FailureMessage
  )

  $tempStdoutLog = Join-Path $env:TEMP ("health-timeline-command-out-" + [guid]::NewGuid().ToString() + ".log")
  $tempStderrLog = Join-Path $env:TEMP ("health-timeline-command-err-" + [guid]::NewGuid().ToString() + ".log")
  try {
    $process = Start-Process `
      -FilePath $Command `
      -ArgumentList $Arguments `
      -WorkingDirectory $ProjectDir `
      -RedirectStandardOutput $tempStdoutLog `
      -RedirectStandardError $tempStderrLog `
      -NoNewWindow `
      -Wait `
      -PassThru

    if (Test-Path $tempStdoutLog) {
      Get-Content $tempStdoutLog | ForEach-Object { Write-DeployLog $_ }
    }

    if (Test-Path $tempStderrLog) {
      Get-Content $tempStderrLog | ForEach-Object { Write-DeployLog $_ }
    }

    if ($process.ExitCode -ne 0) {
      throw "$FailureMessage with exit code $($process.ExitCode)"
    }
  } finally {
    if (Test-Path $tempStdoutLog) {
      Remove-Item $tempStdoutLog -Force
    }
    if (Test-Path $tempStderrLog) {
      Remove-Item $tempStderrLog -Force
    }
  }
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

try {
  if (!(Test-Path $ProjectDir)) {
    throw "Project directory not found: $ProjectDir"
  }

  Set-Location $ProjectDir

  if (!(Test-Path $LogFile)) {
    New-Item -Path $LogFile -ItemType File -Force | Out-Null
  }

  Write-DeployLog "========== Deploy started =========="
  Write-DeployLog "ProjectDir: $ProjectDir"
  Write-DeployLog "Port: $Port"
  Write-DeployLog "EntryFile: $EntryFile"

  if (!(Test-Path $EntryFile)) {
    throw "Entry file not found: $EntryFile"
  }

  if (!(Test-CommandExists "git")) {
    throw "Git is not installed or not in PATH. Install Git first, then retry."
  }

  if (!(Test-Path ".git")) {
    throw "This directory is not a git repository. Clone the GitHub repo here first."
  }

  Write-DeployLog "Running git pull..."
  Invoke-LoggedCommand -Command "git" -Arguments "pull" -FailureMessage "git pull failed"

  if (!(Test-CommandExists "npm")) {
    throw "npm is not installed or not in PATH. Install Node.js LTS first, then retry."
  }

  Write-DeployLog "Running npm install..."
  Invoke-LoggedCommand -Command "npm" -Arguments "install" -FailureMessage "npm install failed"

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
  Write-DeployLog "========== Deploy finished =========="
} catch {
  Write-DeployLog "DEPLOY FAILED: $($_.Exception.Message)"
  Write-DeployLog "========== Deploy aborted =========="
  exit 1
}
