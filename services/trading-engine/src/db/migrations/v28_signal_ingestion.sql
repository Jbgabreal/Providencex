-- v28: External Signal Ingestion — Telegram sources, raw messages, parsed candidates
-- Phase 7 of ProvidenceX

-- ==================== Import Sources ====================
-- Each mentor can connect one or more external signal sources.
CREATE TABLE IF NOT EXISTS import_signal_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,

  source_type TEXT NOT NULL CHECK (source_type IN ('telegram', 'discord', 'webhook')),
  source_name TEXT NOT NULL,               -- display name (e.g. "Gold Signals VIP")
  source_identifier TEXT NOT NULL,         -- e.g. Telegram chat_id, Discord channel_id, webhook_id

  config JSONB DEFAULT '{}'::jsonb,        -- source-specific config (bot token ref, etc.)
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(mentor_profile_id, source_type, source_identifier)
);

CREATE INDEX IF NOT EXISTS idx_import_sources_mentor ON import_signal_sources(mentor_profile_id);

-- ==================== Imported Messages ====================
-- Raw messages from external sources, stored for audit and re-parsing.
CREATE TABLE IF NOT EXISTS imported_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES import_signal_sources(id) ON DELETE CASCADE,
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,

  external_message_id TEXT,                -- Telegram message_id, etc.
  raw_text TEXT NOT NULL,
  raw_payload JSONB DEFAULT '{}'::jsonb,   -- full raw message object
  sender_name TEXT,
  sender_id TEXT,
  message_timestamp TIMESTAMPTZ,           -- original message time

  parse_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'no_signal', 'error')),
  parse_confidence NUMERIC(5,2),           -- 0-100 confidence score

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(source_id, external_message_id)   -- prevent duplicate imports
);

CREATE INDEX IF NOT EXISTS idx_imported_msgs_source ON imported_messages(source_id);
CREATE INDEX IF NOT EXISTS idx_imported_msgs_mentor ON imported_messages(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_imported_msgs_status ON imported_messages(parse_status);

-- ==================== Imported Signal Candidates ====================
-- Parsed signal candidates from imported messages. Mentor reviews before publishing.
CREATE TABLE IF NOT EXISTS imported_signal_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_message_id UUID NOT NULL REFERENCES imported_messages(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES import_signal_sources(id) ON DELETE CASCADE,
  mentor_profile_id UUID NOT NULL REFERENCES mentor_profiles(id) ON DELETE CASCADE,

  -- Classification
  candidate_type TEXT NOT NULL DEFAULT 'new_signal'
    CHECK (candidate_type IN ('new_signal', 'signal_update')),

  -- Parsed signal fields (for new_signal)
  parsed_symbol TEXT,
  parsed_direction TEXT,                   -- 'BUY' | 'SELL'
  parsed_order_kind TEXT DEFAULT 'market', -- 'market' | 'limit' | 'stop'
  parsed_entry_price NUMERIC,
  parsed_stop_loss NUMERIC,
  parsed_tp1 NUMERIC,
  parsed_tp2 NUMERIC,
  parsed_tp3 NUMERIC,
  parsed_tp4 NUMERIC,
  parsed_notes TEXT,

  -- Parsed update fields (for signal_update)
  parsed_update_type TEXT,                 -- 'move_sl', 'breakeven', 'partial_close', 'close_all', 'cancel'
  parsed_new_sl NUMERIC,
  parsed_close_tp_level INTEGER,
  linked_signal_id UUID REFERENCES mentor_signals(id),  -- which signal this update applies to

  -- Parsing metadata
  parse_confidence NUMERIC(5,2),
  raw_parsed_fields JSONB DEFAULT '{}'::jsonb,

  -- Review state
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'edited')),
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,

  -- Published linkage
  published_signal_id UUID REFERENCES mentor_signals(id),
  published_signal_update_id UUID REFERENCES mentor_signal_updates(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_candidates_mentor ON imported_signal_candidates(mentor_profile_id);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON imported_signal_candidates(review_status);
CREATE INDEX IF NOT EXISTS idx_candidates_message ON imported_signal_candidates(imported_message_id);
