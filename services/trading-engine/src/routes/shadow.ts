/**
 * Shadow Mode Routes — simulated trades, summary, mode switching.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { ShadowRepository } from '../shadow/ShadowRepository';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';

const logger = new Logger('ShadowRoutes');

export default function createShadowRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const shadowRepo = new ShadowRepository();
  const copyRepo = new CopyTradingRepository();

  router.use(authMiddleware, requireUser);

  // ---------- Shadow Summary ----------

  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const summary = await shadowRepo.getSummaryForUser(req.auth!.userId);
      res.json({ success: true, summary });
    } catch (error) {
      logger.error('[Shadow] Get summary failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Shadow Trades ----------

  router.get('/trades', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const trades = await shadowRepo.getTradesForUser(req.auth!.userId, { status, limit, offset });
      res.json({ success: true, trades });
    } catch (error) {
      logger.error('[Shadow] Get trades failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/trades/:id/timeline', async (req: Request, res: Response) => {
    try {
      const trade = await shadowRepo.getTradeById(req.params.id);
      if (!trade || trade.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      const events = await shadowRepo.getTradeEvents(req.params.id);
      res.json({ success: true, trade, events });
    } catch (error) {
      logger.error('[Shadow] Get trade timeline failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Subscription Mode ----------

  router.get('/subscriptions/:id/mode', async (req: Request, res: Response) => {
    try {
      const subs = await copyRepo.getSubscriptionsForUser(req.auth!.userId);
      const sub = subs.find((s: any) => s.id === req.params.id);
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });
      res.json({ success: true, mode: sub.mode, status: sub.status });
    } catch (error) {
      logger.error('[Shadow] Get mode failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/subscriptions/:id/mode', async (req: Request, res: Response) => {
    try {
      const { mode } = req.body || {};
      if (!mode || !['auto_trade', 'view_only', 'shadow'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be auto_trade, view_only, or shadow' });
      }

      const pool = (copyRepo as any).ensurePool();
      const result = await pool.query(
        `UPDATE follower_subscriptions SET mode = $3, updated_at = NOW()
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [req.params.id, req.auth!.userId, mode]
      );

      if (!result.rows[0]) return res.status(404).json({ error: 'Subscription not found' });

      logger.info(`[Shadow] Subscription ${req.params.id} mode changed to ${mode}`);
      res.json({ success: true, subscription: result.rows[0] });
    } catch (error) {
      logger.error('[Shadow] Update mode failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Shadow Performance ----------

  router.get('/performance', async (req: Request, res: Response) => {
    try {
      const summary = await shadowRepo.getSummaryForUser(req.auth!.userId);
      const openTrades = await shadowRepo.getTradesForUser(req.auth!.userId, { status: 'open', limit: 100 });
      const recentClosed = await shadowRepo.getTradesForUser(req.auth!.userId, { status: 'closed', limit: 20 });

      res.json({
        success: true,
        performance: {
          ...summary,
          openTrades,
          recentClosed,
        },
      });
    } catch (error) {
      logger.error('[Shadow] Get performance failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
