-- v19: Add user-level trading config to strategy assignments
-- Allows users to override risk settings, session preferences, and loss limits

ALTER TABLE user_strategy_assignments
ADD COLUMN IF NOT EXISTS user_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- user_config schema:
-- {
--   "risk_mode": "percentage" | "usd",           -- how to size risk
--   "risk_per_trade_pct": 0.5,                   -- if mode=percentage, % of balance
--   "risk_per_trade_usd": 50,                    -- if mode=usd, fixed USD amount
--   "max_consecutive_losses": 3,                 -- cool off after N consecutive losses in a day
--   "sessions": ["asian", "london", "newyork"],  -- which sessions to trade in
-- }

COMMENT ON COLUMN user_strategy_assignments.user_config IS
  'User-level overrides for risk sizing, session preferences, and loss limits. Merged over strategy_profiles.config at execution time.';
