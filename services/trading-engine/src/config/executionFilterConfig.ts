/**
 * Execution Filter v3 Configuration
 * 
 * Per-symbol rules for execution filtering and multi-confirmation logic
 */

import { ExecutionFilterConfig } from '../strategy/v3/types';

/**
 * Default execution filter configuration
 * 
 * Each symbol has rules for:
 * - HTF/LTF alignment requirements
 * - Structural confirmations (BOS, liquidity sweep, displacement)
 * - Session windows
 * - Trade frequency limits
 * - Risk constraints
 */
export const executionFilterConfig: ExecutionFilterConfig = {
  timezone: process.env.PX_TIMEZONE || 'America/New_York',
  
  // v4 Global exposure limits (optional - can override per-symbol)
  maxConcurrentTradesGlobal: parseInt(process.env.MAX_CONCURRENT_TRADES_GLOBAL || '8', 10),
  maxDailyRiskGlobal: parseFloat(process.env.MAX_DAILY_RISK_GLOBAL || '500'), // Account currency
  exposurePollIntervalSec: parseInt(process.env.EXPOSURE_POLL_INTERVAL_SEC || '10', 10),
  
  // Volume Imbalance alignment rule - configurable for dev/experimentation
  // Default: true (hard rule) - set to false to make it soft (log but don't block)
  requireVolumeImbalanceAlignment: process.env.EXEC_FILTER_REQUIRE_VOLUME_IMBALANCE_ALIGNMENT !== 'false',
  
  rulesBySymbol: {
    XAUUSD: {
      symbol: 'XAUUSD',
      enabled: true,
      allowedDirections: ['buy', 'sell'],
      
      // Multi-timeframe requirements
      requireHtfAlignment: true,
      allowedHtfTrends: ['bullish', 'bearish'], // No trades in hard range
      
      // Structural confirmations - strict requirements for gold
      requireBosInDirection: true,
      requireLiquiditySweep: true,
      requireDisplacementCandle: true,
      
      // Session windows (in engine timezone)
      enabledSessions: [
        { label: 'London', startHour: 3, endHour: 11 }, // 3 AM - 11 AM NY time
        { label: 'NY', startHour: 8, endHour: 16 },     // 8 AM - 4 PM NY time
      ],
      
      // Block trades during news guardrail avoid windows
      blockNewsGuardrailModes: ['avoid'],
      
      // Trade frequency limits
      maxTradesPerDay: 5,
      minMinutesBetweenTrades: 15,
      maxConcurrentTradesPerSymbol: 2,
      
      // v4 Exposure & Concurrency (optional - backward compatible)
      maxConcurrentTradesPerDirection: 1, // Max 1 buy OR 1 sell at a time
      maxDailyRiskPerSymbol: 200, // Max $200 risk per symbol (account currency)
      
      // Price/volatility filters
      maxSpreadPips: 50, // XAUUSD-specific spread threshold
      minDistanceFromDailyHighLowPips: 30,
      
      // Confluence threshold - minimum confluence score required (0-100)
      minConfluenceScore: 65, // v15b: slightly relaxed from 70 to allow trend-following trades with non-ideal PD
      
      // Displacement candle check - symbol-aware (already defined above)
      displacementMinATRMultiplier: 2.0, // Displacement candle must be >= 2x ATR
    },
    
    EURUSD: {
      symbol: 'EURUSD',
      enabled: true,
      allowedDirections: ['buy', 'sell'],
      
      // Multi-timeframe requirements
      requireHtfAlignment: true,
      allowedHtfTrends: ['bullish', 'bearish'],
      
      // Structural confirmations
      requireBosInDirection: true,
      requireLiquiditySweep: true,
      requireDisplacementCandle: true,
      
      // Session windows
      enabledSessions: [
        { label: 'London', startHour: 2, endHour: 11 }, // 2 AM - 11 AM NY time
        { label: 'NY', startHour: 7, endHour: 16 },     // 7 AM - 4 PM NY time
      ],
      
      blockNewsGuardrailModes: ['avoid'],
      
      // Trade frequency limits
      maxTradesPerDay: 4,
      minMinutesBetweenTrades: 20,
      maxConcurrentTradesPerSymbol: 2,
      
      // v4 Exposure & Concurrency
      maxConcurrentTradesPerDirection: 1,
      maxDailyRiskPerSymbol: 150, // Max $150 risk per symbol
      
      // Price/volatility filters
      maxSpreadPips: 2, // Forex pairs typically have tighter spreads
      minDistanceFromDailyHighLowPips: 10,
      
      // Confluence threshold
      minConfluenceScore: 65, // EURUSD requires good confluence (65+)
      
      // Displacement candle check (already defined above)
      displacementMinATRMultiplier: 2.0,
    },
    
    GBPUSD: {
      symbol: 'GBPUSD',
      enabled: true,
      allowedDirections: ['buy', 'sell'],
      
      requireHtfAlignment: true,
      allowedHtfTrends: ['bullish', 'bearish'],
      
      requireBosInDirection: true,
      requireLiquiditySweep: true,
      requireDisplacementCandle: true,
      
      enabledSessions: [
        { label: 'London', startHour: 2, endHour: 11 },
        { label: 'NY', startHour: 7, endHour: 16 },
      ],
      
      blockNewsGuardrailModes: ['avoid'],
      
      maxTradesPerDay: 4,
      minMinutesBetweenTrades: 20,
      maxConcurrentTradesPerSymbol: 2,
      
      // v4 Exposure & Concurrency
      maxConcurrentTradesPerDirection: 1,
      maxDailyRiskPerSymbol: 150,
      
      maxSpreadPips: 2,
      minDistanceFromDailyHighLowPips: 10,
    },
    
    US30: {
      symbol: 'US30',
      enabled: true,
      allowedDirections: ['buy', 'sell'],
      
      requireHtfAlignment: true,
      allowedHtfTrends: ['bullish', 'bearish'],
      
      requireBosInDirection: true,
      requireLiquiditySweep: false, // Slightly more lenient for indices
      requireDisplacementCandle: true,
      
      enabledSessions: [
        { label: 'NY', startHour: 9, endHour: 16 }, // Market hours
      ],
      
      blockNewsGuardrailModes: ['avoid'],
      
      maxTradesPerDay: 3,
      minMinutesBetweenTrades: 30,
      maxConcurrentTradesPerSymbol: 1,
      
      // v4 Exposure & Concurrency
      maxConcurrentTradesPerDirection: 1,
      maxDailyRiskPerSymbol: 100, // Max $100 risk per symbol (conservative for indices)
      
      maxSpreadPips: 5, // Points for US30
      minDistanceFromDailyHighLowPips: 50,
    },
  },
};

import type { SymbolExecutionRules } from '../strategy/v3/types';

/**
 * Get execution filter rules for a symbol
 * Returns null if symbol not configured or disabled
 */
export function getSymbolRules(symbol: string): SymbolExecutionRules | null {
  const rules = executionFilterConfig.rulesBySymbol[symbol.toUpperCase()];
  if (!rules || !rules.enabled) {
    return null;
  }
  return rules;
}

// Re-export type for convenience
export type { SymbolExecutionRules };

