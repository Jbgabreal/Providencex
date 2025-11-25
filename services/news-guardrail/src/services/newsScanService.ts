import { getDbPool } from '../db/client';
import { captureForexFactoryScreenshot } from './screenshotService';
import { analyzeScreenshot } from './openaiService';
import { DailyNewsMap, NewsWindow } from '@providencex/shared-types';
import { formatDateForPX, getNowInPXTimezone, Logger } from '@providencex/shared-utils';

const logger = new Logger('NewsScanService');

export async function performDailyNewsScan(): Promise<DailyNewsMap> {
  logger.info('Starting daily news scan');

  try {
    // Step 1: Capture screenshot
    logger.info('Capturing ForexFactory screenshot...');
    const screenshot = await captureForexFactoryScreenshot();

    // Step 2: Analyze with OpenAI
    logger.info('Analyzing screenshot with OpenAI...');
    const avoidWindows = await analyzeScreenshot(screenshot);

    // Step 3: Store in database
    const today = formatDateForPX(getNowInPXTimezone());
    const pool = getDbPool();

    const result = await pool.query(
      `INSERT INTO daily_news_windows (date, avoid_windows, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (date) 
       DO UPDATE SET avoid_windows = $2::jsonb, updated_at = NOW()
       RETURNING *`,
      [today, JSON.stringify(avoidWindows)]
    );

    const dailyNewsMap: DailyNewsMap = {
      id: result.rows[0].id,
      date: result.rows[0].date,
      avoid_windows: result.rows[0].avoid_windows as NewsWindow[],
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
    };

    logger.info(`Daily news scan completed. Found ${avoidWindows.length} avoid windows.`);
    const criticalCount = avoidWindows.filter(w => w.is_critical).length;
    const avgRiskScore = avoidWindows.length > 0
      ? Math.round(avoidWindows.reduce((sum, w) => sum + w.risk_score, 0) / avoidWindows.length)
      : 0;
    logger.info(`Scan summary: ${criticalCount} critical events, average risk score: ${avgRiskScore}/100`);
    return dailyNewsMap;
  } catch (error) {
    logger.error('Daily news scan failed', error);
    throw error;
  }
}

export async function getTodayNewsMap(): Promise<DailyNewsMap | null> {
  const today = formatDateForPX(getNowInPXTimezone());
  return getNewsMapForDate(today);
}

/**
 * Get news map for a specific date (YYYY-MM-DD format)
 * Useful for backtesting historical dates
 */
export async function getNewsMapForDate(dateStr: string): Promise<DailyNewsMap | null> {
  const pool = getDbPool();

  const result = await pool.query(
    'SELECT * FROM daily_news_windows WHERE date = $1',
    [dateStr]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return {
    id: result.rows[0].id,
    date: result.rows[0].date,
    avoid_windows: result.rows[0].avoid_windows as NewsWindow[],
    created_at: result.rows[0].created_at,
    updated_at: result.rows[0].updated_at,
  };
}

