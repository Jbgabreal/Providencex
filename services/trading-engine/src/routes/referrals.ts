/**
 * Referral Routes — referral profiles, attribution, conversions, commissions.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { ReferralRepository } from '../referrals/ReferralRepository';
import { ReferralCodeService } from '../referrals/ReferralCodeService';
import { AttributionService } from '../referrals/AttributionService';
import { CommissionService } from '../referrals/CommissionService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { REFERRAL_CONFIG } from '../referrals/types';

const logger = new Logger('ReferralRoutes');

export default function createReferralRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const referralRepo = new ReferralRepository();
  const copyTradingRepo = new CopyTradingRepository();
  const codeService = new ReferralCodeService(referralRepo, copyTradingRepo);
  const attributionService = new AttributionService(referralRepo);
  const commissionService = new CommissionService(referralRepo);

  // All routes require auth
  router.use(authMiddleware, requireUser);

  // ---------- Referral Profile ----------

  /**
   * GET /api/referrals/me
   * Get or create the user's referral profile + summary stats.
   */
  router.get('/me', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const profile = await codeService.getOrCreateProfile(userId);
      const commissionSummary = await referralRepo.getCommissionSummary(userId);

      const referralLink = `${REFERRAL_CONFIG.referralLinkBase}${profile.referral_code}`;

      res.json({
        success: true,
        profile,
        referralLink,
        summary: {
          totalReferrals: profile.total_referrals,
          totalConversions: profile.total_conversions,
          totalEarned: profile.total_earned_fiat,
          ...commissionSummary,
        },
      });
    } catch (error) {
      logger.error('[Referral] Get profile failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/referrals/summary
   * Lightweight summary (no full profile creation).
   */
  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const profile = await referralRepo.getProfileByUserId(userId);
      if (!profile) {
        return res.json({
          success: true,
          hasProfile: false,
          summary: null,
        });
      }

      const commissionSummary = await referralRepo.getCommissionSummary(userId);
      res.json({
        success: true,
        hasProfile: true,
        summary: {
          referralCode: profile.referral_code,
          totalReferrals: profile.total_referrals,
          totalConversions: profile.total_conversions,
          totalEarned: profile.total_earned_fiat,
          ...commissionSummary,
        },
      });
    } catch (error) {
      logger.error('[Referral] Get summary failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Referral Code ----------

  /**
   * POST /api/referrals/code/regenerate
   * Generate a new referral code.
   */
  router.post('/code/regenerate', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      // Ensure profile exists
      await codeService.getOrCreateProfile(userId);
      const updated = await codeService.regenerateCode(userId);
      if (!updated) return res.status(404).json({ error: 'Profile not found' });
      res.json({ success: true, profile: updated });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Code collision, please try again' });
      }
      logger.error('[Referral] Regenerate code failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Attribution ----------

  /**
   * POST /api/referrals/apply-code
   * Apply a referral code to the current user (e.g. after signup).
   * Body: { referral_code: string }
   */
  router.post('/apply-code', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { referral_code } = req.body || {};

      if (!referral_code || typeof referral_code !== 'string') {
        return res.status(400).json({ error: 'referral_code is required' });
      }

      const attribution = await attributionService.applyReferralCode({
        referredUserId: userId,
        referralCode: referral_code.trim(),
        source: 'link',
      });

      if (!attribution) {
        return res.status(400).json({ error: 'Invalid or expired referral code, or you are already referred' });
      }

      res.json({ success: true, attribution });
    } catch (error) {
      logger.error('[Referral] Apply code failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/referrals/attribution
   * Check if current user was referred (and by whom).
   */
  router.get('/attribution', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const attribution = await attributionService.getReferrer(userId);
      res.json({ success: true, attribution });
    } catch (error) {
      logger.error('[Referral] Get attribution failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Conversions ----------

  /**
   * GET /api/referrals/conversions
   * List conversions generated by the user's referrals.
   */
  router.get('/conversions', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const limit = parseInt(req.query.limit as string) || 50;
      const conversions = await referralRepo.getConversionsByReferrer(userId, limit);
      res.json({ success: true, conversions });
    } catch (error) {
      logger.error('[Referral] Get conversions failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Commissions ----------

  /**
   * GET /api/referrals/commissions
   * List commission history for the user.
   */
  router.get('/commissions', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const limit = parseInt(req.query.limit as string) || 50;
      const commissions = await referralRepo.getCommissionsByReferrer(userId, limit);
      const summary = await referralRepo.getCommissionSummary(userId);
      res.json({ success: true, commissions, summary });
    } catch (error) {
      logger.error('[Referral] Get commissions failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Referrals List ----------

  /**
   * GET /api/referrals/referred-users
   * List users referred by the current user.
   */
  router.get('/referred-users', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const limit = parseInt(req.query.limit as string) || 50;
      const referrals = await attributionService.getReferrals(userId, limit);
      res.json({ success: true, referrals });
    } catch (error) {
      logger.error('[Referral] Get referred users failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
