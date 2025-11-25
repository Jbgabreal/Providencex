import { Logger } from '@providencex/shared-utils';
import { MarketDataService } from './MarketDataService';
import { getConfig } from '../config';
import {
  TradeSignal,
  TrendDirection,
  Candle,
  MarketStructure,
  OrderBlock,
  Timeframe,
} from '../types';
import { SMCStrategyV2 } from '../strategy/v2/SMCStrategyV2';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';

const logger = new Logger('StrategyService');

/**
 * StrategyService - Implements SMC v1 logic with optional v2 support
 * HTF trend detection, LTF structure, Order Blocks, and liquidity sweeps (v1)
 * Multi-timeframe confluence with FVG, Premium/Discount, SMT, etc. (v2)
 */
export class StrategyService {
  private marketDataService: MarketDataService;
  private config = getConfig();
  private marketStructures: Map<string, MarketStructure> = new Map();
  private lastStrategyError: string | null = null;
  private lastSmcReason: string | null = null; // Store last SMC rejection reason
  private lastSmcDebugReasons: string[] = []; // Store last SMC debug reasons
  private smcV2?: SMCStrategyV2; // Lazy initialization

  constructor(
    marketDataService: MarketDataService,
    paramOverrides?: import('../optimization/OptimizationTypes').SMC_V2_ParamSet
  ) {
    this.marketDataService = marketDataService;
    
    // Initialize SMC v2 if enabled
    if (this.config.useSMCV2) {
      // ICT Model: Use H4 for bias when USE_ICT_MODEL is enabled, otherwise use M15
      const useICTModel = process.env.USE_ICT_MODEL === 'true';
      const htfTF = useICTModel ? 'H4' : 'M15';
      const itfTF = useICTModel ? 'M15' : 'M15';
      
      this.smcV2 = new SMCStrategyV2(marketDataService, {
        enabled: true,
        htfTimeframe: htfTF, // H4 for ICT model bias, M15 for old SMC v2
        itfTimeframe: itfTF, // M15 for setup
        ltfTimeframe: 'M1', // LTF is 1m for entry confirmation
        paramOverrides: paramOverrides, // v11: Pass parameter overrides
      });
      
      if (useICTModel) {
        logger.info(`[StrategyService] ICT Model ENABLED - Using H4 for bias, M15 for setup, M1 for entry`);
      }
      logger.info('[StrategyService] SMC v2 enabled - using EnhancedRawSignalV2');
      if (paramOverrides) {
        logger.info('[StrategyService] Parameter overrides applied for optimization');
      }
    } else {
      logger.info('[StrategyService] SMC v1 enabled - using TradeSignal');
    }
  }

  /**
   * Generate signal - uses v2 if enabled, otherwise v1
   */
  async generateSignal(symbol: string): Promise<TradeSignal | null> {
    // Reset reason state for new evaluation
    this.lastSmcReason = null;
    this.lastSmcDebugReasons = [];
    
    // If SMC v2 is enabled, use it
    if (this.config.useSMCV2 && this.smcV2) {
      // Call with includeReasons=true to get detailed rejection reasons
      const result = await this.smcV2.generateEnhancedSignal(symbol, true);
      
      if (result.signal === null) {
        // Store rejection reason for DecisionLogger
        this.lastSmcReason = result.reason || 'No valid SMC setup found';
        this.lastSmcDebugReasons = result.debugReasons || [];
        return null;
      }
      
      // Store success (clear any previous rejection)
      this.lastSmcReason = null;
      this.lastSmcDebugReasons = [];
      
      // Convert EnhancedRawSignalV2 to TradeSignal for backward compatibility
      return this.convertV2ToV1Signal(result.signal);
    }
    
    // Otherwise, use SMC v1 logic
    return await this.generateSignalV1(symbol);
  }

  /**
   * Get last SMC rejection reason (for DecisionLogger)
   */
  getLastSmcReason(): string | null {
    return this.lastSmcReason;
  }

  /**
   * Get last SMC debug reasons (for DecisionLogger)
   */
  getLastSmcDebugReasons(): string[] {
    return this.lastSmcDebugReasons;
  }

  /**
   * Get metrics summary from SMC v2 strategy (for backtesting/debugging)
   */
  getMetricsSummary() {
    if (this.smcV2) {
      return this.smcV2.getMetricsSummary();
    }
    return null;
  }

  /**
   * Log metrics summary from SMC v2 strategy (for backtesting/debugging)
   */
  logMetricsSummary() {
    if (this.smcV2) {
      this.smcV2.logMetricsSummary();
    }
  }

  /**
   * Reset metrics in SMC v2 strategy (for backtesting)
   */
  resetMetrics() {
    if (this.smcV2) {
      this.smcV2.resetMetrics();
    }
  }

  /**
   * Generate signal using SMC v1 logic (original implementation)
   */
  private async generateSignalV1(symbol: string): Promise<TradeSignal | null> {
    // Reset error state
    this.lastStrategyError = null;
    
    const htfTimeframe = this.config.smcTimeframes.htf;
    const ltfTimeframe = this.config.smcTimeframes.ltf;
    const strategy = 'low'; // Default strategy for signal generation

    try {
      logger.debug(`Generating signal for ${symbol}`);

      // Step 1: Get HTF candles (H1)
      const htfCandles = await this.marketDataService.getRecentCandles(
        symbol,
        htfTimeframe as Timeframe,
        100
      );

      if (htfCandles.length < 20) {
        logger.debug(`${symbol}: Insufficient HTF candles (${htfCandles.length} < 20)`);
        return null; // Normal case: no setup available
      }

      // Step 2: Determine HTF trend
      const htfTrend = this.determineHTFTrend(htfCandles);
      logger.debug(`${symbol}: HTF trend = ${htfTrend}`);

      // Fail-safe: No trade if HTF is sideways
      if (htfTrend === 'sideways') {
        logger.debug(`${symbol}: HTF trend is sideways - skipping`);
        return null; // Normal case: no setup available
      }

      // Step 3: Get LTF candles (M5)
      const ltfCandles = await this.marketDataService.getRecentCandles(
        symbol,
        ltfTimeframe as Timeframe,
        100
      );

      if (ltfCandles.length < 20) {
        logger.debug(`${symbol}: Insufficient LTF candles (${ltfCandles.length} < 20)`);
        return null; // Normal case: no setup available
      }

      // Step 4: Check for BOS/CHoCH on LTF aligned with HTF trend
      const structureBreak = this.detectStructureBreak(ltfCandles, htfTrend);
      if (!structureBreak) {
        logger.debug(`${symbol}: No valid BOS/CHoCH aligned with HTF trend`);
        return null; // Normal case: no setup available
      }

      // Step 5: Identify Order Block
      const orderBlock = this.identifyOrderBlock(ltfCandles, structureBreak.index, htfTrend);
      if (!orderBlock || orderBlock.mitigated) {
        logger.debug(`${symbol}: No valid unmitigated Order Block found`);
        return null; // Normal case: no setup available
      }

      // Step 6: Check for liquidity sweep
      const liquiditySwept = this.checkLiquiditySweep(ltfCandles, structureBreak.index, htfTrend);
      if (!liquiditySwept) {
        logger.debug(`${symbol}: Liquidity sweep not confirmed`);
        return null; // Normal case: no setup available
      }

      // Step 7: Generate trade signal
      const currentPrice = await this.marketDataService.getCurrentPrice(symbol);
      const signal = this.buildTradeSignal(
        symbol,
        htfTrend,
        orderBlock,
        currentPrice,
        structureBreak,
        liquiditySwept // Pass liquiditySwept as parameter
      );

      if (!signal) {
        logger.debug(`${symbol}: Failed to build valid trade signal`);
        return null; // Normal case: validation failed
      }

      logger.info(
        `${symbol}: Signal generated - ${signal.direction} @ ${signal.entry}, SL: ${signal.stopLoss}, TP: ${signal.takeProfit}`
      );

      // Log RawSignal structure for v3 debugging (signal contains all needed metadata)
      logger.debug('[StrategyService] Built TradeSignal with v3 metadata', {
        symbol,
        strategy,
        direction: signal.direction,
        entryPrice: signal.entry,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        htfTrend: signal.meta?.htf_trend,
        liquiditySwept: signal.meta?.liquiditySwept,
        displacementCandle: signal.meta?.displacementCandle,
        hasOrderBlock: !!signal.meta?.orderBlockZone,
        hasBOS: !!signal.meta?.lastBosDirection,
      });

      return signal;
    } catch (error) {
      // Internal error occurred - log with full structured context
      const errorObj = error as Error;
      const errorMessage = errorObj?.message || String(error) || 'Unknown error';
      
      this.lastStrategyError = errorMessage;

      // Build structured error log payload
      const errorContext = {
        symbol,
        strategy,
        htfTimeframe,
        ltfTimeframe,
        errorMessage,
        stack: errorObj?.stack || undefined,
        // Include raw error only if it's serializable
        rawError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : { value: String(error) },
      };

      logger.error(
        `[StrategyService] Error generating signal for ${symbol}: ${errorMessage}`,
        errorContext
      );

      // Return null - caller will check lastStrategyError to distinguish from "no setup"
      return null;
    }
  }

  /**
   * Get the last strategy error message (if any)
   * Returns null if no error occurred in the last generateSignal call
   */
  getLastStrategyError(): string | null {
    return this.lastStrategyError;
  }

  /**
   * Determine HTF trend using HH/HL (bullish) or LH/LL (bearish) structure
   */
  private determineHTFTrend(candles: Candle[]): TrendDirection {
    if (candles.length < 10) {
      return 'sideways';
    }

    // Find swing highs and lows (simplified: use local maxima/minima)
    const swingHighs: number[] = [];
    const swingLows: number[] = [];

    for (let i = 2; i < candles.length - 2; i++) {
      const candle = candles[i];
      // Local high (higher than neighbors)
      if (
        candle.high > candles[i - 1].high &&
        candle.high > candles[i - 2].high &&
        candle.high > candles[i + 1].high &&
        candle.high > candles[i + 2].high
      ) {
        swingHighs.push(candle.high);
      }
      // Local low (lower than neighbors)
      if (
        candle.low < candles[i - 1].low &&
        candle.low < candles[i - 2].low &&
        candle.low < candles[i + 1].low &&
        candle.low < candles[i + 2].low
      ) {
        swingLows.push(candle.low);
      }
    }

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return 'sideways';
    }

    // Check for bullish structure: Higher Highs (HH) and Higher Lows (HL)
    const recentHighs = swingHighs.slice(-2);
    const recentLows = swingLows.slice(-2);
    const isHH = recentHighs[1] > recentHighs[0];
    const isHL = recentLows[1] > recentLows[0];

    // Check for bearish structure: Lower Highs (LH) and Lower Lows (LL)
    const isLH = recentHighs[1] < recentHighs[0];
    const isLL = recentLows[1] < recentLows[0];

    if (isHH && isHL) {
      return 'bullish';
    } else if (isLH && isLL) {
      return 'bearish';
    }

    return 'sideways';
  }

  /**
   * Detect BOS (Break of Structure) or CHoCH (Change of Character) on LTF
   * Must be aligned with HTF trend direction
   */
  private detectStructureBreak(
    candles: Candle[],
    htfTrend: TrendDirection
  ): { index: number; type: 'BOS' | 'CHoCH'; price: number } | null {
    if (candles.length < 10) {
      return null;
    }

    // Find recent structure break aligned with HTF trend
    // Simplified: Look for strong breakout in the last 10 candles
    const recentCandles = candles.slice(-20);
    const previousHigh = Math.max(...recentCandles.slice(0, 10).map((c) => c.high));
    const previousLow = Math.min(...recentCandles.slice(0, 10).map((c) => c.low));

    // Check recent candles for break
    for (let i = 10; i < recentCandles.length; i++) {
      const candle = recentCandles[i];

      // Bullish break (aligned with bullish HTF trend)
      if (htfTrend === 'bullish' && candle.close > previousHigh && candle.close > candle.open) {
        return {
          index: candles.length - (recentCandles.length - i),
          type: 'BOS',
          price: candle.close,
        };
      }

      // Bearish break (aligned with bearish HTF trend)
      if (htfTrend === 'bearish' && candle.close < previousLow && candle.close < candle.open) {
        return {
          index: candles.length - (recentCandles.length - i),
          type: 'BOS',
          price: candle.close,
        };
      }
    }

    return null;
  }

  /**
   * Identify Order Block (OB) - last opposite candle before structure break
   */
  private identifyOrderBlock(
    candles: Candle[],
    breakIndex: number,
    htfTrend: TrendDirection
  ): OrderBlock | null {
    if (breakIndex < 5 || breakIndex >= candles.length) {
      return null;
    }

    // Look backwards from break for the last opposite candle
    const lookbackCandles = candles.slice(Math.max(0, breakIndex - 10), breakIndex);

    if (lookbackCandles.length === 0) {
      return null;
    }

    // For bullish: find last down candle before break
    // For bearish: find last up candle before break
    let obIndex = -1;
    for (let i = lookbackCandles.length - 1; i >= 0; i--) {
      const candle = lookbackCandles[i];
      const isDown = candle.close < candle.open;
      const isUp = candle.close > candle.open;

      if (htfTrend === 'bullish' && isDown) {
        obIndex = breakIndex - (lookbackCandles.length - i);
        break;
      } else if (htfTrend === 'bearish' && isUp) {
        obIndex = breakIndex - (lookbackCandles.length - i);
        break;
      }
    }

    if (obIndex < 0 || obIndex >= candles.length) {
      return null;
    }

    const obCandle = candles[obIndex];

    // Check if OB is mitigated (price has moved through it)
    const mitigated = this.isOrderBlockMitigated(candles, obIndex, htfTrend);

    return {
      type: htfTrend === 'bullish' ? 'bullish' : 'bearish',
      high: obCandle.high,
      low: obCandle.low,
      timestamp: obCandle.timestamp,
      timeframe: this.config.smcTimeframes.ltf as Timeframe,
      mitigated,
    };
  }

  /**
   * Check if Order Block has been mitigated
   */
  private isOrderBlockMitigated(
    candles: Candle[],
    obIndex: number,
    htfTrend: TrendDirection
  ): boolean {
    if (obIndex < 0 || obIndex >= candles.length) {
      return true;
    }

    const obCandle = candles[obIndex];
    const subsequentCandles = candles.slice(obIndex + 1);

    // Check if price moved through the OB
    for (const candle of subsequentCandles) {
      // Bullish OB: mitigated if price closed below OB low
      if (htfTrend === 'bullish' && candle.close < obCandle.low) {
        return true;
      }
      // Bearish OB: mitigated if price closed above OB high
      if (htfTrend === 'bearish' && candle.close > obCandle.high) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check for liquidity sweep before OB revisit
   */
  private checkLiquiditySweep(
    candles: Candle[],
    breakIndex: number,
    htfTrend: TrendDirection
  ): boolean {
    if (breakIndex < 5 || breakIndex >= candles.length) {
      return false;
    }

    // Before the break, check if price swept previous swing
    const preBreakCandles = candles.slice(Math.max(0, breakIndex - 15), breakIndex);

    if (preBreakCandles.length < 5) {
      return false;
    }

    // Find previous swing
    const swingHigh = Math.max(...preBreakCandles.slice(0, 8).map((c) => c.high));
    const swingLow = Math.min(...preBreakCandles.slice(0, 8).map((c) => c.low));

    // Check if price swept before breaking
    for (let i = 8; i < preBreakCandles.length; i++) {
      const candle = preBreakCandles[i];

      // Bullish: sweep low then break high
      if (htfTrend === 'bullish') {
        if (candle.low < swingLow && candle.close > swingHigh) {
          return true;
        }
      }

      // Bearish: sweep high then break low
      if (htfTrend === 'bearish') {
        if (candle.high > swingHigh && candle.close < swingLow) {
          return true;
        }
      }
    }

    // Simplified: If we found a structure break, assume liquidity was swept
    // In production, this should be more precise
    return true;
  }

  /**
   * Build trade signal from SMC setup
   */
  private buildTradeSignal(
    symbol: string,
    trend: TrendDirection,
    orderBlock: OrderBlock,
    currentPrice: number,
    structureBreak: { index: number; type: string; price: number },
    liquiditySwept: boolean
  ): TradeSignal | null {
    if (trend === 'sideways') {
      return null;
    }

    // Entry: Current price (or slightly better if order block revisited)
    const entry = currentPrice;

    // Stop Loss: Opposite side of Order Block
    const stopLoss = trend === 'bullish' ? orderBlock.low : orderBlock.high;

    // Take Profit: Fixed 1:2 RR (Risk:Reward ratio)
    const risk = Math.abs(entry - stopLoss);
    const takeProfit =
      trend === 'bullish' ? entry + risk * 2 : entry - risk * 2;

    // Validate setup
    if (risk <= 0) {
      return null;
    }

    // Reason for trade
    const reason = `SMC v1: ${trend} HTF trend, ${structureBreak.type} on LTF, OB at ${orderBlock.low}-${orderBlock.high}, liquidity swept`;

      return {
        symbol,
        direction: trend === 'bullish' ? 'buy' : 'sell',
        entry,
        stopLoss,
        takeProfit,
        reason,
        meta: {
          htf_trend: trend,
          order_block: orderBlock,
          structure_break: structureBreak,
          risk_reward_ratio: 2.0,
          // v3 metadata for execution filter
          liquiditySwept: liquiditySwept,
          liquiditySweep: liquiditySwept, // Alias for compatibility
          displacementCandle: true, // Assume true if structure break detected (can be refined)
          orderBlockZone: {
            high: orderBlock.high,
            low: orderBlock.low,
            upper: orderBlock.high,
            lower: orderBlock.low,
            type: orderBlock.type === 'bullish' ? 'demand' : 'supply',
            timeframe: this.config.smcTimeframes.ltf,
          },
          // Map structure break type to BOS/CHOCH direction
          lastBosDirection: structureBreak.type?.toUpperCase().includes('BOS') 
            ? (trend === 'bullish' ? 'up' : 'down')
            : (structureBreak.type?.toUpperCase().includes('BREAKOUT') ? (trend === 'bullish' ? 'up' : 'down') : undefined),
          lastChochDirection: structureBreak.type?.toUpperCase().includes('CHOCH') || structureBreak.type?.toUpperCase().includes('CHANGE')
            ? (trend === 'bullish' ? 'up' : 'down')
            : undefined,
          ltfStructure: 'impulsive', // Assume impulsive if structure break found
        },
      };
  }

  /**
   * Convert EnhancedRawSignalV2 to TradeSignal for backward compatibility
   */
  private convertV2ToV1Signal(v2Signal: EnhancedRawSignalV2): TradeSignal {
    return {
      symbol: v2Signal.symbol,
      direction: v2Signal.direction,
      entry: v2Signal.entry,
      stopLoss: v2Signal.stopLoss,
      takeProfit: v2Signal.takeProfit,
      reason: `SMC v2: ${v2Signal.confluenceReasons.join('; ')}`,
      meta: {
        htfTrend: v2Signal.htfTrend,
        premiumDiscount: v2Signal.premiumDiscount,
        itfFlow: v2Signal.itfFlow,
        ltfBOS: v2Signal.ltfBOS,
        confluenceScore: v2Signal.confluenceScore,
        confluenceReasons: v2Signal.confluenceReasons,
        obLevels: v2Signal.obLevels,
        fvgLevels: v2Signal.fvgLevels,
        smt: v2Signal.smt,
        liquiditySweepData: v2Signal.liquiditySweep,
        volumeImbalance: v2Signal.volumeImbalance,
        sessionValid: v2Signal.sessionValid,
        session: v2Signal.session,
        // Legacy v1/v3 metadata for compatibility
        liquiditySwept: !!v2Signal.liquiditySweep,
        liquiditySweep: !!v2Signal.liquiditySweep,
        displacementCandle: v2Signal.ltfBOS,
        orderBlockZone: v2Signal.obLevels.htf ? {
          high: v2Signal.obLevels.htf.high,
          low: v2Signal.obLevels.htf.low,
          upper: v2Signal.obLevels.htf.high,
          lower: v2Signal.obLevels.htf.low,
          type: v2Signal.obLevels.htf.type === 'bullish' ? 'demand' : 'supply',
          timeframe: 'HTF',
        } : undefined,
        lastBosDirection: v2Signal.htfTrend === 'bullish' ? 'up' : 'down',
        ltfStructure: v2Signal.ltfBOS ? 'impulsive' : 'corrective',
        // v2 specific metadata
        smcVersion: 'v2',
        enhancedSignal: v2Signal,
      },
    };
  }

  /**
   * Generate enhanced signal (v2) - returns EnhancedRawSignalV2 directly
   */
  async generateEnhancedSignal(symbol: string): Promise<EnhancedRawSignalV2 | null> {
    if (!this.config.useSMCV2 || !this.smcV2) {
      logger.warn(`[StrategyService] generateEnhancedSignal called but SMC v2 is disabled`);
      this.lastSmcReason = 'SMC v2 disabled';
      return null;
    }
    
    // Call with includeReasons=true to capture rejection reasons
    const result = await this.smcV2.generateEnhancedSignal(symbol, true);
    
    // Store rejection reason if null
    if (result.signal === null) {
      this.lastSmcReason = result.reason || 'No valid SMC setup found';
      this.lastSmcDebugReasons = result.debugReasons || [];
      return null;
    }
    
    // Clear rejection reasons on success
    this.lastSmcReason = null;
    this.lastSmcDebugReasons = [];
    
    return result.signal;
  }
}
