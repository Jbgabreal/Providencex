/**
 * Trade Journal Types
 *
 * Foundation for multi-strategy trade journaling.
 * Every trade and signal attempt gets recorded with full setup context.
 */

export interface TradeJournalEntry {
  id?: string;
  tradeDecisionId?: number;
  executedTradeId?: string;

  // Strategy identification
  strategyKey: string;           // e.g. 'GOD_SMC_V1', 'SILVER_BULLET_V1'
  strategyVersion?: string;
  strategyProfileKey?: string;

  // Trade data
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  lotSize?: number;
  riskPercent?: number;
  rrTarget?: number;

  // Lifecycle
  status: 'signal' | 'open' | 'closed' | 'cancelled';
  openedAt?: Date;
  closedAt?: Date;

  // Result (populated on close)
  exitPrice?: number;
  profit?: number;
  rMultiple?: number;            // Actual R achieved
  result?: 'win' | 'loss' | 'breakeven';
  closeReason?: string;          // 'tp_hit' | 'sl_hit' | 'manual' | 'timeout' | 'trailing_sl'

  // Strategy context (JSONB — each strategy stores its own data)
  setupContext: Record<string, any>;   // Market analysis: bias, sweep levels, FVG zones, session
  entryContext: Record<string, any>;   // Entry details: OB level, FVG boundary, confirmation type
  exitContext: Record<string, any>;    // Exit details: reason, trailing SL level, partial close

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export interface JournalFilters {
  strategyKey?: string;
  symbol?: string;
  direction?: 'buy' | 'sell';
  status?: string;
  excludeStatus?: string;
  result?: 'win' | 'loss' | 'breakeven';
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface JournalSummary {
  totalSignals: number;
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRMultiple: number;
  totalProfit: number;
  byStrategy: Record<string, StrategyStats>;
}

export interface StrategyStats {
  strategyKey: string;
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgRMultiple: number;
  totalProfit: number;
  avgProfit: number;
  bestTrade: number;
  worstTrade: number;
}
