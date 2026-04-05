-- Add TradingView OB Signal strategy profile
INSERT INTO strategy_profiles (key, name, description, risk_tier, implementation_key, config, is_public, is_frozen, created_at, updated_at)
VALUES (
  'tradingview_signal_v1',
  'TradingView OB Signal',
  'Trades OB zone entries from TradingView indicators. Signals fire via webhook when price enters a bullish/bearish Order Block zone. Works on XAUUSD (Gold Scalper) and BTCUSD (MSB-OB v3 zones). Supports all sessions including Asian.',
  'low',
  'TV_SIGNAL_V1',
  '{"allowedSymbols": ["XAUUSD", "BTCUSD", "EURUSD", "GBPUSD"], "obIndicatorFilter": "", "biasIndicatorFilter": "", "entryIndicatorFilter": "", "minRR": 1.5, "slBuffer": 0, "defaultSlPips": 30}',
  TRUE,
  FALSE,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  config = EXCLUDED.config,
  is_public = EXCLUDED.is_public,
  updated_at = NOW();
