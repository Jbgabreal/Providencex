# SMC Environment Variable Configuration Guide

## Critical SMC Configuration Variables

These environment variables control SMC v2 strategy behavior and can significantly impact trade generation.

### 1. Minimum Candle Requirements

**Variable**: `SMC_MIN_HTF_CANDLES`
- **Default**: `20`
- **Description**: Minimum number of HTF (H4) candles required for analysis
- **Current Issue**: With only 23 H4 candles, this is barely met
- **Recommendation for Limited Data**: Set to `10` or `15` for backtesting with limited historical data

```bash
# For backtesting with limited candles (e.g., 20-30 H4 candles)
SMC_MIN_HTF_CANDLES=10
```

**Impact**: 
- If HTF candles < this value, strategy rejects with "Insufficient candles"
- Lower value = more trades but potentially less reliable
- Higher value = fewer trades but more reliable (requires more historical data)

---

### 2. LTF BOS Requirement (STRICT)

**Variable**: `SMC_REQUIRE_LTF_BOS`
- **Default**: `true` (STRICT MODE)
- **Description**: If `true`, LTF BOS is a **hard requirement** - setup is rejected if no LTF BOS
- **Current Issue**: This is likely blocking trades - LTF BOS may not always be present
- **Recommendation**: Set to `false` for more lenient detection

```bash
# Relaxed mode: LTF BOS is optional
SMC_REQUIRE_LTF_BOS=false
```

**Impact**:
- `true` = Very strict, requires LTF BOS confirmation (fewer trades, higher quality)
- `false` = More lenient, allows ITF BOS or LTF BOS (more trades, potentially lower quality)

---

### 3. Minimum ITF BOS Count

**Variable**: `SMC_MIN_ITF_BOS_COUNT`
- **Default**: `1`
- **Description**: Minimum number of ITF BOS events required
- **Current Issue**: With limited candles, ITF BOS may not be detected
- **Recommendation**: Set to `0` for relaxed mode

```bash
# Relaxed mode: ITF BOS not required
SMC_MIN_ITF_BOS_COUNT=0
```

**Impact**:
- `0` = ITF BOS not required (most lenient)
- `1` = At least 1 ITF BOS required (default)
- `2+` = Very strict, requires multiple ITF BOS events

---

### 4. Debug Logging

**Variable**: `SMC_DEBUG`
- **Default**: Not set (false)
- **Description**: Enable detailed SMC debug logging
- **Recommendation**: Set to `true` to diagnose issues

```bash
# Enable detailed SMC logging
SMC_DEBUG=true
```

**Impact**: Provides detailed logs about:
- Swing detection
- BOS detection
- Trend detection
- Rejection reasons

---

## Recommended Configuration for Limited Data / Backtesting

For backtesting with limited historical data (20-30 H4 candles), use these relaxed settings:

```bash
# Relaxed configuration for limited data
SMC_MIN_HTF_CANDLES=10          # Reduced from 20
SMC_REQUIRE_LTF_BOS=false       # LTF BOS optional
SMC_MIN_ITF_BOS_COUNT=0         # ITF BOS not required
SMC_DEBUG=true                  # Enable debug logging
```

## Recommended Configuration for Production

For production with sufficient historical data (50+ H4 candles), use strict settings:

```bash
# Strict configuration for production
SMC_MIN_HTF_CANDLES=20          # Default
SMC_REQUIRE_LTF_BOS=true        # Default (strict)
SMC_MIN_ITF_BOS_COUNT=1         # Default
SMC_DEBUG=false                 # Disable in production
```

## Other SMC Configuration Variables

### Session Filters

**Variables**: 
- `SMC_LOW_ALLOWED_SESSIONS` - Allowed sessions for low-risk strategy
- `SMC_HIGH_ALLOWED_SESSIONS` - Allowed sessions for high-risk strategy

**Format**: Comma-separated list (e.g., `"london,newyork"`)

**Default**: See `services/trading-engine/src/config/smcSessionConfig.ts`

---

## How to Set Environment Variables

### Option 1: System Environment Variables

Set in your shell or system environment:
```bash
# Windows PowerShell
$env:SMC_MIN_HTF_CANDLES="10"
$env:SMC_REQUIRE_LTF_BOS="false"
$env:SMC_MIN_ITF_BOS_COUNT="0"
$env:SMC_DEBUG="true"

# Linux/Mac
export SMC_MIN_HTF_CANDLES=10
export SMC_REQUIRE_LTF_BOS=false
export SMC_MIN_ITF_BOS_COUNT=0
export SMC_DEBUG=true
```

### Option 2: .env File (if using dotenv)

Create `.env` file in `services/trading-engine/`:
```bash
SMC_MIN_HTF_CANDLES=10
SMC_REQUIRE_LTF_BOS=false
SMC_MIN_ITF_BOS_COUNT=0
SMC_DEBUG=true
```

### Option 3: Doppler (Project uses Doppler)

If using Doppler (as per memory), set these in your Doppler config:
```bash
doppler secrets set SMC_MIN_HTF_CANDLES=10
doppler secrets set SMC_REQUIRE_LTF_BOS=false
doppler secrets set SMC_MIN_ITF_BOS_COUNT=0
doppler secrets set SMC_DEBUG=true
```

---

## Current Configuration Check

Based on your backtest logs, the current configuration appears to be:

```
SMC_MIN_HTF_CANDLES=20 (default)      ✅ OK (you have 23 candles)
SMC_REQUIRE_LTF_BOS=true (default)    ⚠️ STRICT - may be blocking
SMC_MIN_ITF_BOS_COUNT=1 (default)    ⚠️ STRICT - may be blocking
```

**Issue**: With strict BOS requirements and limited candles, trades are being rejected.

---

## Quick Fix for Backtesting

To allow more trades during backtesting, set these before running:

```bash
# Windows PowerShell
$env:SMC_MIN_HTF_CANDLES="10"
$env:SMC_REQUIRE_LTF_BOS="false"
$env:SMC_MIN_ITF_BOS_COUNT="0"
$env:SMC_DEBUG="true"

# Then run backtest
pnpm --filter trading-engine backtest
```

---

## Validation

After setting these variables, check the logs for:

```
[SMCStrategyV2] BOS requirements: REQUIRE_LTF_BOS=false, MIN_ITF_BOS_COUNT=0
[SMCStrategyV2] MinCandles: HTF=10, ITF=20, LTF=10
```

If you see these values, the configuration is applied correctly.

