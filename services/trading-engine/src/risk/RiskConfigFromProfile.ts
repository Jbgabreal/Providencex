import { Logger } from '@providencex/shared-utils';
import type { UserTradingConfig } from '../db/TenantRepository';

const logger = new Logger('RiskConfigFromProfile');

export type SessionName = 'asian' | 'london' | 'newyork';

export interface StrategyProfileRiskConfig {
  riskPerTradePercent: number;          // e.g. 0.5
  riskPerTradeUsd?: number;             // fixed USD amount (overrides percent if set)
  riskMode: 'percentage' | 'usd';      // which mode to use
  maxDailyDrawdownPercent: number;      // e.g. 3
  maxWeeklyDrawdownPercent: number;     // e.g. 10
  maxOpenRiskPercent: number;           // e.g. 3
  maxTradesPerDay: number;              // e.g. 10
  maxConsecutiveLosses: number;         // cool off after N losses (default: 3)
  sessions: SessionName[];             // which sessions to trade in
}

const ALL_SESSIONS: SessionName[] = ['asian', 'london', 'newyork'];

const DEFAULT_RISK_CONFIG: StrategyProfileRiskConfig = {
  riskPerTradePercent: 0.5,
  riskMode: 'percentage',
  maxDailyDrawdownPercent: 3,
  maxWeeklyDrawdownPercent: 10,
  maxOpenRiskPercent: 3,
  maxTradesPerDay: 10,
  maxConsecutiveLosses: 3,
  sessions: ['london', 'newyork'],
};

export function buildRiskConfigFromProfileConfig(config: any): StrategyProfileRiskConfig {
  if (!config || typeof config !== 'object') {
    logger.warn(
      '[RiskConfigFromProfile] Invalid or missing profile config, using safe defaults'
    );
    return { ...DEFAULT_RISK_CONFIG };
  }

  function readNumber(
    obj: any,
    key: string,
    defaultValue: number,
    {
      min,
      max,
    }: { min?: number; max?: number } = {}
  ): number {
    let value = obj[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      logger.warn(
        `[RiskConfigFromProfile] Missing/invalid numeric field "${key}" in profile config, using default=${defaultValue}`
      );
      value = defaultValue;
    }
    if (typeof min === 'number' && value < min) {
      logger.warn(
        `[RiskConfigFromProfile] Field "${key}" below min (${value} < ${min}), clamping`
      );
      value = min;
    }
    if (typeof max === 'number' && value > max) {
      logger.warn(
        `[RiskConfigFromProfile] Field "${key}" above max (${value} > ${max}), clamping`
      );
      value = max;
    }
    return value;
  }

  const riskPerTradePercent = readNumber(
    config,
    'risk_per_trade_percent',
    DEFAULT_RISK_CONFIG.riskPerTradePercent,
    { min: 0.01, max: 5 }
  );

  const maxDailyDrawdownPercent = readNumber(
    config,
    'max_daily_drawdown_percent',
    DEFAULT_RISK_CONFIG.maxDailyDrawdownPercent,
    { min: 0.5, max: 50 }
  );

  const maxWeeklyDrawdownPercent = readNumber(
    config,
    'max_weekly_drawdown_percent',
    DEFAULT_RISK_CONFIG.maxWeeklyDrawdownPercent,
    { min: 1, max: 80 }
  );

  const maxOpenRiskPercent = readNumber(
    config,
    'max_open_risk_percent',
    DEFAULT_RISK_CONFIG.maxOpenRiskPercent,
    { min: 0.5, max: 20 }
  );

  const maxTradesPerDay = readNumber(
    config,
    'max_trades_per_day',
    DEFAULT_RISK_CONFIG.maxTradesPerDay,
    { min: 1, max: 100 }
  );

  return {
    riskPerTradePercent,
    riskMode: 'percentage' as const,
    maxDailyDrawdownPercent,
    maxWeeklyDrawdownPercent,
    maxOpenRiskPercent,
    maxTradesPerDay,
    maxConsecutiveLosses: readNumber(
      config,
      'max_consecutive_losses',
      DEFAULT_RISK_CONFIG.maxConsecutiveLosses,
      { min: 1, max: 10 }
    ),
    sessions: Array.isArray(config.sessions)
      ? config.sessions.filter((s: string) => ALL_SESSIONS.includes(s as SessionName))
      : [...DEFAULT_RISK_CONFIG.sessions],
  };
}

/**
 * Merge user-level config overrides on top of profile-level config.
 * User config takes precedence where provided.
 */
export function mergeUserConfig(
  profileConfig: StrategyProfileRiskConfig,
  userConfig: UserTradingConfig | null | undefined
): StrategyProfileRiskConfig {
  if (!userConfig || typeof userConfig !== 'object') {
    return profileConfig;
  }

  const merged = { ...profileConfig };

  // Risk mode & sizing
  if (userConfig.risk_mode === 'usd' && typeof userConfig.risk_per_trade_usd === 'number') {
    merged.riskMode = 'usd';
    merged.riskPerTradeUsd = Math.max(1, Math.min(10000, userConfig.risk_per_trade_usd));
  } else if (userConfig.risk_mode === 'percentage' && typeof userConfig.risk_per_trade_pct === 'number') {
    merged.riskMode = 'percentage';
    merged.riskPerTradePercent = Math.max(0.1, Math.min(5, userConfig.risk_per_trade_pct));
  }

  // Consecutive loss limit
  if (typeof userConfig.max_consecutive_losses === 'number') {
    merged.maxConsecutiveLosses = Math.max(1, Math.min(10, Math.floor(userConfig.max_consecutive_losses)));
  }

  // Session preferences
  if (Array.isArray(userConfig.sessions) && userConfig.sessions.length > 0) {
    const validSessions = userConfig.sessions.filter(
      (s) => ALL_SESSIONS.includes(s as SessionName)
    ) as SessionName[];
    if (validSessions.length > 0) {
      merged.sessions = validSessions;
    }
  }

  return merged;
}


