-- v22: Mentor profile public metadata for marketplace/discovery
-- Adds trading style tags, markets, verification status

ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS trading_style TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS markets_traded TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE mentor_profiles ADD COLUMN IF NOT EXISTS profile_image_url TEXT;

COMMENT ON COLUMN mentor_profiles.trading_style IS 'Tags: scalper, swing, day_trader, position, etc.';
COMMENT ON COLUMN mentor_profiles.markets_traded IS 'Symbols: XAUUSD, EURUSD, etc.';
COMMENT ON COLUMN mentor_profiles.is_verified IS 'Platform-verified performance';
COMMENT ON COLUMN mentor_profiles.is_featured IS 'Admin-featured on marketplace';
