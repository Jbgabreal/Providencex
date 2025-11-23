import { getTradingEngineConfig as getBaseConfig } from '@providencex/shared-config';

export interface TradingEngineConfig {
  port: number;
  newsGuardrailUrl: string;
  mt5ConnectorUrl: string;
  symbols: string[];
  
  // Market Data Configuration
  marketFeedIntervalSeconds: number;
  marketSymbols: string[];
  
  // Risk Limits
  lowRiskMaxDailyLoss: number; // percent of equity
  lowRiskMaxTrades: number;
  highRiskMaxDailyLoss: number; // percent of equity
  highRiskMaxTrades: number;
  
  // Risk Per Trade
  defaultLowRiskPerTrade: number; // percent
  defaultHighRiskPerTrade: number; // percent
  
  // Per-Symbol Risk Overrides (v15)
  perSymbolRiskOverrides: Record<string, number>; // Symbol -> risk percent override
  
  // Market Constraints
  maxSpread: number; // in pips or price units
  
  // Strategy Configuration
  smcTimeframes: {
    htf: string; // Higher timeframe (e.g., "H4")
    ltf: string; // Lower timeframe (e.g., "M1")
  };
  
  // Tick Loop
  tickIntervalSeconds: number;
  
  // Database (for logging)
  databaseUrl?: string;
  
  // v3 Execution Filter feature flag
  useExecutionFilterV3: boolean;
  
  // v10 SMC v2 Strategy feature flag
  useSMCV2: boolean;
}

export function getConfig(): TradingEngineConfig {
  const baseConfig = getBaseConfig();
  
  return {
    port: baseConfig.port,
    newsGuardrailUrl: baseConfig.newsGuardrailUrl,
    mt5ConnectorUrl: baseConfig.mt5ConnectorUrl,
    symbols: baseConfig.symbols,
    
    // Market Data Configuration
    marketFeedIntervalSeconds: baseConfig.marketFeedIntervalSeconds,
    marketSymbols: baseConfig.marketSymbols,
    
    // Risk Limits - from env or defaults
    lowRiskMaxDailyLoss: parseFloat(process.env.LOW_RISK_MAX_DAILY_LOSS || '1.0'),
    lowRiskMaxTrades: parseInt(process.env.LOW_RISK_MAX_TRADES || '2', 10),
    highRiskMaxDailyLoss: parseFloat(process.env.HIGH_RISK_MAX_DAILY_LOSS || '3.0'),
    highRiskMaxTrades: parseInt(process.env.HIGH_RISK_MAX_TRADES || '4', 10),
    
    // Risk Per Trade
    defaultLowRiskPerTrade: parseFloat(process.env.DEFAULT_LOW_RISK_PER_TRADE || '0.5'),
    defaultHighRiskPerTrade: parseFloat(process.env.DEFAULT_HIGH_RISK_PER_TRADE || '1.5'),
    
    // Per-Symbol Risk Overrides (v15)
    // Format: "SYMBOL:percent,SYMBOL:percent" (e.g., "XAUUSD:0.25,US30:0.3")
    perSymbolRiskOverrides: (() => {
      const env = process.env.PER_SYMBOL_RISK_OVERRIDES || '';
      const overrides: Record<string, number> = {};
      if (env) {
        env.split(',').forEach(override => {
          const [symbol, percent] = override.split(':');
          if (symbol && percent) {
            overrides[symbol.toUpperCase()] = parseFloat(percent);
          }
        });
      }
      // Default overrides: XAUUSD = 0.25% (more conservative for volatile instrument)
      if (!overrides['XAUUSD']) {
        overrides['XAUUSD'] = 0.25;
      }
      return overrides;
    })(),
    
    // Market Constraints
    maxSpread: parseFloat(process.env.MAX_SPREAD || '0.8'),
    
    // Strategy Configuration
    smcTimeframes: (() => {
      const timeframes = (process.env.SMC_TIMEFRAMES || 'H4,M1').split(',');
      return {
        htf: timeframes[0] || 'H4',
        ltf: timeframes[1] || 'M1',
      };
    })(),
    
    // Tick Loop
    tickIntervalSeconds: parseInt(process.env.TICK_INTERVAL_SECONDS || '60', 10),
    
    // Database (optional - for logging)
    databaseUrl: process.env.DATABASE_URL,
    
    // v3 Execution Filter feature flag (default: true in dev, can be disabled via env)
    useExecutionFilterV3: process.env.USE_EXECUTION_FILTER_V3 !== 'false',
    
    // v10 SMC v2 Strategy feature flag (default: false, must be explicitly enabled)
    useSMCV2: process.env.USE_SMC_V2 === 'true',
  };
}

