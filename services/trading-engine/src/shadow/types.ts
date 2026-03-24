/**
 * Shadow / Simulation Mode Types — Phase 8
 */

export type SimulatedTradeStatus = 'open' | 'closed' | 'cancelled';

export interface SimulatedTrade {
  id: string;
  follower_subscription_id: string;
  mentor_signal_id: string;
  tp_level: number;
  user_id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  order_kind: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number | null;
  lot_size: number;
  status: SimulatedTradeStatus;
  exit_price: number | null;
  simulated_pnl: number | null;
  close_reason: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimulatedTradeEvent {
  id: string;
  simulated_trade_id: string;
  follower_subscription_id: string;
  mentor_signal_id: string;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface ShadowSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnl: number;
  winRate: number;
  avgPnl: number;
  bestTrade: number;
  worstTrade: number;
}
