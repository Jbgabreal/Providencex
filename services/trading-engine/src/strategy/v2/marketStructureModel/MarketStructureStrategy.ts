/**
 * MarketStructureStrategy - Market Structure Model Strategy (market_structure_v1)
 * 
 * Implements H4→15m→5m→1m alignment with true external swings.
 * 
 * Timeframe roles:
 * - H4: Directional bias (HTF)
 * - M15: Structural leg & phase (ITF) 
 * - M5: Point of Interest & entry candle (OB/FVG)
 * - M1: Confirmation (micro CHOCH/MSS)
 */

import { Logger } from '@providencex/shared-utils';
import { MarketDataService } from '../../../services/MarketDataService';
import { Candle } from '../../../marketData/types';
import { MarketStructureHTF } from '../MarketStructureHTF';
import { MarketStructureITF } from '../MarketStructureITF';
import { MarketStructureLTF } from '../MarketStructureLTF';
import { ExternalRangeTracker } from './ExternalRangeTracker';
import { getDiscountOrPremium, isWithinRange } from './RangeUtils';
import { M5POIFinder } from './M5POIFinder';
import {
  MarketStructureSignalResult,
  MarketStructureConfig,
  MSMDirection,
  StructurePhase,
  MicroTrend,
  MSMSetupZone,
  ExternalRange,
} from './types';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';
import { BosEvent, ChoChEvent, SwingPoint } from '../smc-core/Types';
import { candlesToData } from '../smc-core/Types';
import { StructuralSwingService } from '../smc-core/StructuralSwingService';
import { BosService } from '../smc-core/BosService';
import { ChochService } from '../smc-core/ChochService';

const logger = new Logger('MarketStructureStrategy');

export class MarketStructureStrategy {
  private marketDataService: MarketDataService;
  private htfStructure: MarketStructureHTF;
  private itfStructure: MarketStructureITF;
  private ltfStructure: MarketStructureLTF;
  private config: MarketStructureConfig;
  private htfRangeTracker: ExternalRangeTracker;
  private itfRangeTracker: ExternalRangeTracker;
  private m5POIFinder: M5POIFinder;
  
  // Core SMC services for raw data access
  private htfSwingService: StructuralSwingService;
  private htfBosService: BosService;
  private htfChochService: ChochService;
  private itfSwingService: StructuralSwingService;
  private itfBosService: BosService;
  private itfChochService: ChochService;
  private m1SwingService: StructuralSwingService;
  private m1BosService: BosService;
  private m1ChochService: ChochService;

  constructor(
    marketDataService: MarketDataService,
    config: MarketStructureConfig
  ) {
    this.marketDataService = marketDataService;
    this.config = config;

    // Initialize market structure analyzers (for context/trend detection)
    this.htfStructure = new MarketStructureHTF(50, true);
    this.itfStructure = new MarketStructureITF(30, true);
    this.ltfStructure = new MarketStructureLTF(20, true);

    // Initialize core services for raw data access (for ExternalRangeTracker)
    this.htfSwingService = new StructuralSwingService(3);
    this.htfBosService = new BosService({
      bosLookbackSwings: 10,
      swingIndexLookback: 100,
      strictClose: true,
    });
    this.htfChochService = new ChochService();
    
    this.itfSwingService = new StructuralSwingService(3);
    this.itfBosService = new BosService({
      bosLookbackSwings: 10,
      swingIndexLookback: 50,
      strictClose: true,
    });
    this.itfChochService = new ChochService();
    
    // M1 services for micro structure analysis
    this.m1SwingService = new StructuralSwingService(3);
    this.m1BosService = new BosService({
      bosLookbackSwings: 5,
      swingIndexLookback: 20,
      strictClose: true,
    });
    this.m1ChochService = new ChochService();

    // Initialize range trackers
    this.htfRangeTracker = new ExternalRangeTracker();
    this.itfRangeTracker = new ExternalRangeTracker();

    // Initialize 5m POI finder
    this.m5POIFinder = new M5POIFinder();
  }

  /**
   * Generate signal using Market Structure Model
   */
  async generateSignal(symbol: string): Promise<MarketStructureSignalResult> {
    const debugReasons: string[] = [];

    try {
      // Load candles for all timeframes
      const [h4Candles, m15Candles, m5Candles, m1Candles] = await Promise.all([
        this.marketDataService.getRecentCandles(symbol, 'H4', 50),
        this.marketDataService.getRecentCandles(symbol, 'M15', 50),
        this.marketDataService.getRecentCandles(symbol, 'M5', 50),
        this.marketDataService.getRecentCandles(symbol, 'M1', 50),
      ]);

      if (h4Candles.length < 20) {
        debugReasons.push('Insufficient H4 candles');
        return { signal: null, reason: 'Insufficient data', debugReasons };
      }

      if (m15Candles.length < 20) {
        debugReasons.push('Insufficient M15 candles');
        return { signal: null, reason: 'Insufficient data', debugReasons };
      }

      if (m5Candles.length < 10) {
        debugReasons.push('Insufficient M5 candles');
        return { signal: null, reason: 'Insufficient data', debugReasons };
      }

      if (m1Candles.length < 10) {
        debugReasons.push('Insufficient M1 candles');
        return { signal: null, reason: 'Insufficient data', debugReasons };
      }

      // Convert to internal Candle format (with Date timestamps)
      const h4CandlesInternal = this.convertCandles(h4Candles, 'H4');
      const m15CandlesInternal = this.convertCandles(m15Candles, 'M15');
      const m5CandlesInternal = this.convertCandles(m5Candles, 'M5');
      const m1CandlesInternal = this.convertCandles(m1Candles, 'M1');

      // Step 1: Analyze H4 structure and get external range
      const htfContext = this.htfStructure.analyzeStructure(h4CandlesInternal);
      const htfRange = this.updateHTFRange(h4CandlesInternal, htfContext);
      const htfDirection: MSMDirection = htfContext.trend === 'sideways' ? 'sideways' : 
                                          htfContext.trend === 'bullish' ? 'bullish' : 'bearish';

      if (htfDirection === 'sideways') {
        debugReasons.push('HTF direction is sideways - no trade');
        return { 
          signal: null, 
          reason: 'HTF direction is sideways', 
          debugReasons,
          context: { htfDirection, htfRange }
        };
      }

      // Step 2: Analyze M15 structure and get external range
      const itfContext = this.itfStructure.analyzeStructure(
        m15CandlesInternal,
        htfDirection
      );
      const itfRange = this.updateITFRange(m15CandlesInternal, itfContext);
      const itfDirection: MSMDirection = itfContext.trend === 'sideways' ? 'sideways' :
                                         itfContext.trend === 'bullish' ? 'bullish' : 'bearish';

      // Step 3: Check alignment - HTF and ITF must align
      if (htfDirection !== itfDirection) {
        debugReasons.push(`Direction mismatch: HTF=${htfDirection}, ITF=${itfDirection}`);
        return {
          signal: null,
          reason: `HTF and ITF directions do not align: HTF=${htfDirection}, ITF=${itfDirection}`,
          debugReasons,
          context: { htfDirection, htfRange, itfDirection, itfRange },
        };
      }

      // Step 4: Determine ITF phase (expansion vs pullback)
      const itfPhase = this.determineITFPhase(
        m15CandlesInternal,
        itfRange,
        itfDirection,
        m15CandlesInternal[m15CandlesInternal.length - 1].close
      );

      if (itfPhase !== 'pullback') {
        debugReasons.push(`ITF is in ${itfPhase} phase, need pullback`);
        return {
          signal: null,
          reason: `ITF is in ${itfPhase} phase, strategy requires pullback`,
          debugReasons,
          context: { htfDirection, htfRange, itfDirection, itfRange, itfPhase },
        };
      }

      // Step 5: Find 5m POI in the appropriate zone (discount for bullish, premium for bearish)
      const currentPrice = m5CandlesInternal[m5CandlesInternal.length - 1].close;
      const setupZone = this.m5POIFinder.findSetupZone(
        m5CandlesInternal,
        itfDirection,
        itfRange,
        currentPrice
      );

      if (!setupZone) {
        debugReasons.push('No valid 5m POI found in target zone');
        return {
          signal: null,
          reason: 'No valid 5m POI (OB/FVG) found in target zone',
          debugReasons,
          context: { htfDirection, htfRange, itfDirection, itfRange, itfPhase },
        };
      }

      // Step 6: Analyze M1 structure for confirmation
      const m1Context = this.ltfStructure.analyzeStructure(
        m1CandlesInternal,
        itfDirection
      );

      // Check M1 micro trend and CHOCH/MSS
      const m1Analysis = this.analyzeM1Confirmation(
        m1CandlesInternal,
        m1Context,
        setupZone,
        itfDirection,
        currentPrice
      );

      if (!m1Analysis.isConfirmed) {
        debugReasons.push(`M1 confirmation failed: ${m1Analysis.reason}`);
        return {
          signal: null,
          reason: `M1 confirmation failed: ${m1Analysis.reason}`,
          debugReasons,
          context: {
            htfDirection,
            htfRange,
            itfDirection,
            itfRange,
            itfPhase,
            setupZone,
            m1MicroTrend: m1Analysis.microTrend,
          },
        };
      }

      // Step 7: Build entry, SL, TP
      const signal = this.buildSignal(
        symbol,
        itfDirection,
        setupZone,
        itfRange,
        currentPrice,
        m5CandlesInternal
      );

      if (!signal) {
        debugReasons.push('Signal build failed (likely R:R too low)');
        return {
          signal: null,
          reason: 'Signal build failed - R:R below minimum',
          debugReasons,
          context: {
            htfDirection,
            htfRange,
            itfDirection,
            itfRange,
            itfPhase,
            setupZone,
            m1MicroTrend: m1Analysis.microTrend,
          },
        };
      }

      logger.info(`[MSM] Signal generated for ${symbol}: ${signal.direction} @ ${signal.entry}, SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`);

      return {
        signal,
        reason: 'Market Structure setup confirmed',
        debugReasons,
        context: {
          htfDirection,
          htfRange,
          itfDirection,
          itfRange,
          itfPhase,
          setupZone,
          m1MicroTrend: m1Analysis.microTrend,
          m1LastChoch: m1Analysis.lastChoch,
          m1LastBos: m1Analysis.lastBos,
        },
      };
    } catch (error) {
      logger.error(`[MSM] Error generating signal for ${symbol}:`, error);
      return {
        signal: null,
        reason: `Error: ${error instanceof Error ? error.message : String(error)}`,
        debugReasons,
      };
    }
  }

  /**
   * Update H4 external range using range tracker
   */
  private updateHTFRange(
    candles: Candle[],
    context: any
  ): ExternalRange {
    // Use core services directly to get raw swings and events
    const structuralSwings = this.htfSwingService.detectStructuralSwings(candles);
    
    // Convert structural swings to SwingPoint format
    const swings: SwingPoint[] = structuralSwings.map(s => ({
      index: s.index,
      type: s.type,
      price: s.price,
      timestamp: s.timestamp,
    }));

    // Detect BOS and CHOCH using core services
    const bosEvents = this.htfBosService.detectBOS(candles, swings);
    const chochEvents = this.htfChochService.detectChoCh(candles, swings, bosEvents);

    const currentClose = candles[candles.length - 1]?.close || 0;
    const currentIndex = candles.length - 1;

    this.htfRangeTracker.updateRange({
      swings,
      bosEvents,
      chochEvents,
      currentClose,
      currentIndex,
    });

    return this.htfRangeTracker.getCurrentRange() || {
      direction: 'sideways',
      swingHigh: null,
      swingLow: null,
      lastUpdateIndex: currentIndex,
    };
  }

  /**
   * Update M15 external range using range tracker
   */
  private updateITFRange(
    candles: Candle[],
    context: any
  ): ExternalRange {
    // Use core services directly to get raw swings and events
    const structuralSwings = this.itfSwingService.detectStructuralSwings(candles);
    
    // Convert structural swings to SwingPoint format
    const swings: SwingPoint[] = structuralSwings.map(s => ({
      index: s.index,
      type: s.type,
      price: s.price,
      timestamp: s.timestamp,
    }));

    // Detect BOS and CHOCH using core services
    const bosEvents = this.itfBosService.detectBOS(candles, swings);
    const chochEvents = this.itfChochService.detectChoCh(candles, swings, bosEvents);

    const currentClose = candles[candles.length - 1]?.close || 0;
    const currentIndex = candles.length - 1;

    this.itfRangeTracker.updateRange({
      swings,
      bosEvents,
      chochEvents,
      currentClose,
      currentIndex,
    });

    return this.itfRangeTracker.getCurrentRange() || {
      direction: 'sideways',
      swingHigh: null,
      swingLow: null,
      lastUpdateIndex: currentIndex,
    };
  }

  /**
   * Determine ITF phase (expansion vs pullback).
   *
   * Logic: use the last 5 candles' direction to detect whether price is currently
   * moving WITH the trend (expansion) or AGAINST it (pullback).
   * Additionally require price to be inside the range (not extended beyond it) for expansion,
   * and within the discount/premium zone for pullback entries.
   */
  private determineITFPhase(
    candles: Candle[],
    range: ExternalRange,
    direction: MSMDirection,
    currentPrice: number
  ): StructurePhase {
    if (!range.swingLow || !range.swingHigh) {
      return 'unknown';
    }

    if (candles.length < 5) {
      return 'unknown';
    }

    // Determine recent price momentum from the last 5 candles
    const lookback = candles.slice(-5);
    const recentMove = lookback[lookback.length - 1].close - lookback[0].close;

    const rangeSize = range.swingHigh - range.swingLow;
    if (rangeSize <= 0) return 'unknown';

    // For a pullback we need:
    // Bullish trend: recent move is DOWN (price retracing toward swingLow)
    //   and price is still inside the range (above swingLow), ideally in discount zone (lower 50%)
    // Bearish trend: recent move is UP (price retracing toward swingHigh)
    //   and price is still inside the range (below swingHigh), ideally in premium zone (upper 50%)
    if (direction === 'bullish') {
      const inRange = currentPrice > range.swingLow && currentPrice < range.swingHigh;
      if (recentMove < 0 && inRange) {
        return 'pullback';
      }
      return 'expansion';
    } else {
      const inRange = currentPrice > range.swingLow && currentPrice < range.swingHigh;
      if (recentMove > 0 && inRange) {
        return 'pullback';
      }
      return 'expansion';
    }
  }

  /**
   * Analyze M1 confirmation (micro trend flip via CHOCH/MSS)
   */
  private analyzeM1Confirmation(
    m1Candles: Candle[],
    m1Context: any,
    setupZone: MSMSetupZone,
    itfDirection: MSMDirection,
    currentPrice: number
  ): {
    isConfirmed: boolean;
    reason: string;
    microTrend: MicroTrend;
    lastChoch: ChoChEvent | null;
    lastBos: BosEvent | null;
  } {
    // Check if price is in or near the setup zone
    const inZone = currentPrice >= setupZone.priceMin && currentPrice <= setupZone.priceMax;

    if (!inZone && Math.abs(currentPrice - setupZone.priceMax) > setupZone.priceMax * 0.002) {
      return {
        isConfirmed: false,
        reason: 'Price not in setup zone',
        microTrend: 'unknown',
        lastChoch: null,
        lastBos: null,
      };
    }

    // Get M1 swings and events using core services directly
    const m1StructuralSwings = this.m1SwingService.detectStructuralSwings(m1Candles);
    const m1Swings: SwingPoint[] = m1StructuralSwings.map(s => ({
      index: s.index,
      type: s.type,
      price: s.price,
      timestamp: s.timestamp,
    }));
    
    const m1BosEvents = this.m1BosService.detectBOS(m1Candles, m1Swings);
    const m1ChochEvents = this.m1ChochService.detectChoCh(m1Candles, m1Swings, m1BosEvents);
    
    // Get recent swings for micro trend analysis
    const recentSwings = m1Swings.slice(-this.config.m1LookbackSwings);
    
    // Determine micro trend before POI reaction
    const microTrend = this.determineMicroTrend(recentSwings, m1BosEvents);

    // Check for CHOCH/MSS in the setup zone
    const recentChoch = m1ChochEvents.length > 0 ? m1ChochEvents[m1ChochEvents.length - 1] : null;
    const recentBos = m1BosEvents.length > 0 ? m1BosEvents[m1BosEvents.length - 1] : null;

    if (itfDirection === 'bearish') {
      // For bearish trade, we need:
      // 1. Prior microTrend = bullish (counter to HTF/ITF)
      // 2. CHOCH down or MSS down at/near POI
      if (microTrend !== 'bullish') {
        return {
          isConfirmed: false,
          reason: `M1 micro trend is ${microTrend}, need bullish before POI`,
          microTrend,
          lastChoch: recentChoch || null,
          lastBos: recentBos || null,
        };
      }

      // Check for CHOCH down
      if (recentChoch && recentChoch.toTrend === 'bearish') {
        // Verify it happened near the POI
        const chochPrice = recentChoch.level;
        if (Math.abs(chochPrice - setupZone.structuralExtreme) < setupZone.structuralExtreme * 0.003) {
          return {
            isConfirmed: true,
            reason: 'M1 CHOCH down confirmed at POI',
            microTrend,
            lastChoch: recentChoch,
            lastBos: recentBos || null,
          };
        }
      }

      // Check for MSS (CHOCH + follow-up BOS down)
      if (recentBos && recentBos.direction === 'bearish' && recentChoch) {
        const bosPrice = recentBos.level;
        if (Math.abs(bosPrice - setupZone.structuralExtreme) < setupZone.structuralExtreme * 0.003) {
          return {
            isConfirmed: true,
            reason: 'M1 MSS down confirmed at POI',
            microTrend,
            lastChoch: recentChoch,
            lastBos: recentBos,
          };
        }
      }

      return {
        isConfirmed: false,
        reason: 'No M1 CHOCH/MSS down found at POI',
        microTrend,
        lastChoch: recentChoch || null,
        lastBos: recentBos || null,
      };
    } else {
      // Bullish trade - mirror logic
      if (microTrend !== 'bearish') {
        return {
          isConfirmed: false,
          reason: `M1 micro trend is ${microTrend}, need bearish before POI`,
          microTrend,
          lastChoch: recentChoch || null,
          lastBos: recentBos || null,
        };
      }

      if (recentChoch && recentChoch.toTrend === 'bullish') {
        const chochPrice = recentChoch.level;
        if (Math.abs(chochPrice - setupZone.structuralExtreme) < setupZone.structuralExtreme * 0.003) {
          return {
            isConfirmed: true,
            reason: 'M1 CHOCH up confirmed at POI',
            microTrend,
            lastChoch: recentChoch,
            lastBos: recentBos || null,
          };
        }
      }

      if (recentBos && recentBos.direction === 'bullish' && recentChoch) {
        const bosPrice = recentBos.level;
        if (Math.abs(bosPrice - setupZone.structuralExtreme) < setupZone.structuralExtreme * 0.003) {
          return {
            isConfirmed: true,
            reason: 'M1 MSS up confirmed at POI',
            microTrend,
            lastChoch: recentChoch,
            lastBos: recentBos,
          };
        }
      }

      return {
        isConfirmed: false,
        reason: 'No M1 CHOCH/MSS up found at POI',
        microTrend,
        lastChoch: recentChoch || null,
        lastBos: recentBos || null,
      };
    }
  }

  /**
   * Determine micro trend from recent M1 swings and BOS events
   */
  private determineMicroTrend(
    swings: any[],
    bosEvents: any[]
  ): MicroTrend {
    if (swings.length < 2) {
      return 'unknown';
    }

    // Analyze recent BOS direction
    const recentBOS = bosEvents.slice(-3);
    if (recentBOS.length === 0) {
      return 'unknown';
    }

    const bullishBOS = recentBOS.filter(e => e.direction === 'bullish').length;
    const bearishBOS = recentBOS.filter(e => e.direction === 'bearish').length;

    // Check swing pattern
    const highs = swings.filter(s => s.type === 'high').slice(-2);
    const lows = swings.filter(s => s.type === 'low').slice(-2);

    if (highs.length >= 2 && lows.length >= 2) {
      const isHH = highs[1].price > highs[0].price;
      const isHL = lows[1].price > lows[0].price;
      const isLH = highs[1].price < highs[0].price;
      const isLL = lows[1].price < lows[0].price;

      if ((isHH && isHL) || bullishBOS > bearishBOS) {
        return 'bullish';
      }
      if ((isLH && isLL) || bearishBOS > bullishBOS) {
        return 'bearish';
      }
    }

    return 'unknown';
  }

  /**
   * Build final signal with entry, SL, TP
   */
  private buildSignal(
    symbol: string,
    direction: MSMDirection,
    setupZone: MSMSetupZone,
    itfRange: ExternalRange,
    currentPrice: number,
    m5Candles: Candle[]
  ): EnhancedRawSignalV2 | null {
    // Calculate pip value for SL buffer
    const pipValue = this.getPipValue(symbol, currentPrice);
    const slBufferPips = this.config.slBufferPips;
    const slBufferPrice = slBufferPips * pipValue;

    // Entry: use middle of setup zone or current price if in zone
    let entryPrice: number;
    if (currentPrice >= setupZone.priceMin && currentPrice <= setupZone.priceMax) {
      entryPrice = currentPrice;
    } else {
      entryPrice = (setupZone.priceMin + setupZone.priceMax) / 2;
    }

    // Stop Loss: based on 5m structural extreme
    let stopLoss: number;
    if (direction === 'bearish') {
      // Short: SL above structural extreme
      stopLoss = setupZone.structuralExtreme + slBufferPrice;
    } else {
      // Long: SL below structural extreme
      stopLoss = setupZone.structuralExtreme - slBufferPrice;
    }

    // Take Profit: 15m external swing
    let takeProfit: number;
    if (direction === 'bearish') {
      if (!itfRange.swingLow) {
        return null; // Cannot set TP without swing low
      }
      takeProfit = itfRange.swingLow;
    } else {
      if (!itfRange.swingHigh) {
        return null; // Cannot set TP without swing high
      }
      takeProfit = itfRange.swingHigh;
    }

    // Calculate Risk:Reward ratio
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const rr = reward / risk;

    if (rr < this.config.minRR) {
      logger.debug(`[MSM] R:R ${rr.toFixed(2)} below minimum ${this.config.minRR}`);
      return null;
    }

    // Build signal (EnhancedRawSignalV2 format)
    return {
      symbol,
      direction: direction === 'bullish' ? 'buy' : 'sell',
      entry: entryPrice,
      stopLoss,
      takeProfit,
      orderKind: 'limit' as const, // Use limit order for POI entry
      htfTrend: direction === 'bullish' ? 'bullish' : 'bearish',
      itfFlow: 'aligned',
      ltfBOS: true,
      premiumDiscount: direction === 'bullish' ? 'discount' : 'premium',
      obLevels: {},
      fvgLevels: {},
      smt: { bullish: false, bearish: false },
      volumeImbalance: { zones: [], aligned: false },
      ltfFVGResolved: false,
      ltfSweepConfirmed: setupZone.hasLiquiditySweep,
      sessionValid: true,
      confluenceReasons: [`MSM ${direction} setup: 5m POI at ${setupZone.refType}, R:R ${rr.toFixed(2)}`],
      confluenceScore: Math.min(100, Math.round(rr * 20)),
      timestamp: new Date().toISOString(),
      meta: {
        strategyId: 'market_structure_v1',
        msmSetupZone: setupZone,
        msmRR: rr,
        msmItfRange: itfRange,
      },
    };
  }

  /**
   * Get pip value for symbol (simplified)
   */
  private getPipValue(symbol: string, price: number): number {
    // Simplified pip calculation
    if (symbol.includes('XAU') || symbol.includes('GOLD')) {
      return 0.01; // Gold: 1 pip = 0.01
    }
    if (symbol.includes('US30') || symbol.includes('DJI')) {
      return 0.1; // Indices: 1 pip = 0.1
    }
    return 0.0001; // Forex: 1 pip = 0.0001
  }

  /**
   * Convert Candle[] from MarketDataService format to internal Candle format
   * MarketDataService may return either format, so we handle both
   */
  private convertCandles(candles: any[], timeframe: string = 'M1'): Candle[] {
    const tfMs = this.getTimeframeMs(timeframe);
    return candles.map((c, idx) => {
      // Check if it's already in marketData format (has startTime/endTime)
      if (c.startTime && c.endTime) {
        return {
          symbol: c.symbol || '',
          timeframe: (c.timeframe || timeframe) as any,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0,
          startTime: c.startTime instanceof Date ? c.startTime : new Date(c.startTime),
          endTime: c.endTime instanceof Date ? c.endTime : new Date(c.endTime),
        };
      }

      // Otherwise convert from types/index.ts format (has timestamp string)
      const timestamp = c.timestamp ? new Date(c.timestamp) : new Date(Date.now() - (candles.length - idx - 1) * tfMs);
      return {
        symbol: c.symbol || '',
        timeframe: (c.timeframe || timeframe) as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        startTime: timestamp,
        endTime: new Date(timestamp.getTime() + tfMs),
      };
    });
  }

  /** Return candle duration in milliseconds for a given timeframe string */
  private getTimeframeMs(timeframe: string): number {
    const map: Record<string, number> = {
      M1: 60_000,
      M5: 300_000,
      M15: 900_000,
      M30: 1_800_000,
      H1: 3_600_000,
      H4: 14_400_000,
      D1: 86_400_000,
    };
    return map[timeframe] ?? 60_000;
  }
}

