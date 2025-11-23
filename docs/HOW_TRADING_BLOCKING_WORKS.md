# How Trading Blocking Works - Technical Deep Dive

## Quick Answer: How Does the System Know When NOT to Trade?

The system determines when **NOT** to trade by:

1. **Getting current time** in America/New_York timezone
2. **Loading today's avoid windows** from the database (`daily_news_windows` table)
3. **Looping through each window** in the `avoid_windows` JSONB array
4. **Checking if current time** falls between any window's `start_time` and `end_time`
5. **If YES** → Return `can_trade: false` with the blocking window details
6. **If NO** → Return `can_trade: true`

## Visual Flow

```
┌─────────────────────────────────────────────────┐
│ GET /can-i-trade-now                           │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Get Current Time (NY Timezone)                 │
│ Example: 2025-11-19 08:15:00 -05:00            │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Query Database: SELECT * FROM daily_news_      │
│ windows WHERE date = '2025-11-19'              │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Get avoid_windows JSONB Array                  │
│ [                                                │
│   {                                              │
│     event_name: "CPI y/y",                      │
│     start_time: "2025-11-19T01:00:00-05:00",   │
│     end_time: "2025-11-19T03:30:00-05:00",     │
│     currency: "GBP",                            │
│     risk_score: 90,                             │
│     ...                                          │
│   },                                             │
│   ... (more windows)                            │
│ ]                                                │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Loop Through Each Window                       │
│                                                  │
│ For each window:                                │
│   Is current_time >= start_time AND <= end_time?│
│                                                  │
│   Window 1: 01:00 - 03:30                       │
│   Current: 08:15                                │
│   Result: NO (08:15 is AFTER 03:30)            │
│                                                  │
│   Window 2: 08:00 - 09:00                       │
│   Current: 08:15                                │
│   Result: YES (08:15 is BETWEEN 08:00-09:00)   │
└──────────────────┬──────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────┐
│ Return Response                                 │
│ {                                                │
│   can_trade: false,                             │
│   inside_avoid_window: true,                    │
│   active_window: { ... window details ... }     │
│ }                                                │
└─────────────────────────────────────────────────┘
```

## Code Implementation

### Step 1: Get Today's Windows

```typescript
// services/news-guardrail/src/services/newsScanService.ts

export async function getTodayNewsMap(): Promise<DailyNewsMap | null> {
  const today = formatDateForPX(getNowInPXTimezone()); // "2025-11-19"
  const pool = getDbPool();

  // Query database for today's row
  const result = await pool.query(
    'SELECT * FROM daily_news_windows WHERE date = $1',
    [today]
  );

  if (result.rows.length === 0) {
    return null; // No data for today
  }

  // Return the row with avoid_windows JSONB parsed to array
  return {
    id: result.rows[0].id,
    date: result.rows[0].date,
    avoid_windows: result.rows[0].avoid_windows as NewsWindow[], // JSONB → Array
    ...
  };
}
```

### Step 2: Check Current Time Against Windows

```typescript
// services/news-guardrail/src/services/tradingCheckService.ts

export async function canTradeNow(): Promise<CanTradeResponse> {
  const now = getNowInPXTimezone(); // Current time in NY: 2025-11-19 08:15:00 -05:00
  const todayMap = await getTodayNewsMap(); // Get today's windows from DB

  if (!todayMap || todayMap.avoid_windows.length === 0) {
    return { can_trade: true, ... }; // No windows = safe to trade
  }

  // Loop through each avoid window
  for (const window of todayMap.avoid_windows) {
    // Check if current time falls within this window
    if (isTimeInWindow(now, window.start_time, window.end_time)) {
      // Current time IS within this window → BLOCK TRADING
      return {
        can_trade: false,
        inside_avoid_window: true,
        active_window: window, // Full window details (event_name, risk_score, reason, etc.)
      };
    }
  }

  // No windows matched → SAFE TO TRADE
  return { can_trade: true, inside_avoid_window: false, active_window: null };
}
```

### Step 3: Time Window Check Logic

```typescript
// packages/shared-utils/src/index.ts

export function isTimeInWindow(
  time: DateTime,        // Current time: 2025-11-19 08:15:00 -05:00
  startTime: string,     // "2025-11-19T08:00:00.000-05:00"
  endTime: string        // "2025-11-19T09:00:00.000-05:00"
): boolean {
  const start = parseToPXTimezone(startTime); // Convert to DateTime
  const end = parseToPXTimezone(endTime);     // Convert to DateTime
  
  // Check: Is current time between start and end?
  return time >= start && time <= end;
  
  // Example:
  // time:   08:15:00
  // start:  08:00:00
  // end:    09:00:00
  // Result: true (08:15 is between 08:00 and 09:00)
}
```

## Example Scenarios

### Scenario 1: Current Time is 02:00 AM (Within Avoid Window)

**Current Time**: `2025-11-19 02:00:00 -05:00`

**Avoid Windows**:
```json
[
  {
    "event_name": "CPI y/y",
    "start_time": "2025-11-19T01:00:00.000-05:00",  // 01:00 AM
    "end_time": "2025-11-19T03:30:00.000-05:00",    // 03:30 AM
    "currency": "GBP",
    "risk_score": 90,
    "is_critical": true
  }
]
```

**Check**:
- Is `02:00 AM` >= `01:00 AM`? **YES**
- Is `02:00 AM` <= `03:30 AM`? **YES**
- Result: **INSIDE WINDOW**

**Response**:
```json
{
  "can_trade": false,
  "inside_avoid_window": true,
  "active_window": {
    "event_name": "CPI y/y",
    "currency": "GBP",
    "risk_score": 90,
    "is_critical": true,
    "reason": "High-impact inflation data release from the UK.",
    ...
  }
}
```

### Scenario 2: Current Time is 08:15 AM (Outside Avoid Window)

**Current Time**: `2025-11-19 08:15:00 -05:00`

**Avoid Windows** (same as above):
- Window 1: `01:00 AM - 03:30 AM`
- Current: `08:15 AM`
- Check: Is `08:15 AM` between `01:00 AM` and `03:30 AM`? **NO**

**Response**:
```json
{
  "can_trade": true,
  "inside_avoid_window": false,
  "active_window": null
}
```

## Why Same Row Gets Updated

The user noticed that **the same row gets updated** on each manual scan. This is **correct behavior**:

```sql
INSERT INTO daily_news_windows (date, avoid_windows, updated_at)
VALUES ($1, $2::jsonb, NOW())
ON CONFLICT (date) 
DO UPDATE SET avoid_windows = $2::jsonb, updated_at = NOW()
```

**Explanation**:
- The `date` column has a `UNIQUE` constraint
- Each trading day should have **only one** set of avoid windows
- If you scan multiple times on the same day:
  - First scan: Creates new row for that date
  - Second scan: Updates the same row (because date already exists)
  - This ensures data freshness - latest scan wins

**This is intentional and correct** - you want the most up-to-date news analysis for today, not multiple rows for the same date.

## Database Schema Clarification

**Current Schema** (correct):
```sql
CREATE TABLE daily_news_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  avoid_windows JSONB NOT NULL,  -- ← All data stored here
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
);
```

**If you see extra columns** like:
- `is_critical` (bool)
- `risk_score` (int4)
- `reason` (text)
- `detailed_description` (text)

**These are NOT used** - they were likely added manually. The system stores all data in the JSONB `avoid_windows` column.

The migration in `client.ts` will automatically clean these up on next startup.

## Summary

✅ **System correctly determines when NOT to trade** by:
1. Getting current time in NY timezone
2. Loading today's avoid windows from JSONB array
3. Checking if current time falls within any window's time range
4. Returning detailed blocking information if match found

✅ **Schema is correct** - JSONB is the right choice for flexible event data

✅ **Row updates are correct** - Each day has one row, latest scan updates it

The system is working as designed! 🎯

