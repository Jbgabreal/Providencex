-- Trading Engine v14: Order Flow + Smart Tape Engine
-- Creates order flow snapshot table

-- Create orderflow_snapshots table
CREATE TABLE IF NOT EXISTS orderflow_snapshots (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  delta1s DOUBLE PRECISION NOT NULL,
  delta5s DOUBLE PRECISION NOT NULL,
  delta15s DOUBLE PRECISION NOT NULL,
  delta60s DOUBLE PRECISION,
  cvd DOUBLE PRECISION NOT NULL,
  buy_pressure DOUBLE PRECISION NOT NULL,
  sell_pressure DOUBLE PRECISION NOT NULL,
  order_imbalance DOUBLE PRECISION NOT NULL,
  large_buy_orders INT NOT NULL DEFAULT 0,
  large_sell_orders INT NOT NULL DEFAULT 0,
  absorption_buy BOOLEAN NOT NULL DEFAULT false,
  absorption_sell BOOLEAN NOT NULL DEFAULT false,
  delta_momentum DOUBLE PRECISION,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_orderflow_snapshots_symbol ON orderflow_snapshots(symbol);
CREATE INDEX IF NOT EXISTS idx_orderflow_snapshots_timestamp ON orderflow_snapshots(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_orderflow_snapshots_symbol_timestamp ON orderflow_snapshots(symbol, timestamp DESC);

-- Add order flow fields to trade_decisions table (for logging)
ALTER TABLE trade_decisions
ADD COLUMN IF NOT EXISTS orderflow_snapshot JSONB,
ADD COLUMN IF NOT EXISTS orderflow_delta15s DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS orderflow_order_imbalance DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS orderflow_large_orders_against INT;

-- Create index on orderflow_delta15s for analysis
CREATE INDEX IF NOT EXISTS idx_trade_decisions_orderflow_delta15s ON trade_decisions(orderflow_delta15s) WHERE orderflow_delta15s IS NOT NULL;

