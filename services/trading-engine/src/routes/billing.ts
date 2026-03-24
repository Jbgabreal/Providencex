/**
 * Billing Routes — Platform plans, mentor plans, crypto invoices, entitlements, earnings.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { BillingRepository } from '../billing/BillingRepository';
import { CryptoInvoiceService } from '../billing/CryptoInvoiceService';
import { ExchangeRateService } from '../billing/ExchangeRateService';
import { EntitlementService } from '../billing/EntitlementService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { SUPPORTED_RAILS, type PaymentRail } from '../billing/types';

const logger = new Logger('BillingRoutes');

export default function createBillingRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const billingRepo = new BillingRepository();
  const exchangeRateService = new ExchangeRateService(billingRepo);
  const invoiceService = new CryptoInvoiceService(billingRepo, exchangeRateService);
  const entitlementService = new EntitlementService(billingRepo);
  const copyTradingRepo = new CopyTradingRepository();

  // ==================== Public: Platform Plans & Payment Rails ====================

  router.get('/platform-plans', async (_req: Request, res: Response) => {
    try {
      const plans = await billingRepo.getPlatformPlans(true);
      res.json({ success: true, plans });
    } catch (error) {
      logger.error('[Billing] Get platform plans failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/supported-payment-rails', async (_req: Request, res: Response) => {
    try {
      const rails = Object.values(SUPPORTED_RAILS);
      res.json({ success: true, rails });
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Auth Required ====================
  router.use(authMiddleware, requireUser);

  // ---------- Entitlements / Billing Status ----------

  router.get('/me', async (req: Request, res: Response) => {
    try {
      const entitlements = await entitlementService.getUserEntitlements(req.auth!.userId);
      const invoices = await billingRepo.getInvoicesByUser(req.auth!.userId, 10);
      res.json({ success: true, entitlements, recentInvoices: invoices });
    } catch (error) {
      logger.error('[Billing] Get billing status failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Platform Invoice Creation ----------

  router.post('/platform-invoice', async (req: Request, res: Response) => {
    try {
      const { platform_plan_id, payment_rail } = req.body || {};
      if (!platform_plan_id || !payment_rail) {
        return res.status(400).json({ error: 'platform_plan_id and payment_rail are required' });
      }
      if (!SUPPORTED_RAILS[payment_rail as PaymentRail]) {
        return res.status(400).json({ error: `Unsupported payment rail. Use: ${Object.keys(SUPPORTED_RAILS).join(', ')}` });
      }

      const invoice = await invoiceService.createInvoice({
        userId: req.auth!.userId,
        invoiceType: 'platform_plan',
        platformPlanId: platform_plan_id,
        paymentRail: payment_rail as PaymentRail,
      });

      res.status(201).json({ success: true, invoice });
    } catch (error: any) {
      logger.error('[Billing] Create platform invoice failed', error);
      res.status(400).json({ error: error.message || 'Failed to create invoice' });
    }
  });

  // ---------- Mentor Invoice Creation ----------

  router.post('/mentor-invoice', async (req: Request, res: Response) => {
    try {
      const { mentor_plan_id, payment_rail } = req.body || {};
      if (!mentor_plan_id || !payment_rail) {
        return res.status(400).json({ error: 'mentor_plan_id and payment_rail are required' });
      }
      if (!SUPPORTED_RAILS[payment_rail as PaymentRail]) {
        return res.status(400).json({ error: `Unsupported payment rail. Use: ${Object.keys(SUPPORTED_RAILS).join(', ')}` });
      }

      const invoice = await invoiceService.createInvoice({
        userId: req.auth!.userId,
        invoiceType: 'mentor_plan',
        mentorPlanId: mentor_plan_id,
        paymentRail: payment_rail as PaymentRail,
      });

      res.status(201).json({ success: true, invoice });
    } catch (error: any) {
      logger.error('[Billing] Create mentor invoice failed', error);
      res.status(400).json({ error: error.message || 'Failed to create invoice' });
    }
  });

  // ---------- Invoice Operations ----------

  router.get('/invoices/:id', async (req: Request, res: Response) => {
    try {
      const data = await invoiceService.getInvoiceWithEvents(req.params.id);
      if (!data || data.invoice.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Invoice not found' });
      }
      const railInfo = SUPPORTED_RAILS[data.invoice.payment_rail as PaymentRail];
      res.json({ success: true, ...data, railInfo });
    } catch (error) {
      logger.error('[Billing] Get invoice failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/invoices/:id/refresh-status', async (req: Request, res: Response) => {
    try {
      const invoice = await billingRepo.getInvoiceById(req.params.id);
      if (!invoice || invoice.user_id !== req.auth!.userId) {
        return res.status(404).json({ error: 'Invoice not found' });
      }

      const updated = await invoiceService.refreshInvoiceStatus(req.params.id);
      res.json({ success: true, invoice: updated });
    } catch (error) {
      logger.error('[Billing] Refresh invoice status failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/invoices', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 20;
      const invoices = await billingRepo.getInvoicesByUser(req.auth!.userId, limit);
      res.json({ success: true, invoices });
    } catch (error) {
      logger.error('[Billing] List invoices failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Mentor Plans (Mentor Management) ----------

  router.get('/mentor-plans', async (req: Request, res: Response) => {
    try {
      const mentorProfileId = req.query.mentor_profile_id as string;
      if (!mentorProfileId) {
        return res.status(400).json({ error: 'mentor_profile_id query param required' });
      }
      const plans = await billingRepo.getPublicMentorPlans(mentorProfileId);
      res.json({ success: true, plans });
    } catch (error) {
      logger.error('[Billing] Get mentor plans failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/mentor-plans', async (req: Request, res: Response) => {
    try {
      // Verify user is a mentor
      const mentorProfile = await copyTradingRepo.getMentorProfileByUserId(req.auth!.userId);
      if (!mentorProfile) {
        return res.status(403).json({ error: 'You must be a mentor to create plans' });
      }

      const { name, description, price_usd, features, is_public } = req.body || {};
      if (!name || price_usd === undefined) {
        return res.status(400).json({ error: 'name and price_usd are required' });
      }

      const plan = await billingRepo.createMentorPlan({
        mentorProfileId: mentorProfile.id,
        name,
        description,
        priceUsd: Number(price_usd),
        features,
        isPublic: is_public,
      });

      res.status(201).json({ success: true, plan });
    } catch (error) {
      logger.error('[Billing] Create mentor plan failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/mentor-plans/:id', async (req: Request, res: Response) => {
    try {
      const mentorProfile = await copyTradingRepo.getMentorProfileByUserId(req.auth!.userId);
      if (!mentorProfile) {
        return res.status(403).json({ error: 'You must be a mentor to update plans' });
      }

      const updated = await billingRepo.updateMentorPlan(req.params.id, mentorProfile.id, {
        name: req.body.name,
        description: req.body.description,
        priceUsd: req.body.price_usd !== undefined ? Number(req.body.price_usd) : undefined,
        isActive: req.body.is_active,
        isPublic: req.body.is_public,
        features: req.body.features,
        sortOrder: req.body.sort_order,
      });

      if (!updated) return res.status(404).json({ error: 'Plan not found' });
      res.json({ success: true, plan: updated });
    } catch (error) {
      logger.error('[Billing] Update mentor plan failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- My Mentor Plans (for mentor dashboard) ----------

  router.get('/my-mentor-plans', async (req: Request, res: Response) => {
    try {
      const mentorProfile = await copyTradingRepo.getMentorProfileByUserId(req.auth!.userId);
      if (!mentorProfile) {
        return res.status(403).json({ error: 'You must be a mentor' });
      }
      const plans = await billingRepo.getMentorPlans(mentorProfile.id, false);
      res.json({ success: true, plans });
    } catch (error) {
      logger.error('[Billing] Get my mentor plans failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Mentor Earnings ----------

  router.get('/mentor-earnings', async (req: Request, res: Response) => {
    try {
      const mentorProfile = await copyTradingRepo.getMentorProfileByUserId(req.auth!.userId);
      if (!mentorProfile) {
        return res.status(403).json({ error: 'You must be a mentor' });
      }
      const earnings = await billingRepo.getMentorEarnings(mentorProfile.id);
      res.json({ success: true, earnings });
    } catch (error) {
      logger.error('[Billing] Get mentor earnings failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- User Mentor Subscriptions (billing view) ----------

  router.get('/mentor-subscriptions', async (req: Request, res: Response) => {
    try {
      const subs = await billingRepo.getUserMentorSubscriptions(req.auth!.userId);
      res.json({ success: true, subscriptions: subs });
    } catch (error) {
      logger.error('[Billing] Get mentor subscriptions failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
