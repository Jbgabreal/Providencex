/**
 * GodSmcStrategy - FROZEN Strategy Implementation
 * 
 * ⚠️  CRITICAL: This is a FROZEN snapshot of the first profitable strategy.
 * 
 * DO NOT MODIFY THIS FILE.
 * 
 * This strategy represents the exact behavior of the profitable configuration
 * as of the date it was frozen. Any future changes to SMC logic should be done
 * in new strategy implementations (e.g., SmcStrategyV3, SmcExperimentalStrategy).
 * 
 * To always use the original profitable version, use the profile:
 * --strategy-profile first_successful_strategy_from_god
 * 
 * Implementation Details:
 * - Uses ICT Model (H4 bias, M15 setup, M1 entry)
 * - Uses ICTEntryService for strict ICT entry logic
 * - Risk-reward ratio: 3 (1:3)
 * - M15 structural swing points for SL (POI)
 * - Risk-reward ratio for TP calculation
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult, StrategyOrder } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { ICTEntryService, ICTEntryResult } from '../../strategy/v2/ICTEntryService';
import { TradeSignal } from '../../types';
import { Candle } from '../../marketData/types';

const logger = new Logger('GodSmcStrategy');

export class GodSmcStrategy implements IStrategy {
  readonly key = 'GOD_SMC_V1';
  readonly displayName = 'First Successful Strategy from GOD (Frozen)';

  private marketDataService: MarketDataService;
  private ictEntryService: ICTEntryService;
  private profile: StrategyProfile;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    
    // Initialize MarketDataService
    this.marketDataService = new MarketDataService();
    
    // Initialize ICTEntryService (frozen implementation)
    // This uses the exact logic that was profitable
    this.ictEntryService = new ICTEntryService();
    
    logger.info(`[GodSmcStrategy] Initialized frozen strategy with profile: ${profile.key}`);
    logger.info(`[GodSmcStrategy] Config:`, profile.config);
  }

  /**
   * Execute the frozen GOD strategy
   * 
   * This method implements the exact logic that was profitable.
   * DO NOT modify this logic - it is frozen.
   */
  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol, candles } = context;
    
    // Use MarketDataService from context if provided, otherwise use instance
    const marketDataService = context.marketDataService || this.marketDataService;
    
    try {
      // Get required timeframes for ICT model
      // H4 for bias, M15 for setup, M1 for entry
      const h4Candles = await marketDataService.getRecentCandles(symbol, 'H4', 100);
      const m15Candles = await marketDataService.getRecentCandles(symbol, 'M15', 100);
      const m1Candles = await marketDataService.getRecentCandles(symbol, 'M1', 100);
      
      // Validate minimum candle requirements
      if (h4Candles.length < 10) {
        return {
          orders: [],
          debug: {
            reason: `Insufficient H4 candles: ${h4Candles.length} < 10`,
          },
        };
      }
      
      if (m15Candles.length < 20) {
        return {
          orders: [],
          debug: {
            reason: `Insufficient M15 candles: ${m15Candles.length} < 20`,
          },
        };
      }
      
      if (m1Candles.length < 20) {
        return {
          orders: [],
          debug: {
            reason: `Insufficient M1 candles: ${m1Candles.length} < 20`,
          },
        };
      }
      
      // Execute ICT entry analysis (FROZEN LOGIC)
      const ictResult: ICTEntryResult = this.ictEntryService.analyzeICTEntry(
        h4Candles,
        m15Candles,
        m1Candles
      );
      
      // Check if entry is valid
      if (!ictResult.entry || !ictResult.entry.isValid) {
        return {
          orders: [],
          debug: {
            reason: ictResult.entry?.reasons?.join('; ') || 'No valid ICT entry',
            bias: ictResult.bias.direction,
            setupZone: ictResult.setupZone?.isValid || false,
          },
        };
      }
      
      const entry = ictResult.entry;
      
      // Build TradeSignal from ICT entry result
      const signal: TradeSignal = {
        symbol,
        direction: entry.direction === 'bullish' ? 'buy' : 'sell',
        entry: entry.entryPrice,
        stopLoss: entry.stopLoss,
        takeProfit: entry.takeProfit,
        orderKind: entry.entryType === 'limit' ? 'limit' : 'market', // Map entryType to orderKind
        reason: `GOD Strategy (Frozen): ${entry.reasons.join('; ')}`,
        meta: {
          strategyKey: this.key,
          profileKey: this.profile.key,
          ictBias: ictResult.bias.direction,
          ictSetupZone: ictResult.setupZone?.isValid || false,
          ictEntryType: entry.entryType,
          riskRewardRatio: entry.riskRewardRatio,
          m1ChoChIndex: entry.m1ChoChIndex,
          refinedOB: entry.refinedOB,
          reasons: entry.reasons,
        },
      };
      
      // Create strategy order
      const order: StrategyOrder = {
        signal,
        metadata: {
          strategyKey: this.key,
          profileKey: this.profile.key,
          ictResult,
        },
      };
      
      logger.info(
        `[GodSmcStrategy] Generated signal: ${symbol} ${signal.direction} @ ${signal.entry}, ` +
        `SL: ${signal.stopLoss}, TP: ${signal.takeProfit}, R:R: ${entry.riskRewardRatio.toFixed(2)}`
      );
      
      return {
        orders: [order],
        debug: {
          ictBias: ictResult.bias.direction,
          setupZoneValid: ictResult.setupZone?.isValid || false,
          entryValid: entry.isValid,
          riskRewardRatio: entry.riskRewardRatio,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[GodSmcStrategy] Error executing strategy for ${symbol}:`, errorMsg);
      
      return {
        orders: [],
        debug: {
          error: errorMsg,
        },
      };
    }
  }
}

