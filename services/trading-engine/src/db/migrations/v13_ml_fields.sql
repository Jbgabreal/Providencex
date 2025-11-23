-- Trading Engine v13: ML Alpha + Regime Detection Layer
-- Adds ML fields to existing tables

-- Add ML fields to trade_decisions table
ALTER TABLE trade_decisions
ADD COLUMN IF NOT EXISTS ml_pass BOOLEAN,
ADD COLUMN IF NOT EXISTS ml_score JSONB,
ADD COLUMN IF NOT EXISTS ml_reasons JSONB,
ADD COLUMN IF NOT EXISTS regime VARCHAR(32),
ADD COLUMN IF NOT EXISTS features JSONB;

-- Add index on regime for faster filtering
CREATE INDEX IF NOT EXISTS idx_trade_decisions_regime ON trade_decisions(regime);

-- Add index on ml_pass for ML-filtered trades analysis
CREATE INDEX IF NOT EXISTS idx_trade_decisions_ml_pass ON trade_decisions(ml_pass) WHERE ml_pass IS NOT NULL;

-- GIN index on ml_score for JSONB queries
CREATE INDEX IF NOT EXISTS idx_trade_decisions_ml_score_gin ON trade_decisions USING GIN (ml_score) WHERE ml_score IS NOT NULL;

-- Add ML fields to live_trades table (for tracking ML predictions on open trades)
ALTER TABLE live_trades
ADD COLUMN IF NOT EXISTS ml_score JSONB,
ADD COLUMN IF NOT EXISTS regime VARCHAR(32);

-- Add index on regime in live_trades
CREATE INDEX IF NOT EXISTS idx_live_trades_regime ON live_trades(regime) WHERE regime IS NOT NULL;

