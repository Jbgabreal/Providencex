/**
 * Marketplace Routes — leaderboard, featured, badges, reviews, categories, similar mentors.
 * Extends the public mentor marketplace with Phase 6 features.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import { MarketplaceRepository } from '../marketplace/MarketplaceRepository';
import { LeaderboardService } from '../marketplace/LeaderboardService';
import { BadgeService } from '../marketplace/BadgeService';
import { MARKETPLACE_CATEGORIES, type LeaderboardSort, type BadgeType } from '../marketplace/types';

const logger = new Logger('MarketplaceRoutes');

export default function createMarketplaceRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser, requireAdmin } = buildAuthMiddleware(config);

  const copyRepo = new CopyTradingRepository();
  const analyticsService = new MentorAnalyticsService();
  const marketplaceRepo = new MarketplaceRepository();
  const leaderboardService = new LeaderboardService(copyRepo, analyticsService, marketplaceRepo);
  const badgeService = new BadgeService(marketplaceRepo, analyticsService);

  // ==================== Public Routes ====================

  /**
   * GET /api/public/marketplace/leaderboard
   * Query: ?sort=performance|win_rate|followers|low_drawdown|newest|rating&limit=20
   */
  router.get('/leaderboard', async (req: Request, res: Response) => {
    try {
      const sort = (req.query.sort as LeaderboardSort) || 'performance';
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const entries = await leaderboardService.getLeaderboard(sort, limit);
      res.json({ success: true, leaderboard: entries, sort });
    } catch (error) {
      logger.error('[Marketplace] Leaderboard failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/marketplace/featured
   */
  router.get('/featured', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const mentors = await marketplaceRepo.getFeaturedMentors(limit);

      // Attach analytics + badges
      const enriched = await Promise.all(
        mentors.map(async (mentor) => {
          try {
            const analytics = await analyticsService.getFullAnalytics(mentor.id);
            const badges = await marketplaceRepo.getBadgesForMentor(mentor.id);
            return { ...mentor, analytics: { win_rate: analytics.win_rate, total_pnl: analytics.total_pnl, profit_factor: analytics.profit_factor, risk_label: analytics.risk_label, total_signals: analytics.total_signals, last_30d: analytics.last_30d }, badges };
          } catch {
            return { ...mentor, analytics: null, badges: [] };
          }
        })
      );

      res.json({ success: true, mentors: enriched });
    } catch (error) {
      logger.error('[Marketplace] Featured failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/marketplace/categories
   */
  router.get('/categories', async (_req: Request, res: Response) => {
    res.json({ success: true, categories: MARKETPLACE_CATEGORIES });
  });

  /**
   * GET /api/public/marketplace/mentors/:id/badges
   */
  router.get('/mentors/:id/badges', async (req: Request, res: Response) => {
    try {
      const badges = await marketplaceRepo.getBadgesForMentor(req.params.id);
      res.json({ success: true, badges });
    } catch (error) {
      logger.error('[Marketplace] Get badges failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/marketplace/mentors/:id/reviews
   */
  router.get('/mentors/:id/reviews', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const reviews = await marketplaceRepo.getReviewsForMentor(req.params.id, limit);
      const ratingSummary = await marketplaceRepo.getRatingSummary(req.params.id);
      res.json({ success: true, reviews, ratingSummary });
    } catch (error) {
      logger.error('[Marketplace] Get reviews failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/marketplace/mentors/:id/similar
   */
  router.get('/mentors/:id/similar', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 4;
      const similar = await marketplaceRepo.getSimilarMentors(req.params.id, limit);

      // Attach lightweight analytics
      const enriched = await Promise.all(
        similar.map(async (m) => {
          try {
            const a = await analyticsService.getFullAnalytics(m.id);
            const badges = await marketplaceRepo.getBadgesForMentor(m.id);
            return { ...m, analytics: { win_rate: a.win_rate, total_pnl: a.total_pnl, risk_label: a.risk_label, total_signals: a.total_signals }, badges };
          } catch {
            return { ...m, analytics: null, badges: [] };
          }
        })
      );

      res.json({ success: true, mentors: enriched });
    } catch (error) {
      logger.error('[Marketplace] Similar mentors failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Auth Required: Reviews ====================

  /**
   * POST /api/public/marketplace/mentors/:id/reviews
   * Create a review (requires auth + subscription to mentor).
   */
  router.post('/mentors/:id/reviews', authMiddleware, requireUser, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const mentorProfileId = req.params.id;
      const { rating, review_text } = req.body || {};

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }
      if (review_text && review_text.length > 500) {
        return res.status(400).json({ error: 'Review text must be 500 characters or less' });
      }

      // Check eligibility: must have/had a subscription to this mentor
      const { eligible, subscriptionId } = await marketplaceRepo.hasSubscriptionToMentor(userId, mentorProfileId);
      if (!eligible) {
        return res.status(403).json({ error: 'You must be subscribed to this mentor to leave a review' });
      }

      // Prevent self-review
      const mentor = await copyRepo.getMentorProfileById(mentorProfileId);
      if (mentor && mentor.user_id === userId) {
        return res.status(400).json({ error: 'Cannot review your own profile' });
      }

      // Check for existing review
      const existing = await marketplaceRepo.getReviewByUser(mentorProfileId, userId);
      if (existing) {
        return res.status(409).json({ error: 'You have already reviewed this mentor' });
      }

      const review = await marketplaceRepo.createReview({
        mentorProfileId,
        reviewerUserId: userId,
        followerSubscriptionId: subscriptionId,
        rating: Number(rating),
        reviewText: review_text,
      });

      res.status(201).json({ success: true, review });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'You have already reviewed this mentor' });
      }
      logger.error('[Marketplace] Create review failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Admin: Badge/Featured Management ====================

  /**
   * POST /api/public/marketplace/admin/mentors/:id/badges
   * Assign a badge (admin only).
   */
  router.post('/admin/mentors/:id/badges', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { badge_type, expires_at } = req.body || {};
      if (!badge_type) return res.status(400).json({ error: 'badge_type required' });
      await badgeService.assignBadge(req.params.id, badge_type as BadgeType, expires_at);
      const badges = await marketplaceRepo.getBadgesForMentor(req.params.id);
      res.json({ success: true, badges });
    } catch (error) {
      logger.error('[Marketplace] Assign badge failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/public/marketplace/admin/mentors/:id/featured
   * Set/unset featured status (admin only).
   */
  router.patch('/admin/mentors/:id/featured', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const { featured, order } = req.body || {};
      await marketplaceRepo.setFeatured(req.params.id, !!featured, order);
      if (featured) {
        await badgeService.assignBadge(req.params.id, 'featured');
      } else {
        await badgeService.removeBadge(req.params.id, 'featured');
      }
      res.json({ success: true });
    } catch (error) {
      logger.error('[Marketplace] Set featured failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/public/marketplace/admin/mentors/:id/compute-badges
   * Trigger badge recomputation for a mentor (admin).
   */
  router.post('/admin/mentors/:id/compute-badges', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const earned = await badgeService.computeBadges(req.params.id);
      const badges = await marketplaceRepo.getBadgesForMentor(req.params.id);
      res.json({ success: true, earned, badges });
    } catch (error) {
      logger.error('[Marketplace] Compute badges failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
