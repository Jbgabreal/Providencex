# News Guardrail Architecture & How Trading Windows Work

## System Overview

The News Guardrail service prevents automated trading during high-risk news events by:
1. Scanning ForexFactory calendar daily for USD/EUR/GBP events
2. Analyzing risk levels with OpenAI Vision
3. Creating "avoid windows" (time periods when trading is blocked)
4. Providing real-time trading permission checks

## Database Schema

### Table: `daily_news_windows`

```sql
CREATE TABLE daily_news_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,           -- Trading date (YYYY-MM-DD in NY timezone)
  avoid_windows JSONB NOT NULL,        -- Array of NewsWindow objects
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Important**: All event data (risk_score, is_critical, reason, etc.) is stored **inside** the JSONB `avoid_windows` array, NOT as separate columns.

### JSONB Structure

Each element in `avoid_windows` array has this structure:

```json
{
  "start_time": "2025-11-19T01:00:00.000-05:00",  // ISO 8601 in NY timezone
  "end_time": "2025-11-19T03:30:00.000-05:00",    // ISO 8601 in NY timezone
  "currency": "USD" | "EUR" | "GBP",
  "impact": "high" | "medium" | "low",
  "event_name": "CPI y/y",
  "is_critical": true,
  "risk_score": 90,
  "reason": "High-impact inflation data release from the UK.",
  "detailed_description": "Full explanation..."
}
```

## How Trading Permission Works

### 1. Daily Scan Process

```
08:00 NY Time (Mon-Fri)
  ↓
Capture ForexFactory Screenshot
  ↓
OpenAI Vision Analysis
  ↓
Extract Events + Risk Assessment
  ↓
Calculate Avoid Windows (start_time, end_time)
  ↓
Store in Database (JSONB array)
```

### 2. Real-Time Trading Check

**Endpoint**: `GET /can-i-trade-now`

**Process**:
```
User/System calls endpoint
  ↓
Get current time in NY timezone
  ↓
Query database for today's avoid_windows
  ↓
Loop through each window in array
  ↓
Check: Is current time >= start_time AND <= end_time?
  ↓
If YES → Return { can_trade: false, active_window: {...} }
If NO for all windows → Return { can_trade: true }
```

### 3. Code Flow

```typescript
// services/news-guardrail/src/services/tradingCheckService.ts

export async function canTradeNow(): Promise<CanTradeResponse> {
  const now = getNowInPXTimezone();              // Current time in NY
  const todayMap = await getTodayNewsMap();      // Get today's data from DB
  
  // Loop through each avoid window
  for (const window of todayMap.avoid_windows) {
    // Check if current time falls within this window
    if (isTimeInWindow(now, window.start_time, window.end_time)) {
      return {
        can_trade: false,
        inside_avoid_window: true,
        active_window: window  // Returns full window details including risk_score, reason
      };
    }
  }
  
  // No active windows found
  return { can_trade: true, inside_avoid_window: false };
}
```

## Time Window Calculation

Avoid windows are calculated based on model-provided values:

```typescript
// services/news-guardrail/src/services/openaiService.ts

const eventTime = todayDate.set({ hour: hours, minute: minutes }); // Event time
const startTime = eventTime.minus({ minutes: event.avoid_before_minutes }); // e.g., 90 minutes before
const endTime = eventTime.plus({ minutes: event.avoid_after_minutes });     // e.g., 60 minutes after

// Example:
// Event: CPI Release at 08:30 NY
// avoid_before_minutes: 90
// avoid_after_minutes: 60
// Result: Avoid window from 07:00 to 09:30 NY time
```

## Data Storage Strategy

### Why JSONB?

**Advantages**:
- ✅ Flexible schema (easy to add new fields)
- ✅ Single query to get all windows
- ✅ PostgreSQL native JSONB support with indexing
- ✅ Type-safe TypeScript interfaces

**Trade-offs**:
- ⚠️ All windows loaded into memory (usually fine for daily data)
- ⚠️ Can't easily query individual window fields without JSONB operators

### Performance Optimization

With GIN indexes (see `migrations/001_add_jsonb_indexes.sql`):
- Fast queries on JSONB array elements
- Can query windows by currency: `WHERE avoid_windows @> '[{"currency": "USD"}]'`
- Efficient date lookups with existing index on `date` column

## Example: How the System Blocks Trading

**Scenario**: It's 08:15 AM NY time on 2025-11-19

1. **Current State**:
   ```json
   {
     "currency": "GBP",
     "event_name": "CPI y/y",
     "start_time": "2025-11-19T01:00:00.000-05:00",  // 01:00 AM
     "end_time": "2025-11-19T03:30:00.000-05:00",    // 03:30 AM
     "risk_score": 90,
     "is_critical": true
   }
   ```

2. **Check**: Is `08:15 AM` between `01:00 AM` and `03:30 AM`? **NO**

3. **Result**: `can_trade: true` (outside avoid window)

**Scenario 2**: It's 02:00 AM NY time

1. **Check**: Is `02:00 AM` between `01:00 AM` and `03:30 AM`? **YES**

2. **Result**: 
   ```json
   {
     "can_trade": false,
     "inside_avoid_window": true,
     "active_window": {
       "event_name": "CPI y/y",
       "currency": "GBP",
       "risk_score": 90,
       "is_critical": true,
       "reason": "High-impact inflation data release..."
     }
   }
   ```

## Schema Notes

**Important**: If you see columns like `is_critical`, `risk_score`, `reason` in the table schema, these were likely added manually and are **not used** by the system. The system stores all data in the JSONB `avoid_windows` column.

To clean up:
```sql
-- Remove unused columns (if they exist)
ALTER TABLE daily_news_windows 
DROP COLUMN IF EXISTS is_critical,
DROP COLUMN IF EXISTS risk_score,
DROP COLUMN IF EXISTS reason,
DROP COLUMN IF EXISTS detailed_description;
```

## Integration with Trading Engine

The Trading Engine calls the guardrail before placing trades:

```typescript
// services/trading-engine/src/services/GuardrailService.ts

const response = await axios.get(`${newsGuardrailUrl}/can-i-trade-now`);
if (!response.data.can_trade) {
  logger.warn(`Trade blocked: ${response.data.active_window?.reason}`);
  return; // Abort trade
}
```

## Daily Update Behavior

- **On conflict** (same date): The row is **updated** with new scan results
- This is correct behavior - each day should have only one set of windows
- The `ON CONFLICT (date) DO UPDATE` ensures data freshness

## Summary

The system knows **when NOT to trade** by:
1. ✅ Storing avoid windows with explicit `start_time` and `end_time` in JSONB
2. ✅ Loading today's windows from database
3. ✅ Checking if current time falls within any window's time range
4. ✅ Returning detailed blocking information (risk_score, reason, etc.)

The schema is **correct** - JSONB is the right choice for flexible event data.

