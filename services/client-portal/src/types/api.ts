/**
 * API Type Definitions
 * 
 * Type definitions matching the backend API responses
 */

// MT5 Account Types
export interface Mt5Account {
  id: string;
  user_id: string;
  label: string | null;
  account_number: string;
  server: string;
  is_demo: boolean;
  status: 'connected' | 'paused' | 'disconnected';
  connection_meta: any | null;
  created_at: string;
  updated_at: string;
  disconnected_at: string | null;
}

export interface CreateMt5AccountRequest {
  account_number: string;
  server: string;
  is_demo: boolean;
  label?: string;
  connection_meta?: {
    baseUrl?: string;
    [key: string]: any;
  };
}

// Strategy Types
export interface Strategy {
  key: string;
  name: string;
  description: string | null;
  risk_tier: 'low' | 'medium' | 'high';
  is_frozen: boolean;
  is_available: boolean;
  performance: StrategyPerformance;
}

export interface StrategyPerformance {
  total_users: number;
  total_trades: number;
  closed_trades: number;
  win_rate: number;
  profit_factor: number;
  total_pnl: number;
  avg_daily_return: number;
  max_drawdown_percent: number;
  average_win: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  average_r: number;
  last_30_days_return?: number;
  last_7_days_return?: number;
}

// User Trading Config
export interface UserTradingConfig {
  risk_mode?: 'percentage' | 'usd';
  risk_per_trade_pct?: number;
  risk_per_trade_usd?: number;
  max_consecutive_losses?: number;
  sessions?: Array<'asian' | 'london' | 'newyork'>;
}

// Strategy Assignment Types
export interface StrategyAssignment {
  id: string;
  user_id: string;
  mt5_account_id: string;
  strategy_profile_id: string;
  status: 'active' | 'paused' | 'stopped';
  user_config: UserTradingConfig;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateStrategyAssignmentRequest {
  mt5_account_id: string;
  strategy_profile_key: string;
}

// Analytics Types
export interface Trade {
  id: string;
  user_id: string;
  mt5_account_id: string;
  strategy_profile_id: string;
  assignment_id: string | null;
  mt5_ticket: number;
  mt5_order_id: number | null;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lot_size: number;
  entry_price: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  exit_price: number | null;
  closed_at: string | null;
  profit: number | null;
  commission: number | null;
  swap: number | null;
  opened_at: string;
  entry_reason: string | null;
  exit_reason: string | null;
  metadata: Record<string, any>;
}

export interface OpenPosition {
  id: string;
  user_id: string;
  mt5_account_id: string;
  strategy_profile_id: string;
  assignment_id: string | null;
  mt5_ticket: number;
  mt5_order_id: number | null;
  symbol: string;
  direction: 'BUY' | 'SELL';
  lot_size: number;
  entry_price: number;
  stop_loss_price: number | null;
  take_profit_price: number | null;
  opened_at: string;
  entry_reason: string | null;
  metadata: Record<string, any>;
}

export interface AnalyticsSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageR: number;
  totalWins: number;
  totalLosses: number;
}

export interface EquityCurvePoint {
  date: string;
  equity: number;
  balance: number;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StrategiesResponse {
  success: boolean;
  strategies: Strategy[];
}

export interface Mt5AccountsResponse {
  success: boolean;
  accounts: Mt5Account[];
}

export interface StrategyAssignmentsResponse {
  success: boolean;
  assignments: StrategyAssignment[];
}

export interface TradesResponse {
  success: boolean;
  trades: Trade[];
  total: number;
}

export interface OpenPositionsResponse {
  success: boolean;
  positions: OpenPosition[];
}

export interface AnalyticsSummaryResponse {
  success: boolean;
  summary: AnalyticsSummary;
}

export interface EquityCurveResponse {
  success: boolean;
  curve: EquityCurvePoint[];
}

