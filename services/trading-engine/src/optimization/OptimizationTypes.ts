/**
 * Optimization Types (Trading Engine v11)
 * 
 * Defines all types for hyperparameter optimization and walk-forward analysis
 */

/**
 * SMC v2 Parameter Set - All tunable parameters for SMC v2 strategy
 */
export interface SMC_V2_ParamSet {
  // HTF Structure
  htfSwingLookback?: number; // 10-40
  htfTrendWeight?: number; // 0.5-1.0
  
  // ITF Structure
  itfBosSensitivity?: number; // 0.5-1.0
  itfLiquiditySweepTolerance?: number; // 0.3-0.8
  
  // LTF Refinement
  ltfRefinementDepth?: number; // 1-4
  ltfEntryRetracePct?: number; // 10-60
  
  // FVG
  fvgMinSize?: number; // 1-5 pips
  fvgFillTolerancePct?: number; // 10-50
  
  // Order Block v2
  obMinVolumeFactor?: number; // 1.0-3.0
  obWickBodyRatioMin?: number; // 0.2-0.6
  
  // SMT Divergence
  smtWeight?: number; // 0-1.0
  smtConfirmRequired?: boolean;
  
  // Volatility Filters
  volatilityATRMultiplier?: number; // 1.0-3.0
  
  // Sessions
  allowedSessions?: Array<'london' | 'newyork' | 'asian' | 'all'>;
  sessionStartHour?: number; // 0-23
  sessionEndHour?: number; // 0-23
  
  // Risk
  riskRewardTarget?: number; // Default: 2.0
  stopLossTolerancePct?: number; // 5-20
  maxLossAllowed?: number; // 1-5% of account
}

/**
 * Optimization Method
 */
export type OptimizationMethod = 
  | 'grid' 
  | 'random' 
  | 'bayes' 
  | 'walkforward' 
  | 'genetic';

/**
 * Date Range for optimization
 */
export interface DateRange {
  from: string; // ISO 8601 date
  to: string; // ISO 8601 date
}

/**
 * Optimization Request
 */
export interface OptimizationRequest {
  method: OptimizationMethod;
  symbol: string | string[]; // Single or multiple symbols
  dateRange: DateRange;
  outOfSampleRange?: DateRange; // For walk-forward
  paramGrid?: ParameterGrid; // For grid search
  paramRanges?: ParameterRanges; // For random/bayes
  trials?: number; // For random/bayes
  walkForwardWindows?: number; // For walk-forward
  walkForwardStep?: number; // Days to step forward
  population?: number; // For genetic algorithm
  generations?: number; // For genetic algorithm
  saveToDb?: boolean;
  exportCsv?: boolean;
  parallelRuns?: number; // Max parallel backtest runs
}

/**
 * Parameter Grid (for grid search)
 */
export interface ParameterGrid {
  [key: string]: any[]; // e.g., { obSensitivity: [0.4, 0.5, 0.6], fvgMinSize: [1, 2, 3] }
}

/**
 * Parameter Ranges (for random/bayes search)
 */
export interface ParameterRanges {
  [key: string]: {
    min: number;
    max: number;
    step?: number; // Optional step size for discrete values
    type?: 'int' | 'float' | 'boolean';
  };
}

/**
 * Optimization Run (stored in database)
 */
export interface OptimizationRun {
  id?: number; // Auto-generated
  method: OptimizationMethod;
  symbol: string | string[];
  paramSet: SMC_V2_ParamSet | null; // Null for grid/random, set for specific run
  inSampleRange: DateRange;
  outSampleRange?: DateRange;
  status: 'pending' | 'running' | 'completed' | 'failed';
  created_at?: string; // ISO 8601
  completed_at?: string; // ISO 8601
  error?: string;
}

/**
 * Optimization Metrics
 */
export interface OptimizationMetrics {
  // Profitability
  winRate: number; // 0-1
  totalNetProfit: number;
  profitFactor: number; // Gross profit / Gross loss
  expectancy: number; // Average profit per trade
  avgWinner: number;
  avgLoser: number;
  maxDrawdown: number; // Absolute value
  maxDrawdownPct: number; // Percentage
  recoveryFactor: number; // Net profit / Max drawdown
  
  // Stability
  sharpeRatio: number;
  sortinoRatio: number;
  tradeFrequency: number; // Trades per period
  losingStreakMax: number;
  losingStreakAvg: number;
  
  // Robustness (for walk-forward)
  outOfSampleWinRate?: number;
  outOfSampleProfitFactor?: number;
  parameterStability?: number; // 0-1, how stable params are across windows
  sensitivityScore?: number; // 0-1, how sensitive to param changes
}

/**
 * Optimization Result
 */
export interface OptimizationResult {
  runId: number;
  paramSet: SMC_V2_ParamSet;
  metrics: OptimizationMetrics;
  equityCurve: EquityPoint[]; // Time series of equity
  trades: OptimizationTrade[]; // All trades for analysis
  rankedScore: number; // Composite score for ranking (higher is better)
}

/**
 * Equity Point (for equity curve)
 */
export interface EquityPoint {
  date: string; // ISO 8601
  equity: number;
  drawdown: number;
  drawdownPct: number;
}

/**
 * Optimization Trade (simplified trade record)
 */
export interface OptimizationTrade {
  entryDate: string; // ISO 8601
  exitDate: string; // ISO 8601
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  profit: number;
  profitPct: number;
  win: boolean;
}

/**
 * Walk-Forward Window Result
 */
export interface WalkForwardWindowResult {
  windowIndex: number;
  inSampleRange: DateRange;
  outSampleRange: DateRange;
  bestParamSet: SMC_V2_ParamSet;
  inSampleMetrics: OptimizationMetrics;
  outSampleMetrics: OptimizationMetrics;
  stability: number; // 0-1, consistency of performance
}

/**
 * Complete Walk-Forward Result
 */
export interface WalkForwardResult {
  symbol: string | string[];
  totalWindows: number;
  windows: WalkForwardWindowResult[];
  bestStableParamSet: SMC_V2_ParamSet; // Most stable across all windows
  averageMetrics: OptimizationMetrics;
  stabilityScore: number; // Overall stability (0-1)
}

/**
 * Optimizer Configuration
 */
export interface OptimizerConfig {
  databaseUrl?: string;
  maxParallelRuns?: number; // Default: 4
  defaultTrials?: number; // Default: 50 for random/bayes
  defaultWalkForwardWindows?: number; // Default: 5
  defaultWalkForwardStep?: number; // Default: 30 days
  scoringWeights?: {
    winRate?: number;
    profitFactor?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    stability?: number;
  };
}

