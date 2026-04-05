/**
 * Backtest-Friendly Execution Filter Configuration
 * 
 * Relaxed filters for backtesting to allow signals to pass through
 * while still maintaining basic safety checks
 */

import { ExecutionFilterConfig } from '../strategy/v3/types';

/**
 * Backtest execution filter config - relaxed requirements
 * Set BACKTEST_RELAXED_FILTERS=true to use this instead of strict production filters
 */
export const backtestExecutionFilterConfig: ExecutionFilterConfig = {
  timezone: process.env.PX_TIMEZONE || 'America/New_York',
  
  // Relaxed global limits for backtesting
  maxConcurrentTradesGlobal: 999, // No practical limit
  maxDailyRiskGlobal: 999999, // No practical limit
  exposurePollIntervalSec: 10,
  
  // Don't require volume imbalance alignment in backtesting
  requireVolumeImbalanceAlignment: false,
  
  rulesBySymbol: {
    XAUUSD: {
      symbol: 'XAUUSD',
      enabled: true,
      allowedDirections: ['buy', 'sell'],

      // SENIOR DEV: Relaxed multi-timeframe requirements for backtesting
      requireHtfAlignment: false, // Allow trades even if HTF not aligned
      allowedHtfTrends: ['bullish', 'bearish', 'range'], // Allow range/sideways trades

      // SENIOR DEV: Relaxed structural confirmations for backtesting
      requireBosInDirection: false, // Don't require BOS
      requireLiquiditySweep: false, // Don't require liquidity sweep
      requireDisplacementCandle: false, // Don't require displacement
      
      // SENIOR DEV: Allow trades in all sessions for backtesting
      enabledSessions: [
        { label: 'All Day', startHour: 0, endHour: 23 }, // Allow 24/7
      ],
      
      // Don't block based on news guardrail in backtesting
      blockNewsGuardrailModes: [],
      
      // Relaxed trade frequency limits
      maxTradesPerDay: 999, // No limit
      minMinutesBetweenTrades: 0, // No minimum wait time
      maxConcurrentTradesPerSymbol: 999, // No limit
      
      // Relaxed exposure limits
      maxConcurrentTradesPerDirection: 999, // No limit
      maxDailyRiskPerSymbol: 999999, // No limit
      
      // Relaxed price/volatility filters
      maxSpreadPips: 999, // No spread limit
      minDistanceFromDailyHighLowPips: 0, // No distance requirement
      
      // Lower confluence threshold for backtesting
      minConfluenceScore: 0, // No minimum confluence required
      
      // Relaxed displacement requirement
      displacementMinATRMultiplier: 0, // No displacement requirement
    },
    // Crypto — fully relaxed, 24/7
    BTCUSD: { symbol: 'BTCUSD', enabled: true, allowedDirections: ['buy', 'sell'], requireHtfAlignment: false, allowedHtfTrends: ['bullish', 'bearish', 'range'], requireBosInDirection: false, requireLiquiditySweep: false, requireDisplacementCandle: false, enabledSessions: [{ label: '24/7', startHour: 0, endHour: 23 }], blockNewsGuardrailModes: [], maxTradesPerDay: 999, minMinutesBetweenTrades: 0, maxConcurrentTradesPerSymbol: 999, maxConcurrentTradesPerDirection: 999, maxDailyRiskPerSymbol: 999999, maxSpreadPips: 999, minDistanceFromDailyHighLowPips: 0, minConfluenceScore: 0, displacementMinATRMultiplier: 0 },
    ETHUSD: { symbol: 'ETHUSD', enabled: true, allowedDirections: ['buy', 'sell'], requireHtfAlignment: false, allowedHtfTrends: ['bullish', 'bearish', 'range'], requireBosInDirection: false, requireLiquiditySweep: false, requireDisplacementCandle: false, enabledSessions: [{ label: '24/7', startHour: 0, endHour: 23 }], blockNewsGuardrailModes: [], maxTradesPerDay: 999, minMinutesBetweenTrades: 0, maxConcurrentTradesPerSymbol: 999, maxConcurrentTradesPerDirection: 999, maxDailyRiskPerSymbol: 999999, maxSpreadPips: 999, minDistanceFromDailyHighLowPips: 0, minConfluenceScore: 0, displacementMinATRMultiplier: 0 },
    // Volatility indices — same relaxed config, 24/7 trading
    V25: { symbol: 'V25', enabled: true, allowedDirections: ['buy', 'sell'], requireHtfAlignment: false, allowedHtfTrends: ['bullish', 'bearish', 'range'], requireBosInDirection: false, requireLiquiditySweep: false, requireDisplacementCandle: false, enabledSessions: [{ label: '24/7', startHour: 0, endHour: 23 }], blockNewsGuardrailModes: [], maxTradesPerDay: 999, minMinutesBetweenTrades: 0, maxConcurrentTradesPerSymbol: 999, maxConcurrentTradesPerDirection: 999, maxDailyRiskPerSymbol: 999999, maxSpreadPips: 999, minDistanceFromDailyHighLowPips: 0, minConfluenceScore: 0, displacementMinATRMultiplier: 0 },
    V50: { symbol: 'V50', enabled: true, allowedDirections: ['buy', 'sell'], requireHtfAlignment: false, allowedHtfTrends: ['bullish', 'bearish', 'range'], requireBosInDirection: false, requireLiquiditySweep: false, requireDisplacementCandle: false, enabledSessions: [{ label: '24/7', startHour: 0, endHour: 23 }], blockNewsGuardrailModes: [], maxTradesPerDay: 999, minMinutesBetweenTrades: 0, maxConcurrentTradesPerSymbol: 999, maxConcurrentTradesPerDirection: 999, maxDailyRiskPerSymbol: 999999, maxSpreadPips: 999, minDistanceFromDailyHighLowPips: 0, minConfluenceScore: 0, displacementMinATRMultiplier: 0 },
    V75: { symbol: 'V75', enabled: true, allowedDirections: ['buy', 'sell'], requireHtfAlignment: false, allowedHtfTrends: ['bullish', 'bearish', 'range'], requireBosInDirection: false, requireLiquiditySweep: false, requireDisplacementCandle: false, enabledSessions: [{ label: '24/7', startHour: 0, endHour: 23 }], blockNewsGuardrailModes: [], maxTradesPerDay: 999, minMinutesBetweenTrades: 0, maxConcurrentTradesPerSymbol: 999, maxConcurrentTradesPerDirection: 999, maxDailyRiskPerSymbol: 999999, maxSpreadPips: 999, minDistanceFromDailyHighLowPips: 0, minConfluenceScore: 0, displacementMinATRMultiplier: 0 },
    V100: { symbol: 'V100', enabled: true, allowedDirections: ['buy', 'sell'], requireHtfAlignment: false, allowedHtfTrends: ['bullish', 'bearish', 'range'], requireBosInDirection: false, requireLiquiditySweep: false, requireDisplacementCandle: false, enabledSessions: [{ label: '24/7', startHour: 0, endHour: 23 }], blockNewsGuardrailModes: [], maxTradesPerDay: 999, minMinutesBetweenTrades: 0, maxConcurrentTradesPerSymbol: 999, maxConcurrentTradesPerDirection: 999, maxDailyRiskPerSymbol: 999999, maxSpreadPips: 999, minDistanceFromDailyHighLowPips: 0, minConfluenceScore: 0, displacementMinATRMultiplier: 0 },
  },
};

