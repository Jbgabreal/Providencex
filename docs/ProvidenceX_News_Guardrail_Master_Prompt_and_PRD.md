# ProvidenceX News Guardrail — Master Prompt & PRD

> **Service:** `news-guardrail`  
> **Purpose:** Daily news risk scanner to prevent trading during high-impact news events

## Overview

The News Guardrail service scans ForexFactory's economic calendar daily and identifies high/medium impact news events for USD, EUR, and GBP. It builds "avoid windows" (time periods when trading should be paused) and exposes endpoints to check if trading is currently safe.

## Core Functionality

### Daily News Scan (Cron Job)

- **Schedule:** Once per trading day at 08:00 America/New_York
- **Process:**
  1. Capture ForexFactory calendar screenshot using ScreenshotOne API
  2. Send screenshot to OpenAI Vision API for analysis
  3. Extract high/medium impact news events for USD/EUR/GBP
  4. Build `avoid_windows[]` array with start/end times in NY timezone
  5. Store result in `daily_news_windows` table

### Real-time Trading Check

- **Endpoint:** `GET /can-i-trade-now`
- **Returns:** `{ can_trade: boolean, inside_avoid_window: boolean, active_window?: NewsWindow }`
- **Logic:** Check current time against today's avoid windows

## Database Schema

### Table: `daily_news_windows`

```sql
CREATE TABLE daily_news_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE, -- YYYY-MM-DD in NY timezone
  avoid_windows JSONB NOT NULL, -- Array of NewsWindow objects
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_daily_news_windows_date ON daily_news_windows(date);
```

## API Endpoints

### `GET /news-map/today`

Returns today's `DailyNewsMap` object.

**Response:**
```json
{
  "id": 1,
  "date": "2024-01-15",
  "avoid_windows": [
    {
      "start_time": "2024-01-15T08:30:00-05:00",
      "end_time": "2024-01-15T09:00:00-05:00",
      "currency": "USD",
      "impact": "high",
      "event_name": "CPI Release"
    }
  ],
  "created_at": "2024-01-15T08:05:00Z",
  "updated_at": "2024-01-15T08:05:00Z"
}
```

### `GET /can-i-trade-now`

Returns whether trading is currently safe.

**Response:**
```json
{
  "can_trade": false,
  "inside_avoid_window": true,
  "active_window": {
    "start_time": "2024-01-15T08:30:00-05:00",
    "end_time": "2024-01-15T09:00:00-05:00",
    "currency": "USD",
    "impact": "high",
    "event_name": "CPI Release"
  }
}
```

### `POST /admin/trigger-scan` (Development)

Manually trigger the news scan (for testing).

## OpenAI Vision Prompt

When sending the screenshot to OpenAI, use this prompt:

```
Analyze this ForexFactory economic calendar screenshot. Identify all high and medium impact news events for USD, EUR, and GBP currencies today.

For each event, extract:
- Event name
- Currency (USD, EUR, or GBP)
- Impact level (high or medium)
- Time (convert to America/New_York timezone)

Return a JSON array of objects with this structure:
[
  {
    "event_name": "CPI Release",
    "currency": "USD",
    "impact": "high",
    "time": "08:30" // 24-hour format in NY timezone
  }
]

Only include events with high or medium impact. Ignore low impact events.
For each event, create an avoid window from 30 minutes before to 30 minutes after the event time.
```

## Implementation Notes

- Use `node-cron` or similar for scheduling
- Store avoid windows as JSONB in Postgres
- Use `luxon` for timezone handling (via shared-utils)
- ScreenshotOne URL: `https://api.screenshotone.com/take?access_key={key}&url=https://www.forexfactory.com/calendar`
- OpenAI Vision model: `gpt-4-vision-preview` or `gpt-4o`
- Error handling: If scan fails, log error but don't block the service

## Environment Variables

- `DATABASE_URL` - Postgres connection string
- `OPENAI_API_KEY` - OpenAI API key
- `SCREENSHOTONE_ACCESS_KEY` - ScreenshotOne API key
- `NEWS_GUARDRAIL_PORT` - Service port (default: 3010)
- `PX_TIMEZONE` - Timezone (default: America/New_York)
- `NEWS_GUARDRAIL_CRON_SCHEDULE` - Optional cron override (default: "0 8 * * 1-5")

