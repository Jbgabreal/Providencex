/**
 * Trading Engine v5 - Backtesting Types
 * 
 * Defines types for the backtesting and simulation framework
 */

/**
 * Historical candle format for backtesting
 */
export interface HistoricalCandle {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // epoch millis
}

/**
 * Simulated position in backtesting
 */
export interface SimulatedPosition {
  ticket: number;
  symbol: string;
  volume: number;
  entryPrice: number;
  sl: number | null;
  tp: number | null;
  direction: 'buy' | 'sell';
  openTime: number; // epoch millis
  closeTime?: number; // epoch millis
  closePrice?: number;
  profit?: number; // PnL in account currency
}

/**
 * Backtest configuration
 */
export interface BacktestConfig {
  symbol: string | string[]; // Single or multiple symbols
  strategies: ('low' | 'high')[]; // Strategies to test
  startDate: string; // ISO date string: '2024-01-01'
  endDate: string; // ISO date string: '2024-12-31'
  timeframe?: string; // Default: 'M5'
  initialBalance: number; // Starting account balance
  riskPerTradePercent?: number; // Risk per trade (overrides strategy default)
  spreadPips?: number; // Simulated spread in pips
  slippagePips?: number; // Simulated slippage in pips
  dataSource?: 'csv' | 'postgres' | 'mt5' | 'mock'; // Where to load candles from
  csvPath?: string; // Path to CSV file if dataSource === 'csv'
  // v3 filter overrides (optional)
  executionFilterOverrides?: Record<string, any>;
  // v4 exposure overrides (optional)
  exposureOverrides?: {
    maxConcurrentTradesPerSymbol?: number;
    maxConcurrentTradesGlobal?: number;
    maxDailyRiskPerSymbol?: number;
    maxDailyRiskGlobal?: number;
  };
  // v11 SMC v2 parameter overrides (optional)
  overrideParamSet?: import('../optimization/OptimizationTypes').SMC_V2_ParamSet;
}

/**
 * Backtest trade result
 */
export interface BacktestTrade {
  ticket: number;
  symbol: string;
  direction: 'buy' | 'sell';
  strategy: 'low' | 'high';
  entryPrice: number;
  exitPrice: number;
  entryTime: number; // epoch millis
  exitTime: number; // epoch millis
  sl: number | null;
  tp: number | null;
  volume: number;
  profit: number; // PnL in account currency
  durationMinutes: number;
  pips: number; // Pips moved (positive = win, negative = loss)
  riskReward?: number;
}

/**
 * Equity point (for equity curve)
 */
export interface EquityPoint {
  timestamp: number; // epoch millis
  balance: number;
  equity: number;
  drawdown: number; // Peak-to-trough drawdown
  drawdownPercent: number; // Drawdown as percentage
}

/**
 * Backtest statistics
 */
export interface BacktestStats {
  // Trade counts
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number; // Percentage
  
  // PnL
  totalPnL: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number; // grossProfit / abs(grossLoss)
  
  // Risk metrics
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxConsecutiveLosses: number;
  maxConsecutiveWins: number;
  
  // Trade metrics
  averageWin: number;
  averageLoss: number;
  averageRr: number; // Average Risk:Reward ratio
  expectancy: number; // (winRate * avgWin) - (lossRate * abs(avgLoss))
  averageTradeDurationMinutes: number;
  
  // Per-symbol stats
  perSymbolStats: Record<string, {
    trades: number;
    pnl: number;
    winRate: number;
  }>;
  
  // Per-strategy stats
  perStrategyStats: Record<string, {
    trades: number;
    pnl: number;
    winRate: number;
  }>;
  
  // Optional metrics
  sharpeRatio?: number; // If calculated
  
  // SMC Core Statistics
  smcStats?: {
    htf: {
      // Swings
      totalSwings: number;
      swingHighs: number;
      swingLows: number;
      averageSwingsPerEvaluation: number;
      // BOS (Break of Structure)
      totalBOS: number;
      bullishBOS: number;
      bearishBOS: number;
      // CHoCH (Change of Character)
      totalCHoCH: number;
      bullishCHoCH: number;
      bearishCHoCH: number;
      // MSB (Market Structure Break)
      totalMSB: number;
      bullishMSB: number;
      bearishMSB: number;
      // Trend Bias
      trendBullish: number;
      trendBearish: number;
      trendSideways: number;
      // Evaluations
      evaluations: number;
    };
    itf: {
      // Swings
      totalSwings: number;
      swingHighs: number;
      swingLows: number;
      averageSwingsPerEvaluation: number;
      // BOS
      totalBOS: number;
      bullishBOS: number;
      bearishBOS: number;
      // CHoCH
      totalCHoCH: number;
      bullishCHoCH: number;
      bearishCHoCH: number;
      // MSB (Market Structure Break)
      totalMSB: number;
      bullishMSB: number;
      bearishMSB: number;
      // Trend Bias
      trendBullish: number;
      trendBearish: number;
      trendSideways: number;
      // Evaluations
      evaluations: number;
    };
    ltf: {
      // Swings
      totalSwings: number;
      swingHighs: number;
      swingLows: number;
      averageSwingsPerEvaluation: number;
      // BOS
      totalBOS: number;
      bullishBOS: number;
      bearishBOS: number;
      // CHoCH
      totalCHoCH: number;
      bullishCHoCH: number;
      bearishCHoCH: number;
      // MSB (Market Structure Break)
      totalMSB: number;
      bullishMSB: number;
      bearishMSB: number;
      // Trend Bias
      trendBullish: number;
      trendBearish: number;
      trendSideways: number;
      // Evaluations
      evaluations: number;
    };
    totalEvaluations: number; // Total number of strategy evaluations
  };
}

/**
 * Backtest run result
 */
export interface BacktestResult {
  runId: string; // Unique identifier for this run
  config: BacktestConfig;
  startTime: number; // epoch millis (when backtest started)
  endTime: number; // epoch millis (when backtest finished)
  runtimeMs: number; // Duration in milliseconds
  stats: BacktestStats;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  initialBalance: number;
  finalBalance: number;
  totalReturn: number; // Absolute return
  totalReturnPercent: number; // Percentage return
}

/**
 * Backtest runner state
 */
export interface BacktestRunnerState {
  currentBalance: number;
  currentEquity: number;
  peakBalance: number; // For drawdown calculation
  openPositions: Map<number, SimulatedPosition>; // ticket -> position
  closedTrades: BacktestTrade[];
  equityCurve: EquityPoint[];
  dailyStats: Map<string, {
    date: string; // YYYY-MM-DD
    pnl: number;
    trades: number;
  }>;
}


