# ProvidenceX MT5 Connector + Tunnel
# Usage: powershell -File scripts/start-mt5-tunnel.ps1

$DOMAIN = "inbond-undisputatiously-arlena.ngrok-free.dev"
$MT5_DIR = Join-Path $PSScriptRoot "..\services\mt5-connector"

# Kill existing processes
Write-Host ""
Stop-Process -Name ngrok -Force -ErrorAction SilentlyContinue
Stop-Process -Name python -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "========================================="
Write-Host "  ProvidenceX MT5 Connector"
Write-Host "========================================="
Write-Host ""

# Start MT5 connector in background
Write-Host "[1/2] Starting MT5 connector on port 3030..."
$mt5Process = Start-Process -FilePath "py" -ArgumentList "-c","import uvicorn; uvicorn.run('src.main:app', host='0.0.0.0', port=3030)" -WorkingDirectory $MT5_DIR -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 4

# Check if MT5 connector started
try {
    $health = Invoke-RestMethod -Uri "http://localhost:3030/health" -TimeoutSec 5
    Write-Host "  MT5 connector running (PID: $($mt5Process.Id))"
    Write-Host "  Account: $($health.account_info.login) @ $($health.account_info.server)"
    Write-Host "  Balance: `$$($health.account_info.balance) $($health.account_info.currency)"
} catch {
    Write-Host "ERROR: MT5 connector failed to start. Is MetaTrader 5 running?"
    Stop-Process -Id $mt5Process.Id -Force -ErrorAction SilentlyContinue
    exit 1
}

Write-Host ""
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
