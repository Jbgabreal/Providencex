import { getTodayNewsMap } from './newsScanService';
import { CanTradeResponse, NewsWindow } from '@providencex/shared-types';
import { getNowInPXTimezone, isTimeInWindow, Logger } from '@providencex/shared-utils';

const logger = new Logger('TradingCheckService');

/**
 * How many minutes ahead to warn about upcoming high-risk events.
 * Low-risk strategy is more conservative (45 min); high-risk allows closer (20 min).
 */
const LOOKAHEAD_MINUTES: Record<'low' | 'high', number> = {
  low: 45,
  high: 20,
};

/** Minimum risk_score that triggers a look-ahead block. */
const LOOKAHEAD_BLOCK_SCORE = 70;

export async function canTradeNow(strategy?: 'low' | 'high'): Promise<CanTradeResponse> {
  const now = getNowInPXTimezone();
  const nowMs = now.toMillis();
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

  // ── 1. Check if current time is inside ANY avoid window ──────────────────
  const activeWindows: NewsWindow[] = todayMap.avoid_windows.filter(w =>
    isTimeInWindow(now, w.start_time, w.end_time)
  );

  if (activeWindows.length > 0) {
    // Sort by risk_score descending so the highest-risk event surfaces first
    activeWindows.sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
    const primary = activeWindows[0];
    logger.info(
      `Inside avoid window: ${primary.event_name} (${primary.currency}, ` +
      `risk_score: ${primary.risk_score}) — ${activeWindows.length} window(s) active`
    );
    if (primary.is_critical) {
      logger.warn(`CRITICAL EVENT BLOCKING TRADING: ${primary.event_name} — ${primary.reason}`);
    }
    return {
      can_trade: false,
      inside_avoid_window: true,
      active_window: primary,
    };
  }

  // ── 2. Look-ahead: block if a high-risk event starts soon ────────────────
  const lookaheadMs = (LOOKAHEAD_MINUTES[strategy ?? 'low']) * 60_000;
  const blockScore = LOOKAHEAD_BLOCK_SCORE;

  const upcomingHighRisk = todayMap.avoid_windows
    .filter(w => {
      const windowStartMs = new Date(w.start_time).getTime();
      const minutesUntilStart = (windowStartMs - nowMs) / 60_000;
      // Only windows starting in the future within the look-ahead horizon
      return minutesUntilStart > 0 &&
             minutesUntilStart <= LOOKAHEAD_MINUTES[strategy ?? 'low'] &&
             (w.risk_score ?? 0) >= blockScore;
    })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  if (upcomingHighRisk.length > 0) {
    const next = upcomingHighRisk[0];
    const minutesAway = Math.round(
      (new Date(next.start_time).getTime() - nowMs) / 60_000
    );
    logger.warn(
      `Look-ahead block: ${next.event_name} (${next.currency}, risk_score: ${next.risk_score}) ` +
      `starts in ${minutesAway} min — blocking trades`
    );
    return {
      can_trade: false,
      inside_avoid_window: false,
      active_window: { ...next, reason: `Upcoming in ${minutesAway} min: ${next.reason}` },
    };
  }

  return {
    can_trade: true,
    inside_avoid_window: false,
    active_window: null,
  };
}

