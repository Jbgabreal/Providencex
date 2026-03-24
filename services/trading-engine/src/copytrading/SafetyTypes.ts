/**
 * Safety Settings Types — Phase 4 follower safety controls.
 */

export interface SafetySettings {
  max_daily_loss_usd?: number;           // max loss per day from this mentor
  max_concurrent_trades?: number;        // max open copied trades at once
  slippage_tolerance_pct?: number;       // max % price drift from signal entry
  late_entry_seconds?: number;           // max seconds after signal publish
  copy_market_orders?: boolean;          // allow market order signals
  copy_pending_orders?: boolean;         // allow limit/stop order signals
  sync_breakeven?: boolean;              // sync breakeven updates from mentor
  sync_close_all?: boolean;              // sync close-all updates from mentor
  auto_disable_on_daily_loss?: boolean;  // auto-disable when daily loss breached
  max_lot_size?: number;                 // optional max lot guard
  allowed_sessions?: string[];           // e.g. ['london', 'new_york']
}

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  max_daily_loss_usd: undefined,
  max_concurrent_trades: undefined,
  slippage_tolerance_pct: undefined,
  late_entry_seconds: undefined,
  copy_market_orders: true,
  copy_pending_orders: true,
  sync_breakeven: true,
  sync_close_all: true,
  auto_disable_on_daily_loss: false,
  max_lot_size: undefined,
  allowed_sessions: undefined,
};

export type BlockReason =
  | 'daily_loss_breached'
  | 'max_concurrent_trades'
  | 'symbol_blocked'
  | 'symbol_not_allowed'
  | 'late_entry'
  | 'slippage_exceeded'
  | 'order_type_disabled'
  | 'auto_disabled'
  | 'max_lot_exceeded'
  | 'session_not_allowed'
  | 'subscription_paused'
  | 'entitlement_missing';

export type GuardrailType =
  | 'daily_loss'
  | 'concurrent_trades'
  | 'symbol_filter'
  | 'timing'
  | 'order_type'
  | 'auto_disable'
  | 'lot_limit'
  | 'session'
  | 'status'
  | 'entitlement';

export interface GuardrailCheckResult {
  allowed: boolean;
  blockReason?: BlockReason;
  guardrailType?: GuardrailType;
  thresholdValue?: string;
  actualValue?: string;
}

export interface CopiedTradeEvent {
  id: string;
  copied_trade_id: string;
  follower_subscription_id: string;
  mentor_signal_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface BlockedCopyAttempt {
  id: string;
  follower_subscription_id: string;
  mentor_signal_id: string;
  user_id: string;
  block_reason: BlockReason;
  guardrail_type: GuardrailType;
  threshold_value: string | null;
  actual_value: string | null;
  signal_symbol: string | null;
  signal_direction: string | null;
  signal_entry_price: number | null;
  created_at: string;
}

export interface SubscriptionGuardrailEvent {
  id: string;
  follower_subscription_id: string;
  user_id: string;
  event_type: 'auto_disabled' | 're_enabled' | 'guardrail_warning';
  reason: string;
  threshold_value: string | null;
  actual_value: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
