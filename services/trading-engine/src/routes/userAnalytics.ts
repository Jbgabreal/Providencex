import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradeHistoryRepository } from '../db/TradeHistoryRepository';
import { AnalyticsService } from '../services/AnalyticsService';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';

const logger = new Logger('UserAnalyticsRoutes');

export default function createUserAnalyticsRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);
  const tradeHistoryRepo = new TradeHistoryRepository();
  const analyticsService = new AnalyticsService(tradeHistoryRepo);

  // Apply auth middleware to all routes
  router.use(authMiddleware, requireUser);

  // GET /api/user/analytics/trades
  // Returns trade history with optional filters
  router.get('/trades', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  try {
    const mt5AccountId = req.query.mt5_account_id as string | undefined;
    const strategyProfileId = req.query.strategy_profile_id as string | undefined;
    const limit = parseInt(req.query.limit as string || '100', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);
    const includeOpen = req.query.include_open !== 'false'; // Default: true

    const result = await tradeHistoryRepo.getTradesForUser({
      userId,
      mt5AccountId,
      strategyProfileId,
      limit: Math.min(Math.max(limit, 1), 500),
      offset: Math.max(offset, 0),
      includeOpen,
    });

    res.json({
      success: true,
      trades: result.trades,
      pagination: {
        limit,
        offset,
        total: result.total,
      },
    });
  } catch (error) {
    logger.error('[UserAnalyticsRoutes] Failed to get trades', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET /api/user/analytics/open-positions
  // Returns currently open positions
  router.get('/open-positions', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  try {
    const mt5AccountId = req.query.mt5_account_id as string | undefined;
    const strategyProfileId = req.query.strategy_profile_id as string | undefined;

    const positions = await tradeHistoryRepo.getOpenPositions({
      userId,
      mt5AccountId,
      strategyProfileId,
    });

    res.json({
      success: true,
      positions,
      count: positions.length,
    });
  } catch (error) {
    logger.error('[UserAnalyticsRoutes] Failed to get open positions', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET /api/user/analytics/summary
  // Returns summary statistics
  router.get('/summary', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  try {
    const mt5AccountId = req.query.mt5_account_id as string | undefined;
    const strategyProfileId = req.query.strategy_profile_id as string | undefined;

    const summary = await analyticsService.computeSummary({
      userId,
      mt5AccountId,
      strategyProfileId,
    });

    res.json({
      success: true,
      summary,
    });
  } catch (error) {
    logger.error('[UserAnalyticsRoutes] Failed to compute summary', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET /api/user/analytics/equity-curve
  // Returns equity curve data for charts
  router.get('/equity-curve', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  try {
    const mt5AccountId = req.query.mt5_account_id as string | undefined;
    const strategyProfileId = req.query.strategy_profile_id as string | undefined;
    const fromDate = req.query.from_date as string | undefined;
    const toDate = req.query.to_date as string | undefined;

    const equityCurve = await analyticsService.getEquityCurve({
      userId,
      mt5AccountId,
      strategyProfileId,
      fromDate,
      toDate,
    });

    res.json({
      success: true,
      equityCurve,
    });
  } catch (error) {
    logger.error('[UserAnalyticsRoutes] Failed to get equity curve', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  return router;
}

