-- Trading Engine v7/v8 + Execution v3 Database Migrations

-- v7: Live PnL Tracking Tables

CREATE TABLE IF NOT EXISTS live_trades (
  id                BIGSERIAL PRIMARY KEY,
  mt5_ticket        BIGINT NOT NULL,
  mt5_position_id   BIGINT,
  symbol            VARCHAR(20) NOT NULL,
  strategy          VARCHAR(32),
  direction         VARCHAR(4) NOT NULL,
  volume            DOUBLE PRECISION NOT NULL,
  entry_time        TIMESTAMPTZ NOT NULL,
  exit_time         TIMESTAMPTZ NOT NULL,
  entry_price       DOUBLE PRECISION NOT NULL,
  exit_price        DOUBLE PRECISION NOT NULL,
  sl_price          DOUBLE PRECISION,
  tp_price          DOUBLE PRECISION,
  commission        DOUBLE PRECISION DEFAULT 0,
  swap              DOUBLE PRECISION DEFAULT 0,
  profit_gross      DOUBLE PRECISION NOT NULL,
  profit_net        DOUBLE PRECISION NOT NULL,
  magic_number      BIGINT,
  comment           TEXT,
  closed_reason     VARCHAR(32),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_trades_symbol_time
  ON live_trades(symbol, exit_time);

CREATE INDEX IF NOT EXISTS idx_live_trades_strategy_time
  ON live_trades(strategy, exit_time);

CREATE INDEX IF NOT EXISTS idx_live_trades_mt5_ticket
  ON live_trades(mt5_ticket);

CREATE TABLE IF NOT EXISTS live_equity (
  id                  BIGSERIAL PRIMARY KEY,
  timestamp           TIMESTAMPTZ NOT NULL,
  balance             DOUBLE PRECISION NOT NULL,
  equity              DOUBLE PRECISION NOT NULL,
  floating_pnl        DOUBLE PRECISION NOT NULL,
  closed_pnl_today    DOUBLE PRECISION NOT NULL,
  closed_pnl_week     DOUBLE PRECISION NOT NULL,
  max_drawdown_abs    DOUBLE PRECISION NOT NULL,
  max_drawdown_pct    DOUBLE PRECISION NOT NULL,
  comment             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_equity_timestamp
  ON live_equity(timestamp);

-- Execution v3: Order Events Table

CREATE TABLE IF NOT EXISTS order_events (
  id             BIGSERIAL PRIMARY KEY,
  mt5_ticket     BIGINT NOT NULL,
  position_id    BIGINT,
  symbol         VARCHAR(20) NOT NULL,
  event_type     VARCHAR(32) NOT NULL,
  direction      VARCHAR(4),
  volume         DOUBLE PRECISION,
  timestamp      TIMESTAMPTZ NOT NULL,
  entry_time     TIMESTAMPTZ,
  exit_time      TIMESTAMPTZ,
  entry_price    DOUBLE PRECISION,
  exit_price     DOUBLE PRECISION,
  sl_price       DOUBLE PRECISION,
  tp_price       DOUBLE PRECISION,
  commission     DOUBLE PRECISION,
  swap           DOUBLE PRECISION,
  profit         DOUBLE PRECISION,
  reason         VARCHAR(32),
  magic_number   BIGINT,
  comment        TEXT,
  raw            JSONB,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_ticket
  ON order_events(mt5_ticket);

CREATE INDEX IF NOT EXISTS idx_order_events_symbol_time
  ON order_events(symbol, timestamp);

CREATE INDEX IF NOT EXISTS idx_order_events_event_type
  ON order_events(event_type);

-- v8: Kill Switch Events Table

CREATE TABLE IF NOT EXISTS kill_switch_events (
  id              BIGSERIAL PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL,
  scope           VARCHAR(32) NOT NULL,
  symbol          VARCHAR(20),
  strategy        VARCHAR(32),
  active          BOOLEAN NOT NULL,
  reasons         JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kill_switch_events_timestamp
  ON kill_switch_events(timestamp);

CREATE INDEX IF NOT EXISTS idx_kill_switch_events_scope
  ON kill_switch_events(scope);

-- Extend trade_decisions table for v8 kill switch

ALTER TABLE trade_decisions
  ADD COLUMN IF NOT EXISTS kill_switch_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS kill_switch_reasons JSONB;


