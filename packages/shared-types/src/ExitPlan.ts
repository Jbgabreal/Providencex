/**
 * Exit Plan Types (Trading Engine v9)
 * 
 * Defines interfaces for exit plan configuration per trade
 */

export type TrailMode = 'atr' | 'fixed_pips' | 'structure' | 'volatility_adaptive';

export interface ExitPlan {
  exit_plan_id?: string; // UUID
  decision_id?: number; // FK to trade_decisions
  symbol: string;
  entry_price: number;
  tp1?: number | null;
  tp2?: number | null;
  tp3?: number | null;
  stop_loss_initial: number;
  break_even_trigger?: number | null; // Profit in pips before moving SL to BE
  partial_close_percent?: number | null; // Percentage to close at TP1 (e.g., 50)
  trail_mode?: TrailMode | null;
  trail_value?: number | null; // ATR multiplier or fixed pips
  time_limit_seconds?: number | null; // Max time position can stay open
  created_at?: string; // ISO 8601
}

export interface ModifyTradeRequest {
  ticket: number;
  stop_loss?: number | null;
  take_profit?: number | null;
}

export interface PartialCloseRequest {
  ticket: number;
  volume_percent: number; // Percentage of position to close (e.g., 50 = 50%)
}


