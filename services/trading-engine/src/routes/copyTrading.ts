/**
 * Copy Trading Routes — follower subscription management and copied trade viewing.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { TenantRepository } from '../db/TenantRepository';
import { BrokerAdapterFactory } from '../brokers/BrokerAdapterFactory';

const logger = new Logger('CopyTradingRoutes');

export default function createCopyTradingRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);
  const repo = new CopyTradingRepository();
  const tenantRepo = new TenantRepository();

  // ---------- Public: Browse Mentors ----------

  router.get('/mentors', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const mentors = await repo.getPublicMentors(limit, offset);

      // Attach performance stats to each mentor
      const mentorsWithPerformance = await Promise.all(
        mentors.map(async (mentor) => {
          const performance = await repo.getMentorPerformance(mentor.id);
          return { ...mentor, performance };
        })
      );

      res.json({ success: true, mentors: mentorsWithPerformance });
    } catch (error) {
      logger.error('[CopyTrading] List mentors failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/mentors/:mentorProfileId', async (req: Request, res: Response) => {
    try {
      const mentor = await repo.getMentorProfileById(req.params.mentorProfileId);
      if (!mentor || !mentor.is_active || !mentor.is_approved) {
        return res.status(404).json({ error: 'Mentor not found' });
      }

      const { signals } = await repo.getSignalsByMentor(mentor.id, undefined, 10, 0);
      const performance = await repo.getMentorPerformance(mentor.id);

      res.json({ success: true, mentor, recent_signals: signals, performance });
    } catch (error) {
      logger.error('[CopyTrading] Get mentor failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Auth Required ----------
  router.use(authMiddleware, requireUser);

  // ---------- Subscriptions ----------

  router.post('/subscriptions', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const { mentor_profile_id, mt5_account_id, mode, risk_mode, risk_amount, selected_tp_levels, selected_symbols } = req.body || {};

    if (!mentor_profile_id || !mt5_account_id) {
      return res.status(400).json({ error: 'mentor_profile_id and mt5_account_id are required' });
    }

    // Validate mentor exists and is approved
    const mentor = await repo.getMentorProfileById(mentor_profile_id);
    if (!mentor || !mentor.is_active || !mentor.is_approved) {
      return res.status(400).json({ error: 'Invalid or inactive mentor' });
    }

    // Validate account belongs to user
    const accounts = await tenantRepo.getMt5AccountsForUser(userId);
    const account = accounts.find((a) => a.id === mt5_account_id);
    if (!account) {
      return res.status(400).json({ error: 'MT5 account not found' });
    }

    // Can't subscribe to yourself
    if (mentor.user_id === userId) {
      return res.status(400).json({ error: 'Cannot subscribe to your own signals' });
    }

    try {
      const subscription = await repo.createSubscription({
        userId,
        mentorProfileId: mentor_profile_id,
        mt5AccountId: mt5_account_id,
        mode: mode || 'auto_trade',
        riskMode: risk_mode || 'percentage',
        riskAmount: risk_amount || 1.0,
        selectedTpLevels: selected_tp_levels || [1],
        selectedSymbols: selected_symbols || [],
      });

      // Increment follower count
      await repo.incrementFollowerCount(mentor_profile_id, 1);

      res.status(201).json({ success: true, subscription });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Already subscribed to this mentor with this account' });
      }
      logger.error('[CopyTrading] Subscribe failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/subscriptions', async (req: Request, res: Response) => {
    try {
      const subscriptions = await repo.getSubscriptionsForUser(req.auth!.userId);
      res.json({ success: true, subscriptions });
    } catch (error) {
      logger.error('[CopyTrading] List subscriptions failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/subscriptions/:id/config', async (req: Request, res: Response) => {
    try {
      const updated = await repo.updateSubscriptionConfig(req.params.id, req.auth!.userId, {
        mode: req.body.mode,
        riskMode: req.body.risk_mode,
        riskAmount: req.body.risk_amount,
        selectedTpLevels: req.body.selected_tp_levels,
        selectedSymbols: req.body.selected_symbols,
      });
      if (!updated) return res.status(404).json({ error: 'Subscription not found' });
      res.json({ success: true, subscription: updated });
    } catch (error) {
      logger.error('[CopyTrading] Update subscription config failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/subscriptions/:id/pause', async (req, res) => {
    try {
      const sub = await repo.updateSubscriptionStatus(req.params.id, req.auth!.userId, 'paused');
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });
      res.json({ success: true, subscription: sub });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/subscriptions/:id/resume', async (req, res) => {
    try {
      const sub = await repo.updateSubscriptionStatus(req.params.id, req.auth!.userId, 'active');
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });
      res.json({ success: true, subscription: sub });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/subscriptions/:id/stop', async (req, res) => {
    try {
      const sub = await repo.updateSubscriptionStatus(req.params.id, req.auth!.userId, 'stopped');
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });

      // Decrement follower count
      if (sub.mentor_profile_id) {
        await repo.incrementFollowerCount(sub.mentor_profile_id, -1);
      }

      res.json({ success: true, subscription: sub });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Copied Trades ----------

  router.get('/trades', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const { trades, total } = await repo.getCopiedTradesForUser(req.auth!.userId, limit, offset);
      res.json({ success: true, trades, total });
    } catch (error) {
      logger.error('[CopyTrading] List copied trades failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/trades/:id/close', async (req: Request, res: Response) => {
    try {
      const trade = await repo.getCopiedTradeById(req.params.id);
      if (!trade || trade.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      if (trade.status !== 'open' || !trade.mt5_ticket) {
        return res.status(400).json({ error: 'Trade is not open' });
      }

      // Close via broker
      const accounts = await tenantRepo.getMt5AccountsForUser(trade.user_id);
      const account = accounts.find((a) => a.id === trade.mt5_account_id);
      if (!account) return res.status(400).json({ error: 'Account not found' });

      const creds = account.broker_credentials || account.connection_meta || {};
      const adapter = BrokerAdapterFactory.create(account.broker_type as any, {
        baseUrl: creds.baseUrl || process.env.MT5_CONNECTOR_URL,
        login: Number(creds.login || account.account_number),
        password: creds.password,
        server: account.server,
        apiToken: creds.apiToken,
      });

      const result = await adapter.closeTrade(trade.mt5_ticket, req.body?.reason || 'follower_manual_close');
      if (result.success) {
        await repo.closeCopiedTrade(trade.id, null, null, 'follower_manual_close');
        res.json({ success: true });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      logger.error('[CopyTrading] Close copied trade failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
