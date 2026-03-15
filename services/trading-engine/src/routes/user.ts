import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TenantRepository, UserTradingConfig } from '../db/TenantRepository';
import { TradeHistoryRepository } from '../db/TradeHistoryRepository';
import { StrategyPerformanceService } from '../services/StrategyPerformanceService';
import { ExecutionService } from '../services/ExecutionService';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';

const logger = new Logger('UserRoutes');

export default function createUserRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);
  const tenantRepo = new TenantRepository();
  const tradeHistoryRepo = new TradeHistoryRepository();
  const strategyPerformanceService = new StrategyPerformanceService(tradeHistoryRepo, tenantRepo);

  // ---------- Strategy Catalog (read-only, public) ----------
  // These routes don't require authentication
  router.get('/strategies', async (req: Request, res: Response) => {
    try {
      // Optional filter by risk_tier
      const riskTier = req.query.risk_tier as 'low' | 'medium' | 'high' | undefined;
      
      let profiles = await tenantRepo.getPublicStrategyProfiles();
      
      // Filter by risk tier if provided
      if (riskTier && ['low', 'medium', 'high'].includes(riskTier)) {
        profiles = profiles.filter(p => p.risk_tier === riskTier);
      }

      // Get performance data for each strategy
      const strategies = await Promise.all(
        profiles.map(async (p) => {
          const performance = await strategyPerformanceService.getAggregatePerformance(p.key);
          
          return {
            key: p.key,
            name: p.name,
            description: p.description,
            risk_tier: p.risk_tier,
            is_frozen: p.is_frozen,
            is_available: p.is_public,
            performance: performance || {
              total_users: 0,
              total_trades: 0,
              closed_trades: 0,
              win_rate: 0,
              profit_factor: 0,
              total_pnl: 0,
              avg_daily_return: 0,
              max_drawdown_percent: 0,
              average_win: 0,
              average_loss: 0,
              largest_win: 0,
              largest_loss: 0,
              average_r: 0,
            },
          };
        })
      );

      res.json({ success: true, strategies });
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

      // Get performance data
      const performance = await strategyPerformanceService.getAggregatePerformance(profile.key);

      res.json({
        success: true,
        strategy: {
          key: profile.key,
          name: profile.name,
          description: profile.description,
          risk_tier: profile.risk_tier,
          is_frozen: profile.is_frozen,
          is_available: profile.is_public,
          implementation_key: profile.implementation_key,
          performance: performance || {
            total_users: 0,
            total_trades: 0,
            closed_trades: 0,
            win_rate: 0,
            profit_factor: 0,
            total_pnl: 0,
            avg_daily_return: 0,
            max_drawdown_percent: 0,
            average_win: 0,
            average_loss: 0,
            largest_win: 0,
            largest_loss: 0,
            average_r: 0,
          },
        },
      });
    } catch (error) {
      logger.error('[UserRoutes] Failed to get strategy by key', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/user/strategies/:key/performance - Get performance history
  router.get('/strategies/:key/performance', async (req: Request, res: Response) => {
    try {
      const profile = await tenantRepo.getStrategyProfileByKey(req.params.key);
      if (!profile || !profile.is_public) {
        return res.status(404).json({ error: 'Strategy not found' });
      }

      const period = (req.query.period as '7d' | '30d' | '90d' | 'all') || '30d';
      const history = await strategyPerformanceService.getPerformanceHistory(profile.key, period);

      if (!history) {
        return res.status(500).json({ error: 'Failed to get performance history' });
      }

      res.json({
        success: true,
        history,
      });
    } catch (error) {
      logger.error('[UserRoutes] Failed to get strategy performance history', error);
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

  const { account_number, server, is_demo, label, connection_meta, broker_type, broker_credentials } = req.body || {};

  // Validate based on broker type
  const resolvedBrokerType = broker_type || 'mt5';
  if (resolvedBrokerType === 'deriv') {
    if (!broker_credentials?.apiToken || !broker_credentials?.appId) {
      return res.status(400).json({ error: 'Deriv accounts require broker_credentials.appId and broker_credentials.apiToken' });
    }
  } else {
    if (!account_number || !server) {
      return res.status(400).json({ error: 'account_number and server are required for MT5 accounts' });
    }
  }

  try {
    const account = await tenantRepo.createMt5Account({
      userId,
      label,
      accountNumber: String(account_number || broker_credentials?.accountId || ''),
      server: String(server || resolvedBrokerType),
      isDemo: Boolean(is_demo),
      connectionMeta: connection_meta || null,
      brokerType: resolvedBrokerType,
      brokerCredentials: broker_credentials || null,
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

  // ---------- User Trading Config ----------

  router.patch('/strategy-assignments/:id/config', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const id = req.params.id;
    const body = req.body || {};

    // Validate and sanitize user config
    const VALID_SESSIONS = ['asian', 'london', 'newyork'] as const;
    const userConfig: UserTradingConfig = {};

    // Risk mode
    if (body.risk_mode === 'percentage' || body.risk_mode === 'usd') {
      userConfig.risk_mode = body.risk_mode;
    }

    // Risk per trade percentage (0.1% - 5%)
    if (typeof body.risk_per_trade_pct === 'number') {
      userConfig.risk_per_trade_pct = Math.max(0.1, Math.min(5, body.risk_per_trade_pct));
    }

    // Risk per trade USD ($1 - $10,000)
    if (typeof body.risk_per_trade_usd === 'number') {
      userConfig.risk_per_trade_usd = Math.max(1, Math.min(10000, body.risk_per_trade_usd));
    }

    // Max consecutive losses (1-10)
    if (typeof body.max_consecutive_losses === 'number') {
      userConfig.max_consecutive_losses = Math.max(1, Math.min(10, Math.floor(body.max_consecutive_losses)));
    }

    // Sessions (at least one required if provided)
    if (Array.isArray(body.sessions)) {
      const validSessions = body.sessions.filter(
        (s: string) => VALID_SESSIONS.includes(s as any)
      ) as UserTradingConfig['sessions'];
      if (validSessions && validSessions.length > 0) {
        userConfig.sessions = validSessions;
      }
    }

    try {
      const assignment = await tenantRepo.updateAssignmentUserConfig(id, userId, userConfig);
      if (!assignment) {
        return res.status(404).json({ error: 'Strategy assignment not found' });
      }
      res.json({ success: true, assignment });
    } catch (error) {
      logger.error('[UserRoutes] Failed to update assignment config', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Close Active Position ----------

  router.post('/positions/:ticket/close', async (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const ticket = req.params.ticket;
    const reason = req.body?.reason || 'User manual close';

    try {
      // Verify the position belongs to this user
      const tradeResult = await tradeHistoryRepo.getTradeByTicket(Number(ticket), userId);
      if (!tradeResult) {
        return res.status(404).json({ error: 'Position not found or does not belong to you' });
      }

      const executionService = new ExecutionService();
      const result = await executionService.closeTrade(ticket, reason);

      if (result.success) {
        res.json({ success: true, message: 'Position closed successfully' });
      } else {
        res.status(400).json({ success: false, error: result.error || 'Failed to close position' });
      }
    } catch (error) {
      logger.error('[UserRoutes] Failed to close position', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}


