# ProvidenceX MT5 Connector + Tunnel
# Usage: powershell -File scripts/start-mt5-tunnel.ps1

$DOMAIN = "inbond-undisputatiously-arlena.ngrok-free.dev"
$MT5_DIR = Join-Path $PSScriptRoot "..\services\mt5-connector"
$LOG_FILE = Join-Path $env:TEMP "mt5-connector.log"

# Kill existing processes
Write-Host ""
Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "========================================="
Write-Host "  ProvidenceX MT5 Connector"
Write-Host "========================================="
Write-Host ""

# Start MT5 connector in background with output captured
Write-Host "[1/2] Starting MT5 connector on port 3030..."
Write-Host "  Working dir: $MT5_DIR"
Write-Host "  Log file: $LOG_FILE"

$mt5Process = Start-Process -FilePath "py" `
    -ArgumentList "-c", "import uvicorn; uvicorn.run('src.main:app', host='0.0.0.0', port=3030)" `
    -WorkingDirectory $MT5_DIR `
    -PassThru `
    -RedirectStandardOutput $LOG_FILE `
    -RedirectStandardError "$LOG_FILE.err"

# Wait and retry health check
$maxRetries = 10
$connected = $false
for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds 2
    Write-Host "  Waiting for MT5 connector... ($i/$maxRetries)"

    # Check if process died
    if ($mt5Process.HasExited) {
        Write-Host ""
        Write-Host "ERROR: MT5 connector process exited with code $($mt5Process.ExitCode)"
        Write-Host ""
        Write-Host "--- Error Log ---"
        if (Test-Path "$LOG_FILE.err") { Get-Content "$LOG_FILE.err" }
        Write-Host "--- Output Log ---"
        if (Test-Path $LOG_FILE) { Get-Content $LOG_FILE | Select-Object -Last 20 }
        exit 1
    }

    try {
        $health = Invoke-RestMethod -Uri "http://localhost:3030/health" -TimeoutSec 3
        $connected = $true
        break
    } catch {
        # Keep waiting
    }
}

if (-not $connected) {
    Write-Host ""
    Write-Host "ERROR: MT5 connector did not respond after $($maxRetries * 2) seconds."
    Write-Host ""
    Write-Host "--- Error Log ---"
    if (Test-Path "$LOG_FILE.err") { Get-Content "$LOG_FILE.err" | Select-Object -Last 20 }
    Write-Host "--- Output Log ---"
    if (Test-Path $LOG_FILE) { Get-Content $LOG_FILE | Select-Object -Last 20 }
    Stop-Process -Id $mt5Process.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
Write-Host "  MT5 connector running (PID: $($mt5Process.Id))"
Write-Host "  Account: $($health.account_info.login) @ $($health.account_info.server)"
Write-Host "  Balance: `$$($health.account_info.balance) $($health.account_info.currency)"
Write-Host ""

# Start ngrok tunnel
Write-Host "[2/2] Starting tunnel..."
Write-Host "  URL: https://$DOMAIN"
Write-Host ""
Write-Host "========================================="
Write-Host "  LIVE - Trading engine can reach MT5"
Write-Host "  Press Ctrl+C to stop everything"
Write-Host "========================================="
Write-Host ""

try {
    ngrok http 3030 --domain $DOMAIN
} finally {
    Write-Host "Shutting down..."
    Stop-Process -Id $mt5Process.Id -Force -ErrorAction SilentlyContinue
}
