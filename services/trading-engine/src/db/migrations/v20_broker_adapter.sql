-- v20: Hybrid broker adapter support
-- Adds broker_type and broker_credentials to mt5_accounts (table name kept for backward compat)

ALTER TABLE mt5_accounts ADD COLUMN IF NOT EXISTS broker_type TEXT NOT NULL DEFAULT 'mt5';
ALTER TABLE mt5_accounts ADD COLUMN IF NOT EXISTS broker_credentials JSONB;

-- Backfill: existing MT5 accounts get credentials from connection_meta
UPDATE mt5_accounts
SET broker_credentials = COALESCE(connection_meta, '{}'::jsonb)
WHERE broker_type = 'mt5' AND broker_credentials IS NULL;

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_broker_type ON mt5_accounts(broker_type);

COMMENT ON COLUMN mt5_accounts.broker_type IS 'Broker integration type: mt5, deriv';
COMMENT ON COLUMN mt5_accounts.broker_credentials IS 'Broker-specific auth (MT5: baseUrl/login, Deriv: appId/apiToken)';
