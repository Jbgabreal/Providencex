import { getTodayNewsMap } from './newsScanService';
import { CanTradeResponse, NewsWindow } from '@providencex/shared-types';
import { getNowInPXTimezone, isTimeInWindow, Logger } from '@providencex/shared-utils';

const logger = new Logger('TradingCheckService');

export async function canTradeNow(strategy?: 'low' | 'high'): Promise<CanTradeResponse> {
  const now = getNowInPXTimezone();
  const todayMap = await getTodayNewsMap();

  // If no news map exists for today, assume it's safe to trade
  if (!todayMap || todayMap.avoid_windows.length === 0) {
    logger.debug('No avoid windows found for today');
    return {
      can_trade: true,
      inside_avoid_window: false,
      active_window: null,
    };
  }

  // Check if current time is within any avoid window
  for (const window of todayMap.avoid_windows) {
    if (isTimeInWindow(now, window.start_time, window.end_time)) {
      logger.info(`Currently inside avoid window: ${window.event_name} (${window.currency}, risk_score: ${window.risk_score}, reason: ${window.reason})`);
      if (window.is_critical) {
        logger.warn(`CRITICAL EVENT BLOCKING TRADING: ${window.event_name} - ${window.reason}`);
      }
      return {
        can_trade: false,
        inside_avoid_window: true,
        active_window: window,
      };
    }
  }

  return {
    can_trade: true,
    inside_avoid_window: false,
    active_window: null,
  };
}

