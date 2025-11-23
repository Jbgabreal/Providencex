import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface KillSwitchConfig {
  enabled: boolean; // Default: false (must be explicitly enabled)

  dailyMaxLossCurrency?: number; // e.g. 300
  dailyMaxLossPercent?: number; // e.g. 3 (of starting equity)
  weeklyMaxLossCurrency?: number;
  weeklyMaxLossPercent?: number;

  maxLosingStreak?: number; // e.g. 5
  maxDailyTrades?: number; // total trades
  maxWeeklyTrades?: number;

  maxSpreadPoints?: number; // per symbol or global default
  maxExposureRiskCurrency?: number; // combined estimated risk (from v4)

  autoResumeNextDay: boolean; // reset at daily session boundary
  autoResumeNextWeek: boolean; // reset at week boundary
  timezone: string; // e.g. 'America/New_York'
}

export function getKillSwitchConfig(): KillSwitchConfig {
  return {
    enabled: process.env.KILL_SWITCH_ENABLED === 'true', // Default: false

    dailyMaxLossCurrency: process.env.KILL_SWITCH_DAILY_MAX_LOSS_CURRENCY
      ? parseFloat(process.env.KILL_SWITCH_DAILY_MAX_LOSS_CURRENCY)
      : undefined,
    dailyMaxLossPercent: process.env.KILL_SWITCH_DAILY_MAX_LOSS_PERCENT
      ? parseFloat(process.env.KILL_SWITCH_DAILY_MAX_LOSS_PERCENT)
      : undefined,
    weeklyMaxLossCurrency: process.env.KILL_SWITCH_WEEKLY_MAX_LOSS_CURRENCY
      ? parseFloat(process.env.KILL_SWITCH_WEEKLY_MAX_LOSS_CURRENCY)
      : undefined,
    weeklyMaxLossPercent: process.env.KILL_SWITCH_WEEKLY_MAX_LOSS_PERCENT
      ? parseFloat(process.env.KILL_SWITCH_WEEKLY_MAX_LOSS_PERCENT)
      : undefined,

    maxLosingStreak: process.env.KILL_SWITCH_MAX_LOSING_STREAK
      ? parseInt(process.env.KILL_SWITCH_MAX_LOSING_STREAK, 10)
      : undefined,
    maxDailyTrades: process.env.KILL_SWITCH_MAX_DAILY_TRADES
      ? parseInt(process.env.KILL_SWITCH_MAX_DAILY_TRADES, 10)
      : undefined,
    maxWeeklyTrades: process.env.KILL_SWITCH_MAX_WEEKLY_TRADES
      ? parseInt(process.env.KILL_SWITCH_MAX_WEEKLY_TRADES, 10)
      : undefined,

    maxSpreadPoints: process.env.KILL_SWITCH_MAX_SPREAD_POINTS
      ? parseFloat(process.env.KILL_SWITCH_MAX_SPREAD_POINTS)
      : undefined,
    maxExposureRiskCurrency: process.env.KILL_SWITCH_MAX_EXPOSURE_RISK_CURRENCY
      ? parseFloat(process.env.KILL_SWITCH_MAX_EXPOSURE_RISK_CURRENCY)
      : undefined,

    autoResumeNextDay: process.env.KILL_SWITCH_AUTO_RESUME_NEXT_DAY !== 'false', // Default: true
    autoResumeNextWeek: process.env.KILL_SWITCH_AUTO_RESUME_NEXT_WEEK !== 'false', // Default: true
    timezone: process.env.PX_TIMEZONE || 'America/New_York',
  };
}

