/**
 * Market Structure Model (MSM) Types
 * 
 * Defines types for the Market Structure Strategy (market_structure_v1)
 * which uses H4→15m→5m→1m alignment with true external swings.
 */

import { BosEvent, ChoChEvent, SwingPoint } from '../smc-core/Types';
import { Candle } from '../../../marketData/types';

/**
 * Market Structure Direction
 */
export type MSMDirection = 'bullish' | 'bearish' | 'sideways';

/**
 * External Range - True structural range defined by external swings
 */
export interface ExternalRange {
  direction: MSMDirection;
  swingHigh: number | null;
  swingLow: number | null;
  lastUpdateIndex: number; // candle index of last update
  lastBosIndex?: number;   // index of BOS that created/updated this range
}

/**
 * External Range Update Input
 */
export interface ExternalRangeUpdateInput {
  swings: SwingPoint[];
  bosEvents: BosEvent[];
  chochEvents: ChoChEvent[];
  currentClose: number;
  currentIndex: number;
}

/**
 * MSM Setup Zone - 5m Point of Interest for entry
 */
export interface MSMSetupZone {
  direction: 'bullish' | 'bearish';
  tf: 'M5';
  priceMin: number;
  priceMax: number;
  structuralExtreme: number; // exact OB/FVG high or low used for SL anchor
  refType: 'orderBlock' | 'fvg' | 'both';
  hasLiquiditySweep: boolean;
  obIndex?: number;      // candle index of order block
  fvgIndex?: number;     // candle index range of FVG
  zoneStartIndex?: number;
  zoneEndIndex?: number;
}

/**
 * Micro Trend - 1m trend classification
 */
export type MicroTrend = 'bullish' | 'bearish' | 'unknown';

/**
 * Market Structure Phase - ITF expansion vs pullback
 */
export type StructurePhase = 'expansion' | 'pullback' | 'unknown';

/**
 * Market Structure Strategy Configuration
 */
export interface MarketStructureConfig {
  m1LookbackSwings: number;      // How many 1m swings to analyze for micro trend
  minRR: number;                 // Minimum Risk:Reward ratio (e.g., 2.0)
  slBufferPips: number;          // Buffer above/below structural extreme for SL
  maxSpreadPips?: number;        // Maximum spread to allow trading
  discountThreshold?: number;    // Threshold for discount zone (default 0.5)
  premiumThreshold?: number;     // Threshold for premium zone (default 0.5)
  minSwingPairs?: number;        // Minimum swing pairs for trend confirmation
  equalHighTolerance?: number;   // Tolerance for equal highs/lows in pips
}

/**
 * Market Structure Signal Result
 */
export interface MarketStructureSignalResult {
  signal: EnhancedRawSignalV2 | null;
  reason?: string;
  debugReasons?: string[];
  context?: {
    htfDirection?: MSMDirection;
    htfRange?: ExternalRange;
    itfDirection?: MSMDirection;
    itfRange?: ExternalRange;
    itfPhase?: StructurePhase;
    setupZone?: MSMSetupZone;
    m1MicroTrend?: MicroTrend;
    m1LastChoch?: ChoChEvent | null;
    m1LastBos?: BosEvent | null;
  };
}

/**
 * Re-export EnhancedRawSignalV2 from shared types
 */
import { EnhancedRawSignalV2 } from '@providencex/shared-types';

