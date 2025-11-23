/**
 * ML Module Types (Trading Engine v13)
 * 
 * Defines types for ML Alpha Layer and Regime Detection
 */

/**
 * Market regime types
 */
export type RegimeType =
  | 'trending_up'
  | 'trending_down'
  | 'ranging'
  | 'volatile_expansion'
  | 'volatile_contraction'
  | 'news_regime'
  | 'liquidity_grab'
  | 'trend_reversal_zone';

/**
 * ML signal score from model prediction
 */
export interface MLSignalScore {
  probabilityWin: number; // 0-1: Probability of winning trade
  probabilitySL: number; // 0-1: Probability of stop loss hit
  probabilityTP: number; // 0-1: Probability of take profit hit
  expectedMove: number; // Expected price move distance in price units
  confidence: number; // 0-1: Overall confidence in prediction
}

/**
 * ML decision result
 */
export interface MLDecision {
  mlPass: boolean; // Whether ML layer allows trade
  mlReasons: string[]; // Human-readable reasons for pass/skip
  mlScore: MLSignalScore | null; // ML predictions (null if model failed)
  regime: RegimeType; // Detected market regime
  features?: Record<string, number>; // Feature vector used (optional for debugging)
}

/**
 * Feature vector (flat record of numeric features)
 */
export type FeatureVector = Record<string, number>;

/**
 * ML model metadata
 */
export interface MLModelMetadata {
  modelType: 'lightgbm' | 'onnx';
  version: string;
  features: string[]; // List of feature names expected
  trainedDate?: string;
  performance?: {
    trainAUC?: number;
    trainAccuracy?: number;
    testAUC?: number;
    testAccuracy?: number;
  };
}

/**
 * Regime detection context
 */
export interface RegimeDetectionContext {
  symbol: string;
  candles: any[]; // Historical candles
  currentTick?: any; // Current tick from PriceFeed
  volatility?: number; // Current volatility measure
  spread?: number; // Current spread
  timeOfDay?: number; // Hour of day (0-23)
  dayOfWeek?: number; // Day of week (0-6)
  session?: string; // Trading session (london, newyork, asian)
}

/**
 * Feature building context
 */
export interface FeatureBuildingContext {
  symbol: string;
  signal: any; // Raw SMC signal
  candles: any[]; // Historical candles
  currentTick?: any; // Current tick
  smcMetadata?: any; // SMC v2 metadata
  regime?: RegimeType; // Detected regime
}

/**
 * Export MLModelInterface for use in model implementations
 */
export type { MLModelInterface } from './MLModelInterface';

