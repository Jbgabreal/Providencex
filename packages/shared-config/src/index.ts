import dotenv from 'dotenv';
import path from 'path';

// Load .env from root (works with CommonJS output)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface NewsGuardrailConfig {
  port: number;
  databaseUrl: string;
  openaiApiKey: string;
  screenshotOneAccessKey: string;
  timezone: string;
  cronSchedule?: string; // Optional override
}

export interface TradingEngineConfig {
  port: number;
  databaseUrl: string;
  newsGuardrailUrl: string;
  mt5ConnectorUrl: string;
  timezone: string;
  symbols: string[];
  marketFeedIntervalSeconds: number;
  marketSymbols: string[];
}

export interface MT5ConnectorConfig {
  port: number;
  databaseUrl?: string;
  mt5Account?: string;
  mt5Password?: string;
  mt5Server?: string;
}

export interface PortfolioEngineConfig {
  port: number;
  databaseUrl: string;
}

export interface FarmingEngineConfig {
  port: number;
  databaseUrl: string;
}

export interface APIGatewayConfig {
  port: number;
  newsGuardrailUrl: string;
  tradingEngineUrl: string;
  portfolioEngineUrl: string;
  farmingEngineUrl: string;
}

export function getNewsGuardrailConfig(): NewsGuardrailConfig {
  return {
    port: parseInt(process.env.NEWS_GUARDRAIL_PORT || '3010', 10),
    databaseUrl: process.env.DATABASE_URL || '',
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    screenshotOneAccessKey: process.env.SCREENSHOTONE_ACCESS_KEY || '',
    timezone: process.env.PX_TIMEZONE || 'America/New_York',
    cronSchedule: process.env.NEWS_GUARDRAIL_CRON_SCHEDULE,
  };
}

export function getTradingEngineConfig(): TradingEngineConfig {
  return {
    port: parseInt(process.env.TRADING_ENGINE_PORT || '3020', 10),
    databaseUrl: process.env.DATABASE_URL || '',
    newsGuardrailUrl: process.env.NEWS_GUARDRAIL_URL || 'http://localhost:3010',
    mt5ConnectorUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
    timezone: process.env.PX_TIMEZONE || 'America/New_York',
    symbols: (process.env.TRADING_SYMBOLS || 'XAUUSD,EURUSD,GBPUSD,US30').split(','),
    marketFeedIntervalSeconds: parseInt(process.env.MARKET_FEED_INTERVAL_SEC || '1', 10),
    marketSymbols: (process.env.MARKET_SYMBOLS || process.env.TRADING_SYMBOLS || 'XAUUSD,EURUSD,GBPUSD')
      .split(',')
      .map(s => s.trim()),
  };
}

export function getMT5ConnectorConfig(): MT5ConnectorConfig {
  return {
    port: parseInt(process.env.MT5_CONNECTOR_PORT || '3030', 10),
    databaseUrl: process.env.DATABASE_URL,
    mt5Account: process.env.MT5_ACCOUNT,
    mt5Password: process.env.MT5_PASSWORD,
    mt5Server: process.env.MT5_SERVER,
  };
}

export function getPortfolioEngineConfig(): PortfolioEngineConfig {
  return {
    port: parseInt(process.env.PORTFOLIO_ENGINE_PORT || '3040', 10),
    databaseUrl: process.env.DATABASE_URL || '',
  };
}

export function getFarmingEngineConfig(): FarmingEngineConfig {
  return {
    port: parseInt(process.env.FARMING_ENGINE_PORT || '3050', 10),
    databaseUrl: process.env.DATABASE_URL || '',
  };
}

export function getAPIGatewayConfig(): APIGatewayConfig {
  return {
    port: parseInt(process.env.API_GATEWAY_PORT || '3000', 10),
    newsGuardrailUrl: process.env.NEWS_GUARDRAIL_URL || 'http://localhost:3010',
    tradingEngineUrl: process.env.TRADING_ENGINE_URL || 'http://localhost:3020',
    portfolioEngineUrl: process.env.PORTFOLIO_ENGINE_URL || 'http://localhost:3040',
    farmingEngineUrl: process.env.FARMING_ENGINE_URL || 'http://localhost:3050',
  };
}

// Export MarketDataConfig types and function
export * from './MarketDataConfig';

// Export LivePnlConfig types and function
export * from './LivePnlConfig';

// Export KillSwitchConfig types and function
export * from './KillSwitchConfig';

// Export ExitEngineConfig types and function
export * from './ExitEngineConfig';

// Export OrderFlowConfig types and function
export * from './OrderFlowConfig';

