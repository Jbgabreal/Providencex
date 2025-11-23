/**
 * Signal Converter
 * 
 * Converts v2 TradeSignal to v3 RawSignal format
 */

import { TradeSignal, TrendDirection } from '../../types';
import { RawSignal, TimeframeContext, SmcMetadata } from './types';
import { getConfig } from '../../config';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';

/**
 * Convert v2 TradeSignal to v3 RawSignal
 * 
 * Extracts SMC metadata from signal.meta and maps to v3 structure
 * 
 * @throws {Error} If required signal data is missing or invalid
 */
export function convertToRawSignal(
  signal: TradeSignal,
  htfTrend: TrendDirection,
  htfTimeframe: string = 'H1',
  ltfTimeframe: string = 'M5'
): RawSignal {
  if (!signal || !signal.symbol || !signal.direction || signal.entry === undefined) {
    throw new Error('Invalid TradeSignal: missing required fields (symbol, direction, entry)');
  }

  const meta = signal.meta || {};
  
  // Map HTF trend
  const htfTrendMapped: 'bullish' | 'bearish' | 'range' = 
    htfTrend === 'sideways' ? 'range' : htfTrend;

  // Build timeframe context
  const timeframeContext: TimeframeContext = {
    htfTimeframe: htfTimeframe as 'H1' | 'H4' | 'D1',
    ltfTimeframe: ltfTimeframe as 'M5' | 'M15' | 'M1',
    htfTrend: htfTrendMapped,
    ltfStructure: meta.ltfStructure || 'impulsive',
    lastBosDirection: meta.lastBosDirection ? 
      (meta.lastBosDirection === 'up' || meta.lastBosDirection === 'bullish' ? 'bullish' : 'bearish') : undefined,
    lastChochDirection: meta.lastChochDirection ? 
      (meta.lastChochDirection === 'up' || meta.lastChochDirection === 'bullish' ? 'bullish' : 'bearish') : undefined,
  };

  // Build SMC metadata
  const smcMetadata: SmcMetadata = {
    orderBlockZone: meta.orderBlockZone ? {
      upper: meta.orderBlockZone.upper || meta.orderBlockZone.high,
      lower: meta.orderBlockZone.lower || meta.orderBlockZone.low,
      type: meta.orderBlockZone.type || (signal.direction === 'buy' ? 'demand' : 'supply'),
      timeframe: meta.orderBlockZone.timeframe || ltfTimeframe,
    } : undefined,
    liquiditySwept: meta.liquiditySwept === true || meta.liquiditySweep === true,
    equalHighsBroken: meta.equalHighsBroken === true,
    equalLowsBroken: meta.equalLowsBroken === true,
    displacementCandle: meta.displacementCandle === true,
    entryReason: signal.reason,
    // v2 specific metadata (extracted from meta if available)
    premiumDiscount: meta.premiumDiscount,
    itfFlow: meta.itfFlow,
    smtDivergence: meta.smt,
    fvgLevels: meta.fvgLevels,
    volumeImbalance: meta.volumeImbalance,
    sessionValid: meta.sessionValid !== undefined ? meta.sessionValid : undefined,
    session: meta.session,
    confluenceScore: meta.confluenceScore,
    confluenceReasons: meta.confluenceReasons,
  };

  // Extract strategy name from meta or default to 'low'
  const strategyName = meta.strategy || 'low';

  return {
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: signal.entry,
    sl: signal.stopLoss,
    tp: signal.takeProfit,
    riskReward: signal.meta?.riskReward,
    createdAt: new Date(),
    timeframeContext,
    smcMetadata,
    strategyName: strategyName as 'low' | 'high',
  };
}

/**
 * Convert v10 EnhancedRawSignalV2 to v3 RawSignal
 * 
 * Extracts SMC v2 metadata and maps to v3 structure
 * 
 * @throws {Error} If required signal data is missing or invalid
 */
export function convertEnhancedSignalToRawSignal(
  signal: EnhancedRawSignalV2,
  htfTimeframe: string = 'H1',
  ltfTimeframe: string = 'M5'
): RawSignal {
  if (!signal || !signal.symbol || !signal.direction || signal.entry === undefined) {
    throw new Error('Invalid EnhancedRawSignalV2: missing required fields (symbol, direction, entry)');
  }

  // Map HTF trend
  const htfTrendMapped: 'bullish' | 'bearish' | 'range' = 
    signal.htfTrend === 'sideways' || signal.htfTrend === 'range' ? 'range' : signal.htfTrend;

  // Build timeframe context
  const timeframeContext: TimeframeContext = {
    htfTimeframe: htfTimeframe as 'H1' | 'H4' | 'D1',
    ltfTimeframe: ltfTimeframe as 'M5' | 'M15' | 'M1',
    htfTrend: htfTrendMapped,
    ltfStructure: signal.ltfBOS ? 'impulsive' : 'corrective',
    lastBosDirection: signal.htfTrend === 'bullish' ? 'bullish' : 'bearish',
    lastChochDirection: signal.itfFlow === 'aligned' ? (signal.htfTrend === 'bullish' ? 'bullish' : 'bearish') : undefined,
  };

  // Build SMC metadata from v2 signal
  const smcMetadata: SmcMetadata = {
    orderBlockZone: signal.obLevels.htf ? {
      upper: signal.obLevels.htf.high,
      lower: signal.obLevels.htf.low,
      type: signal.obLevels.htf.type === 'bullish' ? 'demand' : 'supply',
      timeframe: 'HTF',
    } : signal.obLevels.itf ? {
      upper: signal.obLevels.itf.high,
      lower: signal.obLevels.itf.low,
      type: signal.obLevels.itf.type === 'bullish' ? 'demand' : 'supply',
      timeframe: 'ITF',
    } : undefined,
    liquiditySwept: !!signal.liquiditySweep,
    equalHighsBroken: signal.liquiditySweep?.type === 'EQH',
    equalLowsBroken: signal.liquiditySweep?.type === 'EQL',
    displacementCandle: signal.ltfBOS,
    entryReason: signal.confluenceReasons.join('; '),
    // v2 specific metadata
    premiumDiscount: signal.premiumDiscount,
    itfFlow: signal.itfFlow,
    smtDivergence: signal.smt,
    fvgLevels: signal.fvgLevels,
    volumeImbalance: signal.volumeImbalance,
    sessionValid: signal.sessionValid,
    session: signal.session,
    confluenceScore: signal.confluenceScore,
    confluenceReasons: signal.confluenceReasons,
  };

  return {
    symbol: signal.symbol,
    direction: signal.direction,
    entryPrice: signal.entry,
    sl: signal.stopLoss,
    tp: signal.takeProfit,
    riskReward: 2.0, // Default RR for v2
    createdAt: new Date(signal.timestamp),
    timeframeContext,
    smcMetadata,
    strategyName: 'low', // Default strategy
  };
}

