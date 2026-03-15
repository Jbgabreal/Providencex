/**
 * Mentor Signal Routes — signal publishing and management for mentors.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { CopyTradingOrchestrator } from '../copytrading/CopyTradingOrchestrator';
import { CopyTradingUpdatePropagator } from '../copytrading/CopyTradingUpdatePropagator';
import { CopyTradingRiskService } from '../copytrading/CopyTradingRiskService';
import { TenantRepository } from '../db/TenantRepository';

const logger = new Logger('MentorRoutes');

export default function createMentorRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);
  const repo = new CopyTradingRepository();
  const tenantRepo = new TenantRepository();
  const riskService = new CopyTradingRiskService();
  const orchestrator = new CopyTradingOrchestrator(repo, tenantRepo, riskService);
  const propagator = new CopyTradingUpdatePropagator(repo, tenantRepo);

  router.use(authMiddleware, requireUser);

  // ---------- Mentor Profile ----------

  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
      res.json({ success: true, mentor_profile: profile });
    } catch (error) {
      logger.error('[MentorRoutes] Get profile failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/profile', async (req: Request, res: Response) => {
    const { display_name, bio } = req.body || {};
    if (!display_name) return res.status(400).json({ error: 'display_name is required' });

    try {
      const existing = await repo.getMentorProfileByUserId(req.auth!.userId);
      if (existing) return res.status(409).json({ error: 'Mentor profile already exists' });

      const profile = await repo.createMentorProfile(req.auth!.userId, display_name, bio);
      res.status(201).json({ success: true, mentor_profile: profile });
    } catch (error) {
      logger.error('[MentorRoutes] Create profile failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/profile', async (req: Request, res: Response) => {
    try {
      const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
      if (!profile) return res.status(404).json({ error: 'No mentor profile found' });

      const updated = await repo.updateMentorProfile(profile.id, req.body);
      res.json({ success: true, mentor_profile: updated });
    } catch (error) {
      logger.error('[MentorRoutes] Update profile failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Signals ----------

  router.post('/signals', async (req: Request, res: Response) => {
    const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
    if (!profile || !profile.is_active || !profile.is_approved) {
      return res.status(403).json({ error: 'You must be an approved mentor to publish signals' });
    }

    const { symbol, direction, order_kind, entry_price, stop_loss, tp1, tp2, tp3, tp4, notes, idempotency_key } = req.body || {};
    if (!symbol || !direction || !entry_price || !stop_loss || !idempotency_key) {
      return res.status(400).json({ error: 'symbol, direction, entry_price, stop_loss, and idempotency_key are required' });
    }

    try {
      const signal = await repo.createSignal({
        mentorProfileId: profile.id,
        symbol: symbol.toUpperCase(),
        direction: direction.toUpperCase(),
        orderKind: order_kind || 'market',
        entryPrice: Number(entry_price),
        stopLoss: Number(stop_loss),
        tp1: tp1 ? Number(tp1) : undefined,
        tp2: tp2 ? Number(tp2) : undefined,
        tp3: tp3 ? Number(tp3) : undefined,
        tp4: tp4 ? Number(tp4) : undefined,
        notes,
        idempotencyKey: idempotency_key,
      });

      // Fan out to followers
      const fanoutSummary = await orchestrator.fanoutSignal(signal.id);

      res.status(201).json({ success: true, signal, fanout_summary: fanoutSummary });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Signal with this idempotency_key already exists' });
      }
      logger.error('[MentorRoutes] Create signal failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/signals', async (req: Request, res: Response) => {
    const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
    if (!profile) return res.status(404).json({ error: 'No mentor profile' });

    try {
      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const { signals, total } = await repo.getSignalsByMentor(profile.id, status, limit, offset);
      res.json({ success: true, signals, total });
    } catch (error) {
      logger.error('[MentorRoutes] List signals failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/signals/:signalId', async (req: Request, res: Response) => {
    try {
      const signal = await repo.getSignalById(req.params.signalId);
      if (!signal) return res.status(404).json({ error: 'Signal not found' });

      // Verify ownership
      const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
      if (!profile || signal.mentor_profile_id !== profile.id) {
        return res.status(403).json({ error: 'Not your signal' });
      }

      const summary = await repo.getCopiedTradesSummaryBySignal(signal.id);
      res.json({ success: true, signal, copied_trades_summary: summary });
    } catch (error) {
      logger.error('[MentorRoutes] Get signal failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Signal Updates ----------

  router.post('/signals/:signalId/update', async (req: Request, res: Response) => {
    const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
    if (!profile) return res.status(403).json({ error: 'Not a mentor' });

    const signal = await repo.getSignalById(req.params.signalId);
    if (!signal || signal.mentor_profile_id !== profile.id) {
      return res.status(404).json({ error: 'Signal not found' });
    }
    if (signal.status === 'closed' || signal.status === 'cancelled') {
      return res.status(400).json({ error: `Signal is already ${signal.status}` });
    }

    const { update_type, new_sl, close_tp_level, new_tp_value, notes, idempotency_key } = req.body || {};
    if (!update_type || !idempotency_key) {
      return res.status(400).json({ error: 'update_type and idempotency_key are required' });
    }

    try {
      const update = await repo.createSignalUpdate({
        mentorSignalId: signal.id,
        updateType: update_type,
        newSl: new_sl ? Number(new_sl) : undefined,
        closeTpLevel: close_tp_level ? Number(close_tp_level) : undefined,
        newTpValue: new_tp_value ? Number(new_tp_value) : undefined,
        notes,
        idempotencyKey: idempotency_key,
      });

      const propagationSummary = await propagator.propagateUpdate(update.id);

      res.json({ success: true, update, propagation_summary: propagationSummary });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Update with this idempotency_key already exists' });
      }
      logger.error('[MentorRoutes] Signal update failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Subscribers (anonymized) ----------

  router.get('/subscribers', async (req: Request, res: Response) => {
    const profile = await repo.getMentorProfileByUserId(req.auth!.userId);
    if (!profile) return res.status(404).json({ error: 'No mentor profile' });

    res.json({
      success: true,
      total_followers: profile.total_followers,
    });
  });

  return router;
}
