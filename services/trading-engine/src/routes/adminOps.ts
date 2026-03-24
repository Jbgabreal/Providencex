/**
 * Admin Operations Routes — moderation, billing ops, referral ops, reviews, support.
 * All routes require admin role.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { AdminRepository } from '../admin/AdminRepository';
import { MarketplaceRepository } from '../marketplace/MarketplaceRepository';
import { BadgeService } from '../marketplace/BadgeService';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import type { BadgeType } from '../marketplace/types';

const logger = new Logger('AdminOpsRoutes');

export default function createAdminOpsRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireAdmin } = buildAuthMiddleware(config);

  const adminRepo = new AdminRepository();
  const marketplaceRepo = new MarketplaceRepository();
  const analyticsService = new MentorAnalyticsService();
  const badgeService = new BadgeService(marketplaceRepo, analyticsService);

  router.use(authMiddleware, requireAdmin);

  // ==================== Overview ====================

  router.get('/overview', async (_req: Request, res: Response) => {
    try {
      const stats = await adminRepo.getOverviewStats();
      res.json({ success: true, stats });
    } catch (error) {
      logger.error('[AdminOps] Overview failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/action-logs', async (req: Request, res: Response) => {
    try {
      const logs = await adminRepo.getActionLogs({
        targetType: req.query.target_type as string | undefined,
        targetId: req.query.target_id as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, logs });
    } catch (error) {
      logger.error('[AdminOps] Action logs failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Mentor Moderation ====================

  router.get('/mentors', async (req: Request, res: Response) => {
    try {
      const mentors = await adminRepo.getAllMentors({
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, mentors });
    } catch (error) {
      logger.error('[AdminOps] List mentors failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/mentors/:id/status', async (req: Request, res: Response) => {
    try {
      const { action, reason, notes } = req.body || {};
      if (!action) return res.status(400).json({ error: 'action required (approve, suspend, unsuspend)' });

      let updates: any = {};
      let actionType = action;
      if (action === 'approve') { updates = { isApproved: true, isActive: true }; }
      else if (action === 'suspend') { updates = { isActive: false }; }
      else if (action === 'unsuspend') { updates = { isActive: true }; }
      else return res.status(400).json({ error: 'Invalid action' });

      const mentor = await adminRepo.updateMentorStatus(req.params.id, updates);
      if (!mentor) return res.status(404).json({ error: 'Mentor not found' });

      await adminRepo.logAction({
        adminUserId: req.auth!.userId,
        targetType: 'mentor_profile',
        targetId: req.params.id,
        actionType,
        newStatus: action,
        reason, notes,
      });

      res.json({ success: true, mentor });
    } catch (error) {
      logger.error('[AdminOps] Update mentor status failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/mentors/:id/featured', async (req: Request, res: Response) => {
    try {
      const { featured, order } = req.body || {};
      await adminRepo.updateMentorStatus(req.params.id, {
        isFeatured: !!featured, featuredOrder: order || 0,
      });

      if (featured) {
        await badgeService.assignBadge(req.params.id, 'featured');
      } else {
        await badgeService.removeBadge(req.params.id, 'featured');
      }

      await adminRepo.logAction({
        adminUserId: req.auth!.userId,
        targetType: 'mentor_profile',
        targetId: req.params.id,
        actionType: featured ? 'feature' : 'unfeature',
      });

      res.json({ success: true });
    } catch (error) {
      logger.error('[AdminOps] Update featured failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/mentors/:id/badges', async (req: Request, res: Response) => {
    try {
      const { badge_type, action: badgeAction } = req.body || {};
      if (!badge_type) return res.status(400).json({ error: 'badge_type required' });

      if (badgeAction === 'remove') {
        await badgeService.removeBadge(req.params.id, badge_type as BadgeType);
      } else {
        await badgeService.assignBadge(req.params.id, badge_type as BadgeType);
      }

      await adminRepo.logAction({
        adminUserId: req.auth!.userId,
        targetType: 'mentor_badge',
        targetId: req.params.id,
        actionType: badgeAction === 'remove' ? 'remove_badge' : 'assign_badge',
        metadata: { badge_type },
      });

      const badges = await marketplaceRepo.getBadgesForMentor(req.params.id);
      res.json({ success: true, badges });
    } catch (error) {
      logger.error('[AdminOps] Update badges failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Billing Ops ====================

  router.get('/billing/invoices', async (req: Request, res: Response) => {
    try {
      const invoices = await adminRepo.getInvoices({
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, invoices });
    } catch (error) {
      logger.error('[AdminOps] List invoices failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/billing/invoices/:id/review', async (req: Request, res: Response) => {
    try {
      const { status, notes } = req.body || {};
      if (!status) return res.status(400).json({ error: 'status required' });

      const invoice = await adminRepo.updateInvoiceStatus(req.params.id, status, notes);
      if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

      await adminRepo.logAction({
        adminUserId: req.auth!.userId,
        targetType: 'crypto_payment_invoice',
        targetId: req.params.id,
        actionType: 'review_invoice',
        newStatus: status, notes,
      });

      res.json({ success: true, invoice });
    } catch (error) {
      logger.error('[AdminOps] Review invoice failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Referral Ops ====================

  router.get('/referrals/commissions', async (req: Request, res: Response) => {
    try {
      const commissions = await adminRepo.getCommissions({
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, commissions });
    } catch (error) {
      logger.error('[AdminOps] List commissions failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/referrals/commissions/:id/status', async (req: Request, res: Response) => {
    try {
      const { status, notes } = req.body || {};
      if (!status || !['earned', 'payout_ready', 'cancelled', 'paid_out'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      const commission = await adminRepo.updateCommissionStatus(req.params.id, status, notes);
      if (!commission) return res.status(404).json({ error: 'Commission not found' });

      await adminRepo.logAction({
        adminUserId: req.auth!.userId,
        targetType: 'referral_commission',
        targetId: req.params.id,
        actionType: status === 'cancelled' ? 'reverse_commission' : 'confirm_commission',
        newStatus: status, notes,
      });

      res.json({ success: true, commission });
    } catch (error) {
      logger.error('[AdminOps] Update commission failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/referrals/attributions', async (req: Request, res: Response) => {
    try {
      const attributions = await adminRepo.getAttributions(parseInt(req.query.limit as string) || 50);
      res.json({ success: true, attributions });
    } catch (error) {
      logger.error('[AdminOps] List attributions failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Review Moderation ====================

  router.get('/reviews', async (req: Request, res: Response) => {
    try {
      const reviews = await adminRepo.getReviews({
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, reviews });
    } catch (error) {
      logger.error('[AdminOps] List reviews failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/reviews/:id/moderation', async (req: Request, res: Response) => {
    try {
      const { status } = req.body || {};
      if (!status || !['approved', 'rejected', 'flagged'].includes(status)) {
        return res.status(400).json({ error: 'Invalid moderation status' });
      }

      const review = await adminRepo.updateReviewStatus(req.params.id, status);
      if (!review) return res.status(404).json({ error: 'Review not found' });

      // Refresh mentor rating after moderation
      if (review.mentor_profile_id) {
        await marketplaceRepo.refreshMentorRating(review.mentor_profile_id);
      }

      await adminRepo.logAction({
        adminUserId: req.auth!.userId,
        targetType: 'mentor_review',
        targetId: req.params.id,
        actionType: `${status}_review`,
        newStatus: status,
      });

      res.json({ success: true, review });
    } catch (error) {
      logger.error('[AdminOps] Moderate review failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Support / Debug ====================

  router.get('/support/subscriptions', async (req: Request, res: Response) => {
    try {
      const subs = await adminRepo.getSubscriptions({
        userId: req.query.user_id as string | undefined,
        mode: req.query.mode as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, subscriptions: subs });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/support/copied-trades', async (req: Request, res: Response) => {
    try {
      const trades = await adminRepo.getCopiedTrades({
        userId: req.query.user_id as string | undefined,
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, trades });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/support/blocked-attempts', async (req: Request, res: Response) => {
    try {
      const blocked = await adminRepo.getBlockedAttempts(parseInt(req.query.limit as string) || 50);
      res.json({ success: true, blocked });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/support/imports', async (req: Request, res: Response) => {
    try {
      const candidates = await adminRepo.getImportCandidates({
        status: req.query.status as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, candidates });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/support/shadow', async (req: Request, res: Response) => {
    try {
      const trades = await adminRepo.getShadowTrades({
        userId: req.query.user_id as string | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, trades });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
