import { Logger } from '@providencex/shared-utils';

const logger = new Logger('RiskConfigFromProfile');

export interface StrategyProfileRiskConfig {
  riskPerTradePercent: number;          // e.g. 0.5
  maxDailyDrawdownPercent: number;      // e.g. 3
  maxWeeklyDrawdownPercent: number;     // e.g. 10
  maxOpenRiskPercent: number;           // e.g. 3
  maxTradesPerDay: number;              // e.g. 10
}

const DEFAULT_RISK_CONFIG: StrategyProfileRiskConfig = {
  riskPerTradePercent: 0.5,
  maxDailyDrawdownPercent: 3,
  maxWeeklyDrawdownPercent: 10,
  maxOpenRiskPercent: 3,
  maxTradesPerDay: 10,
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
    maxDailyDrawdownPercent,
    maxWeeklyDrawdownPercent,
    maxOpenRiskPercent,
    maxTradesPerDay,
  };
}


