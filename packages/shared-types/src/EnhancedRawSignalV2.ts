/**
 * Enhanced Raw Signal V2 Types (Trading Engine v10 - SMC v2)
 * 
 * Defines interfaces for SMC v2 enhanced signals with multi-timeframe confluence
 */

export type TrendDirection = 'bullish' | 'bearish' | 'sideways' | 'range';
export type PremiumDiscount = 'premium' | 'discount' | 'neutral';
export type FlowDirection = 'aligned' | 'counter' | 'neutral';
export type FVGType = 'continuation' | 'reversal';
export type FVGGrade = 'wide' | 'narrow' | 'nested';
export type LiquidityType = 'EQH' | 'EQL' | 'sweep';
export type SessionName = 'london' | 'newyork' | 'asian' | 'all';

export interface OrderBlockLevel {
  type: 'bullish' | 'bearish';
  high: number;
  low: number;
  timestamp: string;
  timeframe: 'HTF' | 'ITF' | 'LTF';
  mitigated: boolean;
  wickToBodyRatio?: number;
  volumeImbalance?: boolean;
}

export interface FVGLevel {
  type: FVGType;
  grade: FVGGrade;
  high: number;
  low: number;
  timestamp: string;
  timeframe: 'HTF' | 'ITF' | 'LTF';
  premiumDiscount: PremiumDiscount;
  filled: boolean;
}

export interface SMTDivergence {
  bullish: boolean;
  bearish: boolean;
  correlationSymbol?: string; // e.g., 'DXY' for EURUSD
  reason?: string;
}

export interface LiquiditySweep {
  type: LiquidityType;
  level: number;
  timestamp: string;
  confirmed: boolean;
  timeframe: 'HTF' | 'ITF' | 'LTF';
}

export interface VolumeImbalanceZone {
  high: number;
  low: number;
  timestamp: string;
  intensity: 'high' | 'medium' | 'low';
  timeframe: 'HTF' | 'ITF' | 'LTF';
}

export interface TrendlineLiquidity {
  level: number;
  touches: number; // 2-touch or 3-touch
  confirmed: boolean;
  direction: 'bullish' | 'bearish';
  liquidityAbove?: boolean;
  liquidityBelow?: boolean;
}

// All types and interfaces are already exported above, no need for duplicate exports

export type OrderKind = 'market' | 'limit' | 'stop';

export interface EnhancedRawSignalV2 {
  symbol: string;
  direction: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  orderKind?: OrderKind; // Strategy-determined order type: limit (price comes to entry) or market (immediate)
  
  // Multi-timeframe structure
  htfTrend: TrendDirection;
  itfFlow: FlowDirection;
  ltfBOS: boolean; // Break of Structure confirmed
  
  // Premium/Discount
  premiumDiscount: PremiumDiscount;
  
  // Order Blocks (multi-timeframe)
  obLevels: {
    htf?: OrderBlockLevel;
    itf?: OrderBlockLevel;
    ltf?: OrderBlockLevel;
  };
  
  // Fair Value Gaps (multi-timeframe)
  fvgLevels: {
    htf?: FVGLevel;
    itf?: FVGLevel;
    ltf?: FVGLevel;
  };
  
  // SMT Divergence
  smt: SMTDivergence;
  
  // Liquidity Sweep
  liquiditySweep?: LiquiditySweep;
  
  // Volume Imbalance
  volumeImbalance: {
    zones: VolumeImbalanceZone[];
    aligned: boolean; // Aligned with OB + FVG
  };
  
  // Entry Refinement (LTF)
  ltfEntryRefinedOB?: OrderBlockLevel;
  ltfFVGResolved: boolean;
  ltfSweepConfirmed: boolean;
  
  // Session Filter
  sessionValid: boolean;
  session?: SessionName;
  
  // Trendline Liquidity
  trendlineLiquidity?: TrendlineLiquidity;
  
  // Confluence Reasons
  confluenceReasons: string[]; // List of all confluences met
  
  // Scoring
  confluenceScore: number; // 0-100
  riskScore?: number; // 0-100
  
  // Metadata
  timestamp: string; // ISO 8601
  meta?: Record<string, any>;
}

