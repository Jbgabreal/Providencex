# Clean restart script to fix environment variable embedding

Write-Host "🛑 Stopping any running Next.js processes..." -ForegroundColor Yellow
Get-Process | Where-Object { $_.ProcessName -eq "node" -and $_.MainWindowTitle -like "*next*" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "🗑️  Clearing Next.js cache..." -ForegroundColor Yellow
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .next\cache -ErrorAction SilentlyContinue

Write-Host "✅ Cache cleared!" -ForegroundColor Green
Write-Host ""
Write-Host "🔍 Verifying .env.local exists..." -ForegroundColor Yellow
if (Test-Path .env.local) {
    Write-Host "✅ .env.local found" -ForegroundColor Green
    Get-Content .env.local | Select-String "NEXT_PUBLIC_PRIVY_APP_ID"
} else {
    Write-Host "❌ .env.local NOT found!" -ForegroundColor Red
    Write-Host "Creating from root .env..." -ForegroundColor Yellow
    $rootEnv = Get-Content ..\..\.env | Select-String "NEXT_PUBLIC"
    $rootEnv | ForEach-Object { $_ -replace "^\s*", "" } | Set-Content .env.local
    Write-Host "✅ Created .env.local" -ForegroundColor Green
}

Write-Host ""
Write-Host "🚀 Starting dev server..." -ForegroundColor Cyan
Write-Host "   (This will rebuild with environment variables embedded)" -ForegroundColor Gray
Write-Host ""

pnpm dev

