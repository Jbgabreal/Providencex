# ProvidenceX TradingView Signal Setup

## Architecture

```
TradingView (Pine indicator on M1 chart)
   │  Analyzes: H4 bias + M15 BOS/OB + M1 displacement
   │  When all conditions align → fires alert()
   ↓
Webhook (POST https://<engine>/api/tv/webhook)
   │  JSON payload with symbol, direction, entry, SL, TP
   ↓
Trading Engine (guardrail → risk → position sizing → execute)
   ↓
MT5 / Deriv (trade placed)
```

## Step 1: Add Pine Indicator to TradingView

1. Open TradingView → **Pine Editor** (bottom panel)
2. Click **Open** → **New indicator**
3. Delete the default code
4. Copy-paste the contents of `ProvidenceX_MTF_ICT.pine`
5. Click **Add to chart**
6. Set chart to **M1 timeframe** for XAUUSD (or your symbol)

### Indicator Settings

| Setting | Default | Notes |
|---------|---------|-------|
| HTF Bias Timeframe | 240 (H4) | Determines bullish/bearish market direction |
| ITF Setup Timeframe | 15 (M15) | Detects BOS + Order Block zones |
| Swing Length | 5 | Bars left/right for swing confirmation |
| Minimum R:R | 1.5 | Reject signals below this risk:reward |
| Kill Zone Filter | On | Only trade during London/NY sessions |
| Webhook Secret | (empty) | Must match `TV_WEBHOOK_SECRET` env var |

## Step 2: Set Up Alert

1. Right-click the indicator name on chart → **Add alert on...**
2. Or: Click the **Alert** button (clock icon) → **Create Alert**
3. Settings:
   - **Condition:** ProvidenceX MTF ICT Signal
   - **Trigger:** "Any alert() function call"
   - **Expiration:** Set to max (open-ended)
   - **Alert actions → Webhook URL:**
     ```
     https://<your-trading-engine-url>/api/tv/webhook
     ```
   - **Message:** Leave empty! The Pine script's `alert()` function sends the full JSON automatically.

### For Railway deployment:
```
https://trading-engine-production-XXXX.up.railway.app/api/tv/webhook
```

### For local development:
```
http://localhost:3020/api/tv/webhook
```
(Use ngrok if TradingView can't reach localhost)

## Step 3: Configure Trading Engine

Add these environment variables:

```bash
# Required: Secret to authenticate webhook (set the same value in Pine indicator settings)
TV_WEBHOOK_SECRET=your-random-secret-here

# Optional: Minimum R:R (default 1.0, Pine indicator also checks its own minRR)
TV_MIN_RR=1.5

# Optional: Maximum SL in pips (safety limit, default 500)
TV_MAX_SL_PIPS=200
```

## Step 4: Test

### Test webhook manually:
```bash
curl -X POST http://localhost:3020/api/tv/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "secret": "your-random-secret-here",
    "symbol": "XAUUSD",
    "direction": "buy",
    "entry": 3050.00,
    "stopLoss": 3040.00,
    "takeProfit": 3065.00,
    "reason": "Test signal"
  }'
```

### Check webhook is reachable:
```bash
curl http://localhost:3020/api/tv/webhook
# Should return: {"status":"ok","service":"tradingview-webhook",...}
```

## Alert JSON Format

The Pine indicator sends this JSON via webhook:

```json
{
  "secret": "your-secret",
  "symbol": "XAUUSD",
  "direction": "buy",
  "entry": 3050.50,
  "stopLoss": 3042.30,
  "takeProfit": 3062.80,
  "orderKind": "market",
  "reason": "H4 bullish + M15 bullish BOS + OB retest + M1 displacement",
  "meta": {
    "htfBias": "bullish",
    "itfBOS": "bullish",
    "obZone": "3040.50-3048.20",
    "rr": 1.52,
    "killZone": "London",
    "interval": "1"
  }
}
```

## How the Signal Logic Works

1. **H4 Bias**: Checks if H4 swing highs/lows are making higher-highs + higher-lows (bullish) or lower-lows + lower-highs (bearish)
2. **M15 BOS**: Detects when M15 close breaks above the last swing high (bullish BOS) or below the last swing low (bearish BOS)
3. **M15 Order Block**: After a BOS, finds the last opposing candle before the break — that's the OB zone
4. **M1 Entry**: Waits for price to retrace into the M15 OB zone, then confirms with a displacement candle (>60% body, strong move in bias direction)
5. **Kill Zone**: Only fires during London (02:00-05:00 UTC) or New York (07:00-10:00 UTC) sessions
6. **R:R Check**: SL is placed below/above the OB edge + buffer. TP is calculated at minimum R:R. Signal rejected if R:R is too low.

## CDP Bridge (Option B — Backup)

The CDP bridge still works as a secondary signal source. If you also want to use it:

```bash
# Activate in ACTIVE_STRATEGIES
ACTIVE_STRATEGIES=tradingview_signal_v1

# Configure CDP connection
TV_CDP_HOST=localhost
TV_CDP_PORT=9222
```

The CDP bridge reads the same Pine indicator's box/label/line drawings directly from TradingView Desktop. This provides redundancy — webhook is the primary, CDP is the backup.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Alert not firing | Make sure chart is on M1, indicator is added, alert condition is "Any alert() function call" |
| Webhook 400 error | Check JSON format, ensure all required fields present |
| "Invalid webhook secret" | Match `TV_WEBHOOK_SECRET` env var with Pine indicator's Webhook Secret input |
| No signals during testing | Check H4 bias (might be sideways), check if in kill zone hours, lower minRR temporarily |
| Signal fires but no trade | Check engine logs — guardrail, risk limits, or spread may be blocking |
