# Stop MT5 Connector service (Python uvicorn)

Write-Host "Stopping MT5 Connector service..." -ForegroundColor Yellow

# Find Python processes running uvicorn on port 3030
$processes = Get-NetTCPConnection -LocalPort 3030 -ErrorAction SilentlyContinue | 
    Select-Object -ExpandProperty OwningProcess -Unique

if ($processes) {
    foreach ($pid in $processes) {
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "Found process: $($proc.ProcessName) (PID: $pid)" -ForegroundColor Cyan
            Stop-Process -Id $pid -Force
            Write-Host "✓ Stopped process $pid" -ForegroundColor Green
        }
    }
} else {
    Write-Host "No process found running on port 3030" -ForegroundColor Yellow
}

# Also try to find any Python processes with uvicorn in command line
$pythonProcs = Get-WmiObject Win32_Process | Where-Object { 
    $_.CommandLine -like "*uvicorn*" -and $_.CommandLine -like "*mt5-connector*" 
}

if ($pythonProcs) {
    foreach ($proc in $pythonProcs) {
        Write-Host "Found Python uvicorn process: PID $($proc.ProcessId)" -ForegroundColor Cyan
        Stop-Process -Id $proc.ProcessId -Force
        Write-Host "✓ Stopped process $($proc.ProcessId)" -ForegroundColor Green
    }
}

Write-Host "`nDone!" -ForegroundColor Green

