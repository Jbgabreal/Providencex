-- Migration: Add GIN indexes for JSONB queries on avoid_windows
-- This improves query performance when searching within JSONB arrays

-- GIN index for querying JSONB array elements efficiently
CREATE INDEX IF NOT EXISTS idx_daily_news_windows_avoid_windows_gin 
ON daily_news_windows USING GIN (avoid_windows);

-- Optional: Index for querying specific fields within JSONB
-- This allows fast queries like: WHERE avoid_windows @> '[{"currency": "USD"}]'
CREATE INDEX IF NOT EXISTS idx_daily_news_windows_currency_gin
ON daily_news_windows USING GIN ((avoid_windows::jsonb));

