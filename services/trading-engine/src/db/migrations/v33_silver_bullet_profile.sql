-- v33: Add ICT Silver Bullet strategy profile

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
  'ict_silver_bullet_v1',
  'ICT Silver Bullet',
  'A precise time-window strategy based on ICT Silver Bullet concepts. Operates during 3 specific 1-hour windows (London Open 3-4AM, NY AM 10-11AM, NY PM 2-3PM New York time). Identifies liquidity sweeps, confirms displacement, and enters on Fair Value Gap retrace with minimum 1:2 R:R targeting opposite liquidity.',
  'SILVER_BULLET_V1',
  'low',
  '{"minRiskReward": 2.0, "maxRiskPercent": 1.0, "liquidityTolerance": 0.0001, "liquidityLookback": 50, "minATRMultiplier": 1.5, "m15Candles": 100, "m1Candles": 100, "slBufferPips": 2, "windows": ["LDN_OPEN", "NY_AM", "NY_PM"], "risk_per_trade_pct": 1.0, "max_trades_per_day": 3, "symbols": ["XAUUSD", "EURUSD", "GBPUSD", "US30"]}',
  FALSE,
  TRUE
) ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  implementation_key = EXCLUDED.implementation_key,
  config = EXCLUDED.config,
  is_public = EXCLUDED.is_public;
