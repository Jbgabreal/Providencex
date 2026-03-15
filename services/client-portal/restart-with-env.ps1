# Quick restart script to pick up environment variables

Write-Host "🔄 Clearing Next.js cache..." -ForegroundColor Yellow
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue

Write-Host "✅ Cache cleared!" -ForegroundColor Green
Write-Host ""
Write-Host "🚀 Starting dev server..." -ForegroundColor Yellow
Write-Host "   (This will pick up environment variables from root .env file)" -ForegroundColor Gray
Write-Host ""

pnpm dev

