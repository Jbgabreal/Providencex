/**
 * Admin Dashboard Types
 * 
 * TypeScript interfaces matching Trading Engine Admin API responses
 */

export interface AdminDecision {
  id: number;
  createdAt: string;
  symbol: string;
  strategy: string;
  decision: 'trade' | 'skip';
  direction: 'buy' | 'sell' | null;
  guardrailMode: string | null;
  guardrailReason: string | null;
  riskReason: string | null;
  signalReason: string | null;
  executionFilterAction: string | null;
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
}

export interface AdminDecisionsResponse {
  data: AdminDecision[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface DailyMetricsResponse {
  date: string;
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
  lastUpdated: string;
}

export interface ExposureSymbol {
  symbol: string;
  longCount: number;
  shortCount: number;
  totalCount: number;
  estimatedRiskAmount: number;
  lastUpdated: string;
}

export interface ExposureStatusResponse {
  success: boolean;
  symbols: ExposureSymbol[];
  global: {
    totalOpenTrades: number;
    totalEstimatedRiskAmount: number;
    lastUpdated: string | null;
  };
}

export interface BacktestRunSummary {
  id: number;
  runId: string;
  symbol: string;
  strategy: string;
  fromDate: string;
  toDate: string;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  totalPnL: number;
  totalReturnPercent: number;
  createdAt: string;
}

export interface BacktestRunsResponse {
  data: BacktestRunSummary[];
  pagination?: {
    limit: number;
    offset: number;
    total?: number;
  };
}


