/**
 * MtfContextService - Multi-Timeframe Context Builder (SMC Core)
 * 
 * Builds complete multi-timeframe analysis context
 * Based on SMC_research.md Section 2.5 & 3.2.5
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../../marketData/types';
import {
  FrameworkConfig,
  TimeframeAnalysis,
  MultiTimeframeContext,
  EntrySignal,
  SwingPoint,
  BosEvent,
  TrendBiasSnapshot,
  ChoChEvent,
} from './Types';
import { SwingService } from './SwingService';
import { BosService } from './BosService';
import { TrendService } from './TrendService';
import { ChochService } from './ChochService';

const logger = new Logger('MtfContextService');

export class MtfContextService {
  private config: FrameworkConfig;
  private swingService: SwingService;
  private bosService: BosService;
  private trendService: TrendService;
  private chochService: ChochService;

  constructor(config: Partial<FrameworkConfig> = {}) {
    this.config = {
      swing: config.swing || {
        method: 'hybrid',
        pivotLeft: 3,
        pivotRight: 3,
        lookbackHigh: 20,
        lookbackLow: 20,
      },
      bos: config.bos || {
        bosLookbackSwings: 10,
        swingIndexLookback: 100,
        strictClose: true,
      },
      trend: config.trend || {
        minSwingPairs: 2,
        discountMax: 0.5,
        premiumMin: 0.5,
      },
    };

    // Initialize services with config
    this.swingService = new SwingService(this.config.swing);
    this.bosService = new BosService(this.config.bos);
    this.trendService = new TrendService(this.config.trend);
    this.chochService = new ChochService();
  }

  /**
   * Analyze a single timeframe
   */
  analyzeTimeframe(candles: Candle[]): TimeframeAnalysis {
    // 1. Detect swings
    const swings = this.swingService.detectSwings(candles);

    // 2. Detect BOS events
    const bosEvents = this.bosService.detectBOS(candles, swings);

    // 3. Compute trend bias snapshots
    const trendSnapshots = this.trendService.computeTrendBias(
      candles,
      swings,
      bosEvents
    );

    // 4. Detect CHoCH events
    const chochEvents = this.chochService.detectChoCh(
      candles,
      swings,
      bosEvents,
      trendSnapshots
    );

    return {
      candles,
      swings,
      bosEvents,
      trendSnapshots,
      chochEvents,
    };
  }

  /**
   * Build multi-timeframe context
   * 
   * Analyzes HTF, ITF, and LTF, then cross-maps time and derives entry signals
   */
  analyzeMultiTimeframe(
    htfCandles: Candle[],
    itfCandles: Candle[],
    ltfCandles: Candle[]
  ): MultiTimeframeContext {
    // Analyze each timeframe
    const htf = this.analyzeTimeframe(htfCandles);
    const itf = this.analyzeTimeframe(itfCandles);
    const ltf = this.analyzeTimeframe(ltfCandles);

    // Derive entry signals
    const entrySignals = this.deriveEntrySignals(htf, itf, ltf);

    return {
      htf,
      itf,
      ltf,
      entrySignals,
    };
  }

  /**
   * Derive entry signals from multi-timeframe context
   * 
   * Example short criteria:
   * - HTF trend === 'bearish'
   * - ITF trend === 'bearish' OR ITF just printed CHoCH bearish recently
   * - LTF CHoCH is fromTrend: 'bullish', toTrend: 'bearish'
   * 
   * Example long criteria:
   * - HTF trend === 'bullish'
   * - ITF trend === 'bullish' OR ITF just printed CHoCH bullish recently
   * - LTF CHoCH is fromTrend: 'bearish', toTrend: 'bullish'
   */
  private deriveEntrySignals(
    htf: TimeframeAnalysis,
    itf: TimeframeAnalysis,
    ltf: TimeframeAnalysis
  ): EntrySignal[] {
    const signals: EntrySignal[] = [];

    if (htf.candles.length === 0 || itf.candles.length === 0 || ltf.candles.length === 0) {
      return signals;
    }

    // Get latest trend states
    const htfTrend = htf.trendSnapshots.length > 0
      ? htf.trendSnapshots[htf.trendSnapshots.length - 1].trend
      : 'sideways';
    const itfTrend = itf.trendSnapshots.length > 0
      ? itf.trendSnapshots[itf.trendSnapshots.length - 1].trend
      : 'sideways';

    // Check for LTF CHoCH events
    for (const choch of ltf.chochEvents) {
      // Map LTF time to ITF/HTF context
      const ltfCandle = ltf.candles[choch.index];
      if (!ltfCandle) continue;

      const ltfTimestamp = ltfCandle.startTime.getTime();

      // Find corresponding ITF trend at this time
      const itfTrendAtTime = this.getTrendAtTime(itf.trendSnapshots, itf.candles, ltfTimestamp);
      const htfTrendAtTime = this.getTrendAtTime(htf.trendSnapshots, htf.candles, ltfTimestamp);

      // Short setup criteria
      if (
        htfTrendAtTime === 'bearish' &&
        (itfTrendAtTime === 'bearish' || this.hasRecentChoCh(itf.chochEvents, choch.index, 'bearish')) &&
        choch.fromTrend === 'bullish' &&
        choch.toTrend === 'bearish'
      ) {
        signals.push({
          direction: 'short',
          timeframe: 'LTF',
          index: choch.index,
          timestamp: choch.timestamp,
          reason: `HTF bearish, ITF bearish/CHoCH, LTF CHoCH bearish at ${choch.index}`,
        });
      }

      // Long setup criteria
      if (
        htfTrendAtTime === 'bullish' &&
        (itfTrendAtTime === 'bullish' || this.hasRecentChoCh(itf.chochEvents, choch.index, 'bullish')) &&
        choch.fromTrend === 'bearish' &&
        choch.toTrend === 'bullish'
      ) {
        signals.push({
          direction: 'long',
          timeframe: 'LTF',
          index: choch.index,
          timestamp: choch.timestamp,
          reason: `HTF bullish, ITF bullish/CHoCH, LTF CHoCH bullish at ${choch.index}`,
        });
      }
    }

    return signals;
  }

  /**
   * Get trend at a specific timestamp
   */
  private getTrendAtTime(
    snapshots: TrendBiasSnapshot[],
    candles: Candle[],
    timestamp: number
  ): 'bullish' | 'bearish' | 'sideways' {
    // Find the latest candle with timestamp <= target timestamp
    let latestIndex = -1;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].startTime.getTime() <= timestamp) {
        latestIndex = i;
      } else {
        break;
      }
    }

    if (latestIndex < 0 || latestIndex >= snapshots.length) {
      return 'sideways';
    }

    return snapshots[latestIndex].trend;
  }

  /**
   * Check if there's a recent CHoCH in the given direction
   */
  private hasRecentChoCh(
    chochEvents: ChoChEvent[],
    beforeIndex: number,
    direction: 'bullish' | 'bearish'
  ): boolean {
    // Check for CHoCH events within last 10 candles
    const recentChoCh = chochEvents.filter(
      c => c.index < beforeIndex && c.index >= beforeIndex - 10
    );

    if (direction === 'bearish') {
      return recentChoCh.some(c => c.toTrend === 'bearish');
    } else {
      return recentChoCh.some(c => c.toTrend === 'bullish');
    }
  }

  /**
   * Get HTF trend at a specific timestamp
   */
  getHTFTrendAt(context: MultiTimeframeContext, timestamp: number): 'bullish' | 'bearish' | 'sideways' {
    return this.getTrendAtTime(context.htf.trendSnapshots, context.htf.candles, timestamp);
  }

  /**
   * Get ITF trend at a specific timestamp
   */
  getITFTrendAt(context: MultiTimeframeContext, timestamp: number): 'bullish' | 'bearish' | 'sideways' {
    return this.getTrendAtTime(context.itf.trendSnapshots, context.itf.candles, timestamp);
  }

  /**
   * Get LTF trend at a specific timestamp
   */
  getLTFTrendAt(context: MultiTimeframeContext, timestamp: number): 'bullish' | 'bearish' | 'sideways' {
    return this.getTrendAtTime(context.ltf.trendSnapshots, context.ltf.candles, timestamp);
  }
}

