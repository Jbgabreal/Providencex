import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TenantRepository } from '../db/TenantRepository';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';

const logger = new Logger('UserRoutes');

export default function createUserRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);
  const tenantRepo = new TenantRepository();

  // ---------- Strategy Catalog (read-only, public) ----------
  // These routes don't require authentication
  router.get('/strategies', async (_req: Request, res: Response) => {
    try {
      const profiles = await tenantRepo.getPublicStrategyProfiles();
      const result = profiles.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        risk_tier: p.risk_tier,
      }));
      res.json({ success: true, strategies: result });
    } catch (error) {
      logger.error('[UserRoutes] Failed to get strategies', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/strategies/:key', async (req: Request, res: Response) => {
    try {
      const profile = await tenantRepo.getStrategyProfileByKey(req.params.key);
      if (!profile || !profile.is_public) {
        return res.status(404).json({ error: 'Strategy not found' });
      }
      res.json({
        success: true,
        strategy: {
          key: profile.key,
          name: profile.name,
          description: profile.description,
          risk_tier: profile.risk_tier,
        },
      });
    } catch (error) {
      logger.error('[UserRoutes] Failed to get strategy by key', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Apply auth middleware to all routes below
  router.use(authMiddleware, requireUser);

  // ---------- MT5 Account Management ----------

  router.get('/mt5-accounts', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  try {
    const accounts = await tenantRepo.getMt5AccountsForUser(userId);
    res.json({ success: true, accounts });
  } catch (error) {
    logger.error('[UserRoutes] Failed to get MT5 accounts', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  router.post('/mt5-accounts', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  const { account_number, server, is_demo, label, connection_meta } = req.body || {};

  if (!account_number || !server) {
    return res.status(400).json({ error: 'account_number and server are required' });
  }

  try {
    const account = await tenantRepo.createMt5Account({
      userId,
      label,
      accountNumber: String(account_number),
      server: String(server),
      isDemo: Boolean(is_demo),
      connectionMeta: connection_meta || null,
    });
    res.status(201).json({ success: true, account });
  } catch (error) {
    logger.error('[UserRoutes] Failed to create MT5 account', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  async function updateAccountStatusHandler(
    req: Request,
    res: Response,
    status: 'connected' | 'paused' | 'disconnected'
  ) {
    const userId = req.auth!.userId;

  const accountId = req.params.id;

  try {
    const account = await tenantRepo.updateMt5AccountStatus(accountId, userId, status);
    if (!account) {
      return res.status(404).json({ error: 'MT5 account not found' });
    }

    res.json({ success: true, account });
  } catch (error) {
    logger.error(`[UserRoutes] Failed to update MT5 account status to ${status}`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.post('/mt5-accounts/:id/pause', (req, res) =>
  updateAccountStatusHandler(req, res, 'paused')
);

router.post('/mt5-accounts/:id/resume', (req, res) =>
  updateAccountStatusHandler(req, res, 'connected')
);

  router.post('/mt5-accounts/:id/disconnect', (req, res) =>
    updateAccountStatusHandler(req, res, 'disconnected')
  );

  // ---------- User Strategy Assignments ----------

  router.get('/strategy-assignments', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  try {
    const assignments = await tenantRepo.getAssignmentsForUser(userId);
    res.json({ success: true, assignments });
  } catch (error) {
    logger.error('[UserRoutes] Failed to get strategy assignments', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  router.post('/strategy-assignments', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;

  const { mt5_account_id, strategy_profile_key } = req.body || {};
  if (!mt5_account_id || !strategy_profile_key) {
    return res
      .status(400)
      .json({ error: 'mt5_account_id and strategy_profile_key are required' });
  }

  try {
    // Ensure strategy profile is public
    const profile = await tenantRepo.getStrategyProfileByKey(
      String(strategy_profile_key)
    );
    if (!profile || !profile.is_public) {
      return res.status(400).json({ error: 'Invalid or non-public strategy profile' });
    }

    const assignment = await tenantRepo.createAssignment({
      userId,
      mt5AccountId: String(mt5_account_id),
      strategyProfileId: profile.id,
      status: 'active',
    });

    res.status(201).json({ success: true, assignment });
  } catch (error) {
    logger.error('[UserRoutes] Failed to create strategy assignment', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  async function updateAssignmentStatusRoute(
    req: Request,
    res: Response,
    status: 'active' | 'paused' | 'stopped'
  ) {
    const userId = req.auth!.userId;

  const id = req.params.id;

  try {
    const assignment = await tenantRepo.updateAssignmentStatus(id, userId, status);
    if (!assignment) {
      return res.status(404).json({ error: 'Strategy assignment not found' });
    }
    res.json({ success: true, assignment });
  } catch (error) {
    logger.error(
      `[UserRoutes] Failed to update strategy assignment status to ${status}`,
      error
    );
    res.status(500).json({ error: 'Internal server error' });
  }
}

router.post('/strategy-assignments/:id/pause', (req, res) =>
  updateAssignmentStatusRoute(req, res, 'paused')
);

router.post('/strategy-assignments/:id/resume', (req, res) =>
  updateAssignmentStatusRoute(req, res, 'active')
);

  router.post('/strategy-assignments/:id/stop', (req, res) =>
    updateAssignmentStatusRoute(req, res, 'stopped')
  );

  return router;
}


