import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface ExitEngineConfig {
  enabled: boolean; // Default: true
  exitTickIntervalSec: number; // Default: 2
  mt5ConnectorUrl: string;
  databaseUrl: string;
  
  breakEvenEnabled: boolean; // Default: true
  partialCloseEnabled: boolean; // Default: true
  trailingEnabled: boolean; // Default: true
  structureExitEnabled: boolean; // Default: true
  timeExitEnabled: boolean; // Default: true
  commissionExitEnabled: boolean; // Default: true
  
  breakEvenTriggerPips?: number; // Default: 20 pips
  defaultPartialClosePercent?: number; // Default: 50%
  defaultTrailMode?: 'atr' | 'fixed_pips' | 'structure' | 'volatility_adaptive'; // Default: 'fixed_pips'
  defaultTrailPips?: number; // Default: 20 pips
  maxTimeInTradeSeconds?: number; // Default: 86400 (24 hours)
}

export function getExitEngineConfig(): ExitEngineConfig {
  return {
    enabled: process.env.EXIT_ENGINE_ENABLED !== 'false', // Default: true
    exitTickIntervalSec: parseInt(process.env.EXIT_TICK_INTERVAL_SEC || '2', 10),
    mt5ConnectorUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
    databaseUrl: process.env.DATABASE_URL || '',
    
    breakEvenEnabled: process.env.EXIT_BREAK_EVEN_ENABLED !== 'false', // Default: true
    partialCloseEnabled: process.env.EXIT_PARTIAL_CLOSE_ENABLED !== 'false', // Default: true
    trailingEnabled: process.env.EXIT_TRAILING_ENABLED !== 'false', // Default: true
    structureExitEnabled: process.env.EXIT_STRUCTURE_ENABLED !== 'false', // Default: true
    timeExitEnabled: process.env.EXIT_TIME_ENABLED !== 'false', // Default: true
    commissionExitEnabled: process.env.EXIT_COMMISSION_ENABLED !== 'false', // Default: true
    
    breakEvenTriggerPips: process.env.EXIT_BREAK_EVEN_TRIGGER_PIPS
      ? parseFloat(process.env.EXIT_BREAK_EVEN_TRIGGER_PIPS)
      : 20,
    defaultPartialClosePercent: process.env.EXIT_DEFAULT_PARTIAL_CLOSE_PERCENT
      ? parseFloat(process.env.EXIT_DEFAULT_PARTIAL_CLOSE_PERCENT)
      : 50,
    defaultTrailMode: (process.env.EXIT_DEFAULT_TRAIL_MODE as ExitEngineConfig['defaultTrailMode']) || 'fixed_pips',
    defaultTrailPips: process.env.EXIT_DEFAULT_TRAIL_PIPS
      ? parseFloat(process.env.EXIT_DEFAULT_TRAIL_PIPS)
      : 20,
    maxTimeInTradeSeconds: process.env.EXIT_MAX_TIME_IN_TRADE_SECONDS
      ? parseInt(process.env.EXIT_MAX_TIME_IN_TRADE_SECONDS, 10)
      : 86400, // 24 hours
  };
}


