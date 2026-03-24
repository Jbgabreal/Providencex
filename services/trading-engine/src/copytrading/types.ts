/**
 * Copy Trading Domain Types
 */

export interface MentorProfile {
  id: string;
  user_id: string;
  display_name: string;
  bio: string | null;
  trading_style: string[];
  markets_traded: string[];
  is_active: boolean;
  is_approved: boolean;
  is_verified: boolean;
  is_featured: boolean;
  profile_image_url: string | null;
  total_followers: number;
  featured_order: number;
  avg_rating: number;
  review_count: number;
  created_at: string;
  updated_at: string;
}

export interface MentorSignal {
  id: string;
  mentor_profile_id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  order_kind: 'market' | 'limit' | 'stop';
  entry_price: number;
  stop_loss: number;
  tp1: number | null;
  tp2: number | null;
  tp3: number | null;
  tp4: number | null;
  status: 'active' | 'partially_closed' | 'closed' | 'cancelled';
  notes: string | null;
  idempotency_key: string;
  published_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SignalUpdateType = 'move_sl' | 'breakeven' | 'partial_close' | 'close_all' | 'cancel' | 'modify_tp';

export interface MentorSignalUpdate {
  id: string;
  mentor_signal_id: string;
  update_type: SignalUpdateType;
  new_sl: number | null;
  close_tp_level: number | null;
  new_tp_value: number | null;
  notes: string | null;
  idempotency_key: string;
  propagation_status: 'pending' | 'propagating' | 'completed' | 'failed';
  propagated_count: number;
  failed_count: number;
  created_at: string;
}

export type SubscriptionMode = 'auto_trade' | 'view_only' | 'shadow';
export type RiskMode = 'percentage' | 'usd' | 'fixed_lot';
export type SubscriptionStatus = 'active' | 'paused' | 'stopped';

export interface FollowerSubscription {
  id: string;
  user_id: string;
  mentor_profile_id: string;
  mt5_account_id: string;
  mode: SubscriptionMode;
  risk_mode: RiskMode;
  risk_amount: number;
  selected_tp_levels: number[];
  selected_symbols: string[];  // empty = copy all pairs, otherwise filter
  status: SubscriptionStatus;
  created_at: string;
  updated_at: string;
}

export type CopiedTradeStatus = 'pending' | 'executing' | 'open' | 'closed' | 'failed' | 'cancelled';

export interface CopiedTrade {
  id: string;
  follower_subscription_id: string;
  mentor_signal_id: string;
  tp_level: number;
  user_id: string;
  mt5_account_id: string;
  mt5_ticket: number | null;
  broker_type: string;
  lot_size: number | null;
  entry_price: number | null;
  stop_loss: number;
  take_profit: number | null;
  status: CopiedTradeStatus;
  exit_price: number | null;
  profit: number | null;
  closed_at: string | null;
  close_reason: string | null;
  error_message: string | null;
  executed_trade_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FanoutSummary {
  total_subscribers: number;
  trades_created: number;
  trades_failed: number;
}

export interface PropagationSummary {
  total_trades: number;
  propagated: number;
  failed: number;
}
