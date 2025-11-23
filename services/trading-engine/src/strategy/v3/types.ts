/**
 * Trading Engine v3 - Execution Filter Types
 * 
 * Defines types for the v3 execution filtering system that adds
 * multi-confirmation logic on top of existing v2 signals.
 */

export type Direction = 'buy' | 'sell';

export type ExecutionAction = 'TRADE' | 'SKIP';

/**
 * Timeframe context for multi-timeframe analysis
 */
export interface TimeframeContext {
  htfTimeframe: 'H1' | 'H4' | 'D1';
  ltfTimeframe: 'M5' | 'M15' | 'M1';
  htfTrend: 'bullish' | 'bearish' | 'range';
  ltfStructure: 'impulsive' | 'corrective' | 'choppy';
  lastBosDirection?: 'bullish' | 'bearish';
  lastChochDirection?: 'bullish' | 'bearish';
}

/**
 * SMC-specific metadata for signal validation (v1-v2 compatible)
 */
export interface SmcMetadata {
  orderBlockZone?: {
    upper: number;
    lower: number;
    type: 'demand' | 'supply';
    timeframe: string;
  };
  liquiditySwept?: boolean;
  equalHighsBroken?: boolean;
  equalLowsBroken?: boolean;
  displacementCandle?: boolean;
  entryReason?: string;
  // v10 SMC v2 specific fields
  premiumDiscount?: 'premium' | 'discount' | 'neutral';
  itfFlow?: 'aligned' | 'counter' | 'neutral';
  smtDivergence?: {
    bullish: boolean;
    bearish: boolean;
    correlationSymbol?: string;
  };
  fvgLevels?: {
    htf?: any;
    itf?: any;
    ltf?: any;
  };
  volumeImbalance?: {
    zones: any[];
    aligned: boolean;
  };
  sessionValid?: boolean;
  session?: string;
  confluenceScore?: number;
  confluenceReasons?: string[];
}

/**
 * Raw signal from StrategyService (v2) with v3 metadata
 */
export interface RawSignal {
  symbol: string;
  direction: Direction;
  entryPrice: number;
  sl: number;
  tp: number;
  riskReward?: number;
  createdAt: Date;
  timeframeContext: TimeframeContext;
  smcMetadata?: SmcMetadata;
  strategyName: 'low' | 'high' | string;
}

/**
 * Execution decision result from v3 filter
 */
export interface ExecutionDecision {
  action: ExecutionAction;
  reasons: string[]; // Human-readable reasons for TRADE or SKIP
  normalizedSignal: RawSignal; // May be adjusted in future; for now same as input
}

/**
 * Session window configuration
 */
export interface SessionWindow {
  label: string; // e.g. "London", "NY"
  startHour: number; // Hour in engine timezone (0-23)
  endHour: number; // Hour in engine timezone (0-23)
}

/**
 * Execution rules for a specific symbol
 */
export interface SymbolExecutionRules {
  symbol: string;
  enabled: boolean;
  allowedDirections: Direction[]; // Usually both ['buy', 'sell']
  
  // Multi-timeframe requirements
  requireHtfAlignment: boolean; // Only trade in direction of HTF trend
  allowedHtfTrends: ('bullish' | 'bearish' | 'range')[];
  
  // Structural confirmations
  requireBosInDirection: boolean; // BOS must agree with trade direction
  requireLiquiditySweep: boolean; // Must be true in smcMetadata
  requireDisplacementCandle: boolean;
  
  // Session constraints
  enabledSessions: SessionWindow[];
  blockNewsGuardrailModes?: string[]; // e.g. ['avoid', 'highImpact']
  
  // Trade frequency limits
  maxTradesPerDay: number;
  minMinutesBetweenTrades: number; // Cooldown per symbol/strategy
  maxConcurrentTradesPerSymbol: number;
  
  // v4 - Exposure & Concurrency (optional for backward compatibility)
  maxConcurrentTradesPerDirection?: number; // Per symbol, per direction (buy/sell)
  maxConcurrentTradesGlobal?: number; // Across all symbols
  maxDailyRiskPerSymbol?: number; // Account currency (e.g., USD)
  maxDailyRiskGlobal?: number; // Account currency (e.g., USD)
  
  // Price/volatility filters
  maxSpreadPips?: number;
  minDistanceFromDailyHighLowPips?: number;
  
  // Confluence threshold - minimum confluence score required (0-100)
  minConfluenceScore?: number; // Default: 65, XAUUSD: 70
  
  // Displacement candle check - symbol-aware
  displacementMinATRMultiplier?: number; // Displacement candle must be >= Nx ATR (default: 2.0)
}

/**
 * Execution filter configuration
 */
export interface ExecutionFilterConfig {
  rulesBySymbol: Record<string, SymbolExecutionRules>;
  timezone: string; // e.g. 'America/Toronto' or 'America/New_York'
  
  // v4 - Global exposure limits (optional for backward compatibility)
  maxConcurrentTradesGlobal?: number; // Across all symbols (can override per-symbol)
  maxDailyRiskGlobal?: number; // Account currency (can override per-symbol)
  exposurePollIntervalSec?: number; // How often to poll MT5 for open positions (default: 10)
  
  // Volume Imbalance alignment rule - configurable for dev/experimentation
  requireVolumeImbalanceAlignment?: boolean; // true = hard rule (default), false = soft rule (log but don't block)
}

/**
 * Context for execution filter evaluation
 */
export interface ExecutionFilterContext {
  guardrailMode?: string; // e.g. 'normal', 'avoid', 'blocked'
  spreadPips?: number;
  now?: Date; // Allow injection for testing
  openTradesForSymbol?: number;
  todayTradeCountForSymbolStrategy?: number;
  lastTradeAtForSymbolStrategy?: Date | null;
  currentPrice?: number; // For distance from high/low checks
  dailyHigh?: number;
  dailyLow?: number;
}

