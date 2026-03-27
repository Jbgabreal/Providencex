-- v35: Add FVG Scalp strategy profile
INSERT INTO strategy_profiles (key, name, implementation_key, risk_tier, description, config, is_active)
VALUES (
  'fvg_scalp_v1',
  'FVG Scalp',
  'FVG_SCALP_V1',
  'low',
  'High-frequency scalping on M5 Fair Value Gap fills. Targets 4:1 R:R ($20 win / $5 risk) with 5-15 trades per day across London, NY AM, and NY PM sessions.',
  '{
    "riskRewardTarget": 4.0,
    "minFVGSizeMultiplier": 1.0,
    "maxSLPoints": 8.0,
    "minSLPoints": 2.0,
    "sessions": ["London", "NY AM", "NY PM"]
  }'::jsonb,
  true
)
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  implementation_key = EXCLUDED.implementation_key,
  description = EXCLUDED.description,
  config = EXCLUDED.config,
  is_active = EXCLUDED.is_active;
