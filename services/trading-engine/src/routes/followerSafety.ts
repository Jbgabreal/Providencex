/**
 * Follower Safety Routes — safety settings, subscription status, trade timeline, blocked attempts.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { SafetyRepository } from '../copytrading/SafetyRepository';
import { SafetyGuardService } from '../copytrading/SafetyGuardService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import type { SafetySettings } from '../copytrading/SafetyTypes';

const logger = new Logger('FollowerSafetyRoutes');

export default function createFollowerSafetyRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const safetyRepo = new SafetyRepository();
  const safetyGuard = new SafetyGuardService(safetyRepo);
  const copyRepo = new CopyTradingRepository();

  router.use(authMiddleware, requireUser);

  // ---------- Safety Settings ----------

  /**
   * GET /subscriptions/:id/safety
   * Get safety settings + status for a subscription.
   */
  router.get('/subscriptions/:id/safety', async (req: Request, res: Response) => {
    try {
      const sub = await safetyRepo.getSubscriptionWithSafety(req.params.id);
      if (!sub || sub.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const dailyLoss = await safetyRepo.getDailyLossForSubscription(sub.id);
      const openTradeCount = await safetyRepo.getOpenTradeCount(sub.id);
      const recentBlocked = await safetyRepo.getBlockedAttemptsForSubscription(sub.id, 10);
      const guardrailEvents = await safetyRepo.getGuardrailEvents(sub.id, 10);

      res.json({
        success: true,
        safety: {
          settings: sub.safety_settings,
          blockedSymbols: sub.blocked_symbols,
          autoDisabledAt: sub.auto_disabled_at,
          autoDisabledReason: sub.auto_disabled_reason,
          status: sub.status,
          currentDailyLoss: dailyLoss,
          currentOpenTrades: openTradeCount,
        },
        recentBlocked,
        guardrailEvents,
      });
    } catch (error) {
      logger.error('[Safety] Get safety settings failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /subscriptions/:id/safety
   * Update safety settings for a subscription.
   */
  router.patch('/subscriptions/:id/safety', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const sub = await safetyRepo.getSubscriptionWithSafety(req.params.id);
      if (!sub || sub.user_id !== userId) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      // Merge new settings with existing
      const currentSettings: SafetySettings = sub.safety_settings || {};
      const updates = req.body || {};

      const newSettings: SafetySettings = {
        ...currentSettings,
        ...(updates.max_daily_loss_usd !== undefined && { max_daily_loss_usd: updates.max_daily_loss_usd }),
        ...(updates.max_concurrent_trades !== undefined && { max_concurrent_trades: updates.max_concurrent_trades }),
        ...(updates.slippage_tolerance_pct !== undefined && { slippage_tolerance_pct: updates.slippage_tolerance_pct }),
        ...(updates.late_entry_seconds !== undefined && { late_entry_seconds: updates.late_entry_seconds }),
        ...(updates.copy_market_orders !== undefined && { copy_market_orders: updates.copy_market_orders }),
        ...(updates.copy_pending_orders !== undefined && { copy_pending_orders: updates.copy_pending_orders }),
        ...(updates.sync_breakeven !== undefined && { sync_breakeven: updates.sync_breakeven }),
        ...(updates.sync_close_all !== undefined && { sync_close_all: updates.sync_close_all }),
        ...(updates.auto_disable_on_daily_loss !== undefined && { auto_disable_on_daily_loss: updates.auto_disable_on_daily_loss }),
        ...(updates.max_lot_size !== undefined && { max_lot_size: updates.max_lot_size }),
        ...(updates.allowed_sessions !== undefined && { allowed_sessions: updates.allowed_sessions }),
      };

      const saved = await safetyRepo.updateSafetySettings(req.params.id, userId, newSettings);
      res.json({ success: true, settings: saved });
    } catch (error) {
      logger.error('[Safety] Update safety settings failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Subscription Status ----------

  /**
   * GET /subscriptions/:id/status
   * Get subscription safety status summary.
   */
  router.get('/subscriptions/:id/status', async (req: Request, res: Response) => {
    try {
      const sub = await safetyRepo.getSubscriptionWithSafety(req.params.id);
      if (!sub || sub.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Subscription not found' });
      }

      const dailyLoss = await safetyRepo.getDailyLossForSubscription(sub.id);
      const openTradeCount = await safetyRepo.getOpenTradeCount(sub.id);
      const settings: SafetySettings = sub.safety_settings || {};

      res.json({
        success: true,
        status: {
          subscriptionStatus: sub.status,
          autoDisabledAt: sub.auto_disabled_at,
          autoDisabledReason: sub.auto_disabled_reason,
          currentDailyLoss: dailyLoss,
          dailyLossLimit: settings.max_daily_loss_usd || null,
          dailyLossBreached: settings.max_daily_loss_usd ? dailyLoss >= settings.max_daily_loss_usd : false,
          currentOpenTrades: openTradeCount,
          maxConcurrentTrades: settings.max_concurrent_trades || null,
          concurrentTradesBreached: settings.max_concurrent_trades ? openTradeCount >= settings.max_concurrent_trades : false,
        },
      });
    } catch (error) {
      logger.error('[Safety] Get subscription status failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /subscriptions/:id/re-enable
   * Re-enable a subscription that was auto-disabled.
   */
  router.post('/subscriptions/:id/re-enable', async (req: Request, res: Response) => {
    try {
      const success = await safetyGuard.reEnable(req.params.id, req.auth!.userId);
      if (!success) {
        return res.status(400).json({ error: 'Subscription not found or not auto-disabled' });
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('[Safety] Re-enable subscription failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Trade Timeline ----------

  /**
   * GET /copied-trades/:id/timeline
   * Get lifecycle timeline for a copied trade.
   */
  router.get('/copied-trades/:id/timeline', async (req: Request, res: Response) => {
    try {
      const trade = await copyRepo.getCopiedTradeById(req.params.id);
      if (!trade || trade.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Trade not found' });
      }

      const events = await safetyRepo.getTradeEvents(req.params.id);
      res.json({ success: true, trade, events });
    } catch (error) {
      logger.error('[Safety] Get trade timeline failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Blocked Attempts ----------

  /**
   * GET /blocked-copy-attempts
   * List blocked copy attempts for the current user.
   */
  router.get('/blocked-copy-attempts', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const blocked = await safetyRepo.getBlockedAttempts(req.auth!.userId, limit);
      res.json({ success: true, blocked });
    } catch (error) {
      logger.error('[Safety] Get blocked attempts failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
