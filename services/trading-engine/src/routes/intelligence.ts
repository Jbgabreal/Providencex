/**
 * Intelligence Routes — mentor insights, recommendations, risk assistant, platform intelligence.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { IntelligenceRepository } from '../intelligence/IntelligenceRepository';
import { RecommendationService } from '../intelligence/RecommendationService';
import { RiskAssistantService } from '../intelligence/RiskAssistantService';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';

const logger = new Logger('IntelligenceRoutes');

export default function createIntelligenceRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser, requireAdmin } = buildAuthMiddleware(config);

  const intRepo = new IntelligenceRepository();
  const analyticsService = new MentorAnalyticsService();
  const copyRepo = new CopyTradingRepository();
  const recService = new RecommendationService(intRepo, analyticsService, copyRepo);
  const riskService = new RiskAssistantService(intRepo, analyticsService, copyRepo);

  // ==================== Mentor Insights (auth required, mentor only) ====================

  router.get('/mentor/insights', authMiddleware, requireUser, async (req: Request, res: Response) => {
    try {
      const profile = await copyRepo.getMentorProfileByUserId(req.auth!.userId);
      if (!profile) return res.status(403).json({ error: 'Not a mentor' });

      const [followerGrowth, earningsTrend, conversionRate, churnStats, signalEngagement, shadowToLive] = await Promise.all([
        intRepo.getMentorFollowerGrowth(profile.id),
        intRepo.getMentorEarningsTrend(profile.id),
        intRepo.getMentorPlanConversionRate(profile.id),
        intRepo.getMentorChurnStats(profile.id),
        intRepo.getMentorSignalEngagement(profile.id),
        intRepo.getMentorShadowToLiveRate(profile.id),
      ]);

      const analytics = await analyticsService.getFullAnalytics(profile.id);

      res.json({
        success: true,
        insights: {
          followerGrowth,
          earningsTrend,
          planConversionRate: conversionRate,
          activeSubscribers: churnStats.active,
          churnedSubscribers: churnStats.churned,
          shadowToLiveRate: shadowToLive,
          topSymbols: analytics.symbol_breakdown?.slice(0, 5) || [],
          signalEngagement,
          recentReviewTrend: Number(profile.avg_rating) || 0,
        },
      });
    } catch (error) {
      logger.error('[Intelligence] Mentor insights failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Follower Recommendations (auth required) ====================

  router.get('/recommendations/mentors', authMiddleware, requireUser, async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const recommendations = await recService.getRecommendations(req.auth!.userId, limit);
      res.json({ success: true, recommendations });
    } catch (error) {
      logger.error('[Intelligence] Recommendations failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Risk Assistant (auth required) ====================

  router.get('/risk-assistant', authMiddleware, requireUser, async (req: Request, res: Response) => {
    try {
      const warnings = await riskService.evaluateRisk(req.auth!.userId);
      res.json({ success: true, warnings });
    } catch (error) {
      logger.error('[Intelligence] Risk assistant failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/risk-assistant/dismiss/:id', authMiddleware, requireUser, async (req: Request, res: Response) => {
    try {
      const success = await riskService.dismiss(req.params.id, req.auth!.userId);
      res.json({ success });
    } catch (error) {
      logger.error('[Intelligence] Dismiss warning failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Platform Intelligence (admin only) ====================

  router.get('/platform/overview', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
    try {
      const [mentorFunnel, referralFunnel, churnHotspots, topBlockReasons, importQuality, shadowToLive] = await Promise.all([
        intRepo.getMentorConversionFunnel(),
        intRepo.getReferralFunnel(),
        intRepo.getChurnHotspots(),
        intRepo.getTopBlockReasons(),
        intRepo.getImportQualityRate(),
        intRepo.getShadowToLiveRate(),
      ]);

      res.json({
        success: true,
        intelligence: {
          mentorConversionFunnel: mentorFunnel,
          referralFunnel,
          churnHotspots,
          topBlockReasons,
          importQualityRate: importQuality,
          shadowToLiveRate: shadowToLive,
        },
      });
    } catch (error) {
      logger.error('[Intelligence] Platform overview failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
