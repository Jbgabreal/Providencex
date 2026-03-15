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

# Start MT5 connector as a background job (stays in THIS terminal)
Write-Host "[1/2] Starting MT5 connector on port 3030..."
$job = Start-Job -ScriptBlock {
    Set-Location $using:MT5_DIR
    py run.py 2>&1
}

# Wait for health check
$maxRetries = 10
$connected = $false
for ($i = 1; $i -le $maxRetries; $i++) {
    Start-Sleep -Seconds 2
    Write-Host "  Waiting for MT5 connector... ($i/$maxRetries)"

    # Check if job died
    if ($job.State -eq "Failed" -or $job.State -eq "Completed") {
        Write-Host ""
        Write-Host "ERROR: MT5 connector process exited."
        Write-Host ""
        Receive-Job $job
        Remove-Job $job -Force
        exit 1
    }

    try {
        $health = Invoke-RestMethod -Uri "http://localhost:3030/health" -TimeoutSec 3
        $connected = $true
        break
    } catch {}
}

if (-not $connected) {
    Write-Host ""
    Write-Host "ERROR: MT5 connector did not respond after $($maxRetries * 2) seconds."
    Receive-Job $job
    Stop-Job $job; Remove-Job $job -Force
    exit 1
}

Write-Host ""
Write-Host "  MT5 connector running"
Write-Host "  Account: $($health.account_info.login) @ $($health.account_info.server)"
Write-Host "  Balance: `$$($health.account_info.balance) $($health.account_info.currency)"
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
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Stop-Process -Name python -Force -ErrorAction SilentlyContinue
}
