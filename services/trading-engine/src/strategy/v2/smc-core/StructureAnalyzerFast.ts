/**
 * StructureAnalyzerFast - Optimized BOS + CHoCH detection in a single pass
 * 
 * Performance improvements:
 * - Single linear scan per timeframe
 * - Minimal allocations
 * - Aggregated logging only
 * 
 * Use this in MarketStructureHTF, MarketStructureITF, MarketStructureLTF
 * for better performance during backtests.
 */

import { SwingPoint, BosEvent, ChoChEvent, TrendBias } from './Types';

export interface StructureConfig {
  pivotLeft: number;   // e.g. 1 or 2 (for 3-candle pivot: left=1, right=1)
  pivotRight: number;  // e.g. 1 or 2
  minSwingDistance: number; // in candles, to avoid noise
}

export interface StructureResult {
  swings: SwingPoint[];
  bosEvents: BosEvent[];
  chochEvents: ChoChEvent[];
  trend: TrendBias;
}

interface CandleData {
  high: number;
  low: number;
  close: number;
  timestamp: number;
}

/**
 * Optimized structure analysis in a single pass
 * Assumes candles is already windowed for the timeframe
 */
export function analyzeStructureFast(
  candles: CandleData[],
  cfg: StructureConfig
): StructureResult {
  const swings: SwingPoint[] = [];
  const bosEvents: BosEvent[] = [];
  const chochEvents: ChoChEvent[] = [];

  const { pivotLeft, pivotRight, minSwingDistance } = cfg;
  const lastIdx = candles.length - 1;

  // 1) Find pivot highs/lows in one pass, with simple window checks
  // We avoid slicing and allocations inside the loop
  for (let i = pivotLeft; i <= lastIdx - pivotRight; i++) {
    let isHigh = true;
    let isLow = true;

    const hi = candles[i].high;
    const lo = candles[i].low;

    // Check left/right neighbors
    for (let j = i - pivotLeft; j <= i + pivotRight; j++) {
      if (j === i) continue;
      if (candles[j].high >= hi) isHigh = false;
      if (candles[j].low <= lo) isLow = false;
      if (!isHigh && !isLow) break;
    }

    if (isHigh) {
      if (swings.length === 0 || i - swings[swings.length - 1].index >= minSwingDistance) {
        swings.push({
          index: i,
          type: 'high',
          price: hi,
          timestamp: candles[i].timestamp,
        });
      }
    } else if (isLow) {
      if (swings.length === 0 || i - swings[swings.length - 1].index >= minSwingDistance) {
        swings.push({
          index: i,
          type: 'low',
          price: lo,
          timestamp: candles[i].timestamp,
        });
      }
    }
  }

  // 2) Traverse swings to detect BOS + CHoCH in one pass
  let currentBias: 'bullish' | 'bearish' | null = null;
  let lastBullishSwingIdx = -1;
  let lastBearishSwingIdx = -1;
  let lastBrokenSwingHigh: { index: number; price: number } | null = null;
  let lastBrokenSwingLow: { index: number; price: number } | null = null;

  for (let i = 0; i < swings.length; i++) {
    const s = swings[i];

    // Initialize bias from first two swings
    if (currentBias == null && i >= 1) {
      const prev = swings[i - 1];
      if (s.type === 'high' && s.price > prev.price) {
        currentBias = 'bullish';
      } else if (s.type === 'low' && s.price < prev.price) {
        currentBias = 'bearish';
      }
    }

    // Track last swings by type
    if (s.type === 'high') {
      if (lastBullishSwingIdx === -1 || s.price > swings[lastBullishSwingIdx].price) {
        lastBullishSwingIdx = i;
      }
    } else {
      if (lastBearishSwingIdx === -1 || s.price < swings[lastBearishSwingIdx].price) {
        lastBearishSwingIdx = i;
      }
    }

    // Check BOS against previous structural swings
    const close = candles[s.index].close;

    // Bullish BOS: close breaks above last swing high
    if (lastBullishSwingIdx !== -1 && close > swings[lastBullishSwingIdx].price) {
      const brokenSwing = swings[lastBullishSwingIdx];
      
      bosEvents.push({
        index: s.index,
        direction: 'bullish',
        brokenSwingIndex: brokenSwing.index,
        brokenSwingType: brokenSwing.type,
        level: brokenSwing.price,
        timestamp: candles[s.index].timestamp,
        strictClose: true,
      });

      // CHoCH: only if prior bias was bearish
      if (currentBias === 'bearish' && lastBrokenSwingLow) {
        chochEvents.push({
          index: s.index,
          timestamp: candles[s.index].timestamp,
          fromTrend: 'bearish',
          toTrend: 'bullish',
          brokenSwingIndex: lastBrokenSwingLow.index,
          brokenSwingType: 'low',
          level: lastBrokenSwingLow.price,
          bosIndex: s.index,
        });
      }

      currentBias = 'bullish';
      lastBrokenSwingHigh = { index: brokenSwing.index, price: brokenSwing.price };
    }

    // Bearish BOS: close breaks below last swing low
    if (lastBearishSwingIdx !== -1 && close < swings[lastBearishSwingIdx].price) {
      const brokenSwing = swings[lastBearishSwingIdx];
      
      bosEvents.push({
        index: s.index,
        direction: 'bearish',
        brokenSwingIndex: brokenSwing.index,
        brokenSwingType: brokenSwing.type,
        level: brokenSwing.price,
        timestamp: candles[s.index].timestamp,
        strictClose: true,
      });

      // CHoCH: only if prior bias was bullish
      if (currentBias === 'bullish' && lastBrokenSwingHigh) {
        chochEvents.push({
          index: s.index,
          timestamp: candles[s.index].timestamp,
          fromTrend: 'bullish',
          toTrend: 'bearish',
          brokenSwingIndex: lastBrokenSwingHigh.index,
          brokenSwingType: 'high',
          level: lastBrokenSwingHigh.price,
          bosIndex: s.index,
        });
      }

      currentBias = 'bearish';
      lastBrokenSwingLow = { index: brokenSwing.index, price: brokenSwing.price };
    }
  }

  // 3) Derive trend from final bias + net BOS counts
  let trend: TrendBias = 'sideways';
  const bullBos = bosEvents.filter((b) => b.direction === 'bullish').length;
  const bearBos = bosEvents.filter((b) => b.direction === 'bearish').length;

  if (bullBos > bearBos && bullBos > 0) {
    trend = 'bullish';
  } else if (bearBos > bullBos && bearBos > 0) {
    trend = 'bearish';
  } else if (currentBias) {
    // Use current bias if no clear BOS dominance
    trend = currentBias;
  }

  return {
    swings,
    bosEvents,
    chochEvents,
    trend,
  };
}

/**
 * Convert candle array to CandleData format
 */
export function candlesToData(candles: Array<{ high: number; low: number; close: number; startTime: Date }>): CandleData[] {
  return candles.map(c => ({
    high: c.high,
    low: c.low,
    close: c.close,
    timestamp: c.startTime.getTime(),
  }));
}

