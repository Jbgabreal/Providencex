-- News Guardrail Database Schema

CREATE TABLE IF NOT EXISTS daily_news_windows (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  avoid_windows JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_news_windows_date ON daily_news_windows(date);

