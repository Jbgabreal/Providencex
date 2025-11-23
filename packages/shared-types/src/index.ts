// News Guardrail Types
export interface NewsWindow {
  start_time: string; // ISO 8601 in NY timezone
  end_time: string; // ISO 8601 in NY timezone
  currency: 'USD' | 'EUR' | 'GBP';
  impact: 'high' | 'medium' | 'low';
  event_name: string;
  is_critical: boolean;
  risk_score: number; // 0-100
  reason: string;
  detailed_description: string;
}

export interface DailyNewsMap {
  id?: number;
  date: string; // YYYY-MM-DD in NY timezone
  avoid_windows: NewsWindow[];
  created_at?: string;
  updated_at?: string;
}

export interface CanTradeResponse {
  can_trade: boolean;
  inside_avoid_window: boolean;
  active_window?: NewsWindow | null;
}

// Trading Engine Types
export type TradeDirection = 'BUY' | 'SELL';
export type EntryType = 'MARKET' | 'LIMIT' | 'STOP';
export type OrderKind = 'market' | 'limit' | 'stop';
export type TradeStatus = 'PENDING' | 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface TradeRequest {
  symbol: string; // e.g., 'XAUUSD', 'EURUSD'
  direction: TradeDirection;
  entry_type?: EntryType; // Legacy field, use order_kind instead
  order_kind: OrderKind; // Market, limit, or stop order
  entry_price?: number; // For LIMIT/STOP orders (required for pending orders)
  risk_percent?: number; // Risk as % of account
  lot_size?: number; // Direct lot size (alternative to risk_percent)
  stop_loss_price: number;
  take_profit_price: number;
  strategy_id: string; // e.g., 'smc_v1'
  metadata?: Record<string, any>;
}

export interface TradeResponse {
  mt5_ticket: string;
  status: TradeStatus;
  symbol: string;
  direction: TradeDirection;
  lot_size: number;
  entry_price: number;
  stop_loss_price: number;
  take_profit_price: number;
  opened_at: string;
}

export type StrategyId = 'smc_v1' | 'order_block_v1';

export interface RiskSettings {
  max_daily_loss_percent: number;
  max_daily_trades: number;
  risk_per_trade_percent: number;
  max_open_positions: number;
}

// Portfolio Engine Types (future)
export type ProductType = 'TRADING' | 'FARMING' | 'MIXED';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Product {
  id: string;
  name: string;
  type: ProductType;
  risk_level: RiskLevel;
  lock_period_days: number;
  min_amount: number;
  strategy_hooks?: string[];
}

export interface UserPosition {
  id: string;
  user_id: string;
  product_id: string;
  amount: number;
  opened_at: string;
  closed_at?: string;
}

// Trading Engine v7/v8 + Execution v3 Types

export type OrderEventType = 
  | 'order_sent'
  | 'order_rejected'
  | 'position_opened'
  | 'position_modified'
  | 'position_closed'
  | 'sl_hit'
  | 'tp_hit'
  | 'partial_close'
  | 'break_even_set'
  | 'sl_modified'
  | 'tp_modified'
  | 'trail_sl_move'
  | 'auto_exit'
  | 'auto_exit_structure_break'
  | 'commission_exit'
  | 'time_exit'
  | 'kill_switch_forced_exit'
  | 'error';

export type ClosedReason = 'tp' | 'sl' | 'manual' | 'partial' | 'breakeven' | 'unknown';

export interface OrderEvent {
  source: 'mt5-connector';
  event_type: OrderEventType;
  timestamp: string; // ISO 8601
  ticket: number;
  position_id?: number;
  symbol: string;
  direction?: 'buy' | 'sell';
  volume?: number;
  entry_time?: string; // ISO 8601
  exit_time?: string; // ISO 8601
  entry_price?: number;
  exit_price?: number;
  sl_price?: number;
  tp_price?: number;
  commission?: number;
  swap?: number;
  profit?: number;
  reason?: ClosedReason;
  comment?: string;
  magic_number?: number;
  raw?: Record<string, any>;
}

export interface LiveTrade {
  id?: number;
  mt5_ticket: number;
  mt5_position_id?: number;
  symbol: string;
  strategy?: string;
  direction: 'buy' | 'sell';
  volume: number;
  entry_time: string; // ISO 8601
  exit_time: string; // ISO 8601
  entry_price: number;
  exit_price: number;
  sl_price?: number;
  tp_price?: number;
  commission?: number;
  swap?: number;
  profit_gross: number;
  profit_net: number;
  magic_number?: number;
  comment?: string;
  closed_reason?: ClosedReason;
  created_at?: string;
}

export interface LiveEquity {
  id?: number;
  timestamp: string; // ISO 8601
  balance: number;
  equity: number;
  floating_pnl: number;
  closed_pnl_today: number;
  closed_pnl_week: number;
  max_drawdown_abs: number;
  max_drawdown_pct: number;
  comment?: string;
  created_at?: string;
}

export interface KillSwitchEvent {
  id?: number;
  timestamp: string; // ISO 8601
  scope: 'global' | 'symbol' | 'strategy';
  symbol?: string;
  strategy?: string;
  active: boolean;
  reasons: string[];
  created_at?: string;
}

export interface AccountSummary {
  success: boolean;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  margin_level: number;
  currency: string;
  error?: string;
}

// Trading Engine v9 - Exit Plan Types
export * from './ExitPlan';

// Trading Engine v10 - Enhanced Raw Signal V2 Types
export * from './EnhancedRawSignalV2';

// Common Types
export type UserId = string;
export type ProductId = string;

