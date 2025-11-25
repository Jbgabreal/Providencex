/**
 * RiskManagementService - Calculate Stop Loss and Take Profit for SMC Strategy
 * 
 * Implements proper risk management:
 * - Stop-loss at opposite side of OB/FVG or recent LTF swing
 * - Take-profit at next HTF liquidity pool or minimum R:R ratio (1-3x)
 * - Minimum SL distance validation
 * 
 * Based on user requirements: "SL at opposite side of OB/FVG or recent swing, TP at next HTF liquidity or 1-2R:R"
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { OrderBlockV2 } from './types';

const logger = new Logger('RiskManagementService');

export interface RiskManagementConfig {
  minRiskReward: number; // Minimum R:R ratio (default: 1.0)
  maxRiskReward: number; // Maximum R:R ratio (default: 3.0)
  defaultRiskReward: number; // Default R:R if no liquidity pool found (default: 2.0)
  minStopLossDistance: number; // Minimum SL distance in price units (default: 0.01% of entry)
  maxStopLossDistance: number; // Maximum SL distance in price units (optional)
}

export interface RiskManagementResult {
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
  stopLossReason: string;
  takeProfitReason: string;
  isValid: boolean;
  errors: string[];
}

export class RiskManagementService {
  private config: RiskManagementConfig;

  constructor(config: Partial<RiskManagementConfig> = {}) {
    this.config = {
      minRiskReward: config.minRiskReward ?? 1.0,
      maxRiskReward: config.maxRiskReward ?? 3.0,
      defaultRiskReward: config.defaultRiskReward ?? 2.0,
      minStopLossDistance: config.minStopLossDistance ?? 0, // Will be calculated as % if 0
      maxStopLossDistance: config.maxStopLossDistance ?? 0, // Optional
    };
  }

  /**
   * Calculate stop-loss and take-profit for a trade entry
   * 
   * @param entryPrice - Entry price
   * @param direction - Trade direction ('bullish' or 'bearish')
   * @param orderBlock - Order block (if available)
   * @param fvg - Fair value gap (if available)
   * @param recentSwingLow - Recent LTF swing low (for bullish trades)
   * @param recentSwingHigh - Recent LTF swing high (for bearish trades)
   * @param htfLiquidityPools - HTF liquidity pools (equal highs/lows for TP targets)
   */
  calculateRiskLevels(
    entryPrice: number,
    direction: 'bullish' | 'bearish',
    options: {
      orderBlock?: OrderBlockV2 | null;
      fvg?: { low: number; high: number } | null;
      recentSwingLow?: number | null;
      recentSwingHigh?: number | null;
      htfLiquidityPools?: {
        equalHighs: number[];
        equalLows: number[];
      } | null;
      atr?: number | null; // ATR for dynamic SL distance
    } = {}
  ): RiskManagementResult {
    const errors: string[] = [];
    let stopLoss: number | null = null;
    let stopLossReason = '';
    let takeProfit: number | null = null;
    let takeProfitReason = '';

    // Calculate stop-loss
    if (direction === 'bullish') {
      // Bullish trade: SL below entry
      const candidates: Array<{ price: number; reason: string }> = [];

      // 1. Order block low (highest priority)
      if (options.orderBlock && options.orderBlock.type === 'bullish') {
        candidates.push({
          price: options.orderBlock.low,
          reason: 'Order block low',
        });
      }

      // 2. FVG low
      if (options.fvg) {
        candidates.push({
          price: options.fvg.low,
          reason: 'FVG low',
        });
      }

      // 3. Recent LTF swing low
      if (options.recentSwingLow !== null && options.recentSwingLow !== undefined) {
        candidates.push({
          price: options.recentSwingLow,
          reason: 'Recent LTF swing low',
        });
      }

      // 4. Fallback: ATR-based SL (if no other reference)
      if (candidates.length === 0 && options.atr) {
        const atrBasedSL = entryPrice - (options.atr * 1.5); // 1.5x ATR below entry
        candidates.push({
          price: atrBasedSL,
          reason: 'ATR-based SL (1.5x ATR)',
        });
      }

      if (candidates.length > 0) {
        // Choose the closest candidate below entry (tightest SL while respecting structure)
        const validCandidates = candidates.filter(c => c.price < entryPrice);
        if (validCandidates.length > 0) {
          // Prefer OB/FVG over swing low (better structure reference)
          const obFvgCandidate = validCandidates.find(
            c => c.reason.includes('Order block') || c.reason.includes('FVG')
          );
          stopLoss = obFvgCandidate?.price ?? validCandidates[0].price;
          stopLossReason = obFvgCandidate?.reason ?? validCandidates[0].reason;
        } else {
          errors.push('All SL candidates are above entry price');
        }
      } else {
        errors.push('No stop-loss reference available (OB, FVG, or swing low)');
      }
    } else {
      // Bearish trade: SL above entry
      const candidates: Array<{ price: number; reason: string }> = [];

      // 1. Order block high (highest priority)
      if (options.orderBlock && options.orderBlock.type === 'bearish') {
        candidates.push({
          price: options.orderBlock.high,
          reason: 'Order block high',
        });
      }

      // 2. FVG high
      if (options.fvg) {
        candidates.push({
          price: options.fvg.high,
          reason: 'FVG high',
        });
      }

      // 3. Recent LTF swing high
      if (options.recentSwingHigh !== null && options.recentSwingHigh !== undefined) {
        candidates.push({
          price: options.recentSwingHigh,
          reason: 'Recent LTF swing high',
        });
      }

      // 4. Fallback: ATR-based SL (if no other reference)
      if (candidates.length === 0 && options.atr) {
        const atrBasedSL = entryPrice + (options.atr * 1.5); // 1.5x ATR above entry
        candidates.push({
          price: atrBasedSL,
          reason: 'ATR-based SL (1.5x ATR)',
        });
      }

      if (candidates.length > 0) {
        // Choose the closest candidate above entry (tightest SL while respecting structure)
        const validCandidates = candidates.filter(c => c.price > entryPrice);
        if (validCandidates.length > 0) {
          // Prefer OB/FVG over swing high (better structure reference)
          const obFvgCandidate = validCandidates.find(
            c => c.reason.includes('Order block') || c.reason.includes('FVG')
          );
          stopLoss = obFvgCandidate?.price ?? validCandidates[0].price;
          stopLossReason = obFvgCandidate?.reason ?? validCandidates[0].reason;
        } else {
          errors.push('All SL candidates are below entry price');
        }
      } else {
        errors.push('No stop-loss reference available (OB, FVG, or swing high)');
      }
    }

    // Validate minimum SL distance
    if (stopLoss !== null) {
      const minSLDistance = this.config.minStopLossDistance || entryPrice * 0.0001; // 0.01% default
      const slDistance = direction === 'bullish' 
        ? entryPrice - stopLoss 
        : stopLoss - entryPrice;

      if (slDistance < minSLDistance) {
        // Adjust SL to meet minimum distance
        if (direction === 'bullish') {
          stopLoss = entryPrice - minSLDistance;
          stopLossReason += ' (adjusted to meet minimum distance)';
        } else {
          stopLoss = entryPrice + minSLDistance;
          stopLossReason += ' (adjusted to meet minimum distance)';
        }
      }

      // Check max SL distance if configured
      if (this.config.maxStopLossDistance > 0 && slDistance > this.config.maxStopLossDistance) {
        errors.push(`Stop-loss distance (${slDistance.toFixed(4)}) exceeds maximum (${this.config.maxStopLossDistance})`);
      }
    }

    // Calculate take-profit
    if (stopLoss !== null) {
      const risk = direction === 'bullish' 
        ? entryPrice - stopLoss 
        : stopLoss - entryPrice;

      // 1. Try HTF liquidity pool first
      if (options.htfLiquidityPools) {
        if (direction === 'bullish' && options.htfLiquidityPools.equalHighs.length > 0) {
          // Target next equal high above entry
          const targetHighs = options.htfLiquidityPools.equalHighs.filter(h => h > entryPrice);
          if (targetHighs.length > 0) {
            const nearestHigh = Math.min(...targetHighs);
            const reward = nearestHigh - entryPrice;
            const rr = reward / risk;
            
            if (rr >= this.config.minRiskReward) {
              takeProfit = nearestHigh;
              takeProfitReason = `HTF equal high (R:R=${rr.toFixed(2)})`;
            }
          }
        } else if (direction === 'bearish' && options.htfLiquidityPools.equalLows.length > 0) {
          // Target next equal low below entry
          const targetLows = options.htfLiquidityPools.equalLows.filter(l => l < entryPrice);
          if (targetLows.length > 0) {
            const nearestLow = Math.max(...targetLows);
            const reward = entryPrice - nearestLow;
            const rr = reward / risk;
            
            if (rr >= this.config.minRiskReward) {
              takeProfit = nearestLow;
              takeProfitReason = `HTF equal low (R:R=${rr.toFixed(2)})`;
            }
          }
        }
      }

      // 2. Fallback: Default R:R ratio
      if (takeProfit === null) {
        const targetRR = Math.min(this.config.defaultRiskReward, this.config.maxRiskReward);
        if (direction === 'bullish') {
          takeProfit = entryPrice + (risk * targetRR);
        } else {
          takeProfit = entryPrice - (risk * targetRR);
        }
        takeProfitReason = `Default R:R=${targetRR.toFixed(2)} (no liquidity pool found)`;
      }

      // Validate R:R ratio
      if (takeProfit !== null) {
        const reward = direction === 'bullish' 
          ? takeProfit - entryPrice 
          : entryPrice - takeProfit;
        const rr = reward / risk;

        if (rr < this.config.minRiskReward) {
          errors.push(`R:R ratio (${rr.toFixed(2)}) below minimum (${this.config.minRiskReward})`);
        }

        if (rr > this.config.maxRiskReward) {
          // Cap TP at max R:R
          const cappedReward = risk * this.config.maxRiskReward;
          if (direction === 'bullish') {
            takeProfit = entryPrice + cappedReward;
          } else {
            takeProfit = entryPrice - cappedReward;
          }
          takeProfitReason += ` (capped at R:R=${this.config.maxRiskReward})`;
        }
      }
    }

    const isValid = errors.length === 0 && stopLoss !== null && takeProfit !== null;
    const riskRewardRatio = stopLoss !== null && takeProfit !== null
      ? (direction === 'bullish' 
          ? (takeProfit - entryPrice) / (entryPrice - stopLoss)
          : (entryPrice - takeProfit) / (stopLoss - entryPrice))
      : 0;

    return {
      stopLoss: stopLoss ?? 0,
      takeProfit: takeProfit ?? 0,
      riskRewardRatio,
      stopLossReason,
      takeProfitReason,
      isValid,
      errors,
    };
  }

  /**
   * Detect liquidity pools (equal highs/lows) from HTF candles
   * 
   * Equal highs: clusters of swing highs at similar prices
   * Equal lows: clusters of swing lows at similar prices
   */
  detectLiquidityPools(
    candles: Candle[],
    tolerance: number = 0.001 // 0.1% price tolerance
  ): { equalHighs: number[]; equalLows: number[] } {
    const equalHighs: number[] = [];
    const equalLows: number[] = [];

    // Simple implementation: find clusters of similar highs/lows
    // This is a simplified version - can be enhanced with proper swing detection
    
    const highs: number[] = [];
    const lows: number[] = [];

    // Extract highs and lows (simplified - should use proper swing detection)
    for (let i = 1; i < candles.length - 1; i++) {
      const candle = candles[i];
      const prevCandle = candles[i - 1];
      const nextCandle = candles[i + 1];

      // Simple swing high detection (local maximum)
      if (candle.high > prevCandle.high && candle.high > nextCandle.high) {
        highs.push(candle.high);
      }

      // Simple swing low detection (local minimum)
      if (candle.low < prevCandle.low && candle.low < nextCandle.low) {
        lows.push(candle.low);
      }
    }

    // Cluster similar highs
    const clusteredHighs = this.clusterPrices(highs, tolerance);
    equalHighs.push(...clusteredHighs.map(cluster => cluster.average));

    // Cluster similar lows
    const clusteredLows = this.clusterPrices(lows, tolerance);
    equalLows.push(...clusteredLows.map(cluster => cluster.average));

    return { equalHighs, equalLows };
  }

  /**
   * Cluster prices that are within tolerance
   */
  private clusterPrices(
    prices: number[],
    tolerance: number
  ): Array<{ prices: number[]; average: number }> {
    const clusters: Array<{ prices: number[]; average: number }> = [];
    const used = new Set<number>();

    for (let i = 0; i < prices.length; i++) {
      if (used.has(i)) continue;

      const cluster: number[] = [prices[i]];
      used.add(i);

      for (let j = i + 1; j < prices.length; j++) {
        if (used.has(j)) continue;

        const price1 = prices[i];
        const price2 = prices[j];
        const percentDiff = Math.abs(price1 - price2) / Math.max(price1, price2);

        if (percentDiff <= tolerance) {
          cluster.push(prices[j]);
          used.add(j);
        }
      }

      const average = cluster.reduce((sum, p) => sum + p, 0) / cluster.length;
      clusters.push({ prices: cluster, average });
    }

    return clusters;
  }
}

