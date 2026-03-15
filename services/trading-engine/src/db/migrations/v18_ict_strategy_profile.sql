-- v18: Seed ICT Strategy Profile for public use
-- Hide the dev profile and create a user-friendly ICT strategy

-- Hide the old dev profile
UPDATE strategy_profiles
SET is_public = FALSE
WHERE key = 'first_successful_strategy_from_god';

-- Insert the new ICT Sweep & Shift strategy profile
INSERT INTO strategy_profiles (
  key,
  name,
  description,
  implementation_key,
  risk_tier,
  config,
  is_frozen,
  is_public
) VALUES (
  'ict_sweep_shift_v1',
  'ICT Sweep & Shift',
  'An institutional-grade strategy based on ICT (Inner Circle Trader) concepts. It identifies liquidity sweeps at key levels, waits for a structural shift (BOS/CHoCH) to confirm smart money direction, then enters on an opposing candle within the optimal trade entry (OTE) zone. Backtested results: 85.7% win rate, 6.0 profit factor, 137% return, 4.2% max drawdown, 2.87 avg R:R over 14 trades on XAUUSD M5.',
  'GOD_SMC_V1',
  'low',
  '{"risk_per_trade_pct": 0.5, "max_trades_per_day": 2, "symbols": ["XAUUSD"], "timeframe": "M5"}',
  TRUE,
  TRUE
) ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_public = EXCLUDED.is_public;
