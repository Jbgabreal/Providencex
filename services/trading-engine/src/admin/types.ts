/**
 * Admin Dashboard API Types
 * 
 * Defines TypeScript interfaces for admin API responses
 */

/**
 * Admin Decision - represents a trade decision from trade_decisions table
 */
export interface AdminDecision {
  id: number;
  createdAt: string; // ISO 8601
  symbol: string;
  strategy: string; // 'low' | 'high'
  decision: 'trade' | 'skip';
  direction: 'buy' | 'sell' | null;
  guardrailMode: string | null;
  guardrailReason: string | null;
  riskReason: string | null;
  signalReason: string | null;
  executionFilterAction: string | null; // 'pass' | 'skip' | null
  executionFilterReasons: string[] | null;
  entryPrice: number | null;
  sl: number | null;
  tp: number | null;
  lotSize: number | null;
  executionResult: {
    success: boolean;
    ticket?: string | number;
    error?: string;
  } | null;
  killSwitchActive: boolean | null; // v8 kill switch state
  killSwitchReasons: string[] | null; // v8 kill switch reasons
}

/**
 * Admin Decisions Response
 */
export interface AdminDecisionsResponse {
  data: AdminDecision[];
  pagination: {
    limit: number;
    offset: number;
    total?: number; // Optional total count for UI pagination
  };
}

/**
 * Daily Metrics Response
 */
export interface DailyMetricsResponse {
  date: string; // YYYY-MM-DD
  totalDecisions: number;
  totalTrades: number;
  totalSkips: number;
  tradesBySymbol: Record<string, {
    trades: number;
    skips: number;
  }>;
  tradesByStrategy: Record<string, {
    trades: number;
    skips: number;
  }>;
  topSkipReasons: Array<{
    reason: string;
    count: number;
  }>;
  lastUpdated: string; // ISO 8601
}

/**
 * Symbol Exposure - per-symbol exposure snapshot
 */
export interface SymbolExposure {
  symbol: string;
  longPositions: number;
  shortPositions: number;
  estimatedRiskLong: number;
  estimatedRiskShort: number;
  totalEstimatedRisk: number;
  lastUpdated: string; // ISO 8601
}

/**
 * Exposure Status Response (matches v4 endpoint format)
 */
export interface ExposureStatusResponse {
  success: boolean;
  symbols: Array<{
    symbol: string;
    longCount: number;
    shortCount: number;
    totalCount: number;
    estimatedRiskAmount: number;
    lastUpdated: string;
  }>;
  global: {
    totalOpenTrades: number;
    totalEstimatedRiskAmount: number;
    lastUpdated: string | null;
  };
}

/**
 * Backtest Run Summary
 */
export interface BacktestRunSummary {
  id: number;
  runId: string;
  symbol: string;
  strategy: string;
  fromDate: string; // ISO date string
  toDate: string; // ISO date string
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  totalPnL: number;
  totalReturnPercent: number;
  createdAt: string; // ISO 8601
}

/**
 * Backtest Runs Response
 */
export interface BacktestRunsResponse {
  data: BacktestRunSummary[];
  pagination?: {
    limit: number;
    offset: number;
    total?: number;
  };
}

