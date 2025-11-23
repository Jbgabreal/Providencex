/**
 * Admin Dashboard API Routes
 * 
 * Read-only endpoints for monitoring and dashboard
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import { OpenTradesService } from '../services/OpenTradesService';
import { executionFilterConfig } from '../config/executionFilterConfig';
import {
  AdminDecision,
  AdminDecisionsResponse,
  DailyMetricsResponse,
  ExposureStatusResponse,
  BacktestRunSummary,
  BacktestRunsResponse,
} from './types';
import { LivePnlService } from '../services/LivePnlService';
import { KillSwitchService } from '../services/KillSwitchService';

const logger = new Logger('AdminAPI');
const router: Router = Router();

/**
 * Get database connection pool (reuse DecisionLogger's connection pattern)
 */
function getPool(): Pool | null {
  const config = getConfig();
  if (!config.databaseUrl) {
    return null;
  }

  try {
    const pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    });
    
    // Handle pool errors gracefully (prevent app crash)
    pool.on('error', (err) => {
      logger.error('[AdminAPI] Database pool error (non-fatal):', err);
      // Don't crash the app - just log the error
    });
    
    return pool;
  } catch (error) {
    logger.error('Failed to create database pool for admin API', error);
    return null;
  }
}

/**
 * GET /api/v1/admin/decisions
 * 
 * Returns recent trade decisions with filters & pagination
 */
router.get('/decisions', async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({
      error: 'Database not available',
    });
  }

  try {
    // Parse query params
    const symbol = req.query.symbol as string | undefined;
    const strategy = req.query.strategy as string | undefined;
    const decision = req.query.decision as string | undefined;
    let limit = parseInt(req.query.limit as string || '50', 10);
    let offset = parseInt(req.query.offset as string || '0', 10);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    // Validate and clamp limit
    limit = Math.min(Math.max(limit, 1), 500);
    offset = Math.max(offset, 0);

    // Build WHERE clause
    const whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (symbol) {
      whereConditions.push(`symbol = $${paramIndex++}`);
      params.push(symbol.toUpperCase());
    }

    if (strategy) {
      whereConditions.push(`strategy = $${paramIndex++}`);
      params.push(strategy.toLowerCase());
    }

    if (decision) {
      whereConditions.push(`decision = $${paramIndex++}`);
      params.push(decision.toLowerCase());
    }

    if (from) {
      whereConditions.push(`timestamp >= $${paramIndex++}`);
      params.push(from);
    }

    if (to) {
      whereConditions.push(`timestamp <= $${paramIndex++}`);
      params.push(to);
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Query decisions
    const query = `
      SELECT 
        id,
        timestamp as created_at,
        symbol,
        strategy,
        decision,
        guardrail_mode,
        guardrail_reason,
        risk_reason,
        signal_reason,
        execution_filter_action,
        execution_filter_reasons,
        kill_switch_active,
        kill_switch_reasons,
        trade_request,
        execution_result
      FROM trade_decisions
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Map DB rows to AdminDecision objects
    const decisions: AdminDecision[] = result.rows.map((row) => {
      const tradeRequest = row.trade_request || {};
      const executionResult = row.execution_result || null;

      return {
        id: row.id,
        createdAt: new Date(row.created_at).toISOString(),
        symbol: row.symbol,
        strategy: row.strategy,
        decision: row.decision,
        direction: tradeRequest.direction || null,
        guardrailMode: row.guardrail_mode || null,
        guardrailReason: row.guardrail_reason || null,
        riskReason: row.risk_reason || null,
        signalReason: row.signal_reason || null,
        executionFilterAction: row.execution_filter_action || null,
        executionFilterReasons: Array.isArray(row.execution_filter_reasons)
          ? row.execution_filter_reasons
          : (row.execution_filter_reasons ? [row.execution_filter_reasons] : null),
        entryPrice: tradeRequest.entry || null,
        sl: tradeRequest.stopLoss || null,
        tp: tradeRequest.takeProfit || null,
        lotSize: tradeRequest.lotSize || null,
        executionResult: executionResult,
        killSwitchActive: row.kill_switch_active ?? null,
        killSwitchReasons: row.kill_switch_reasons
          ? (Array.isArray(row.kill_switch_reasons)
              ? row.kill_switch_reasons
              : (typeof row.kill_switch_reasons === 'string'
                  ? JSON.parse(row.kill_switch_reasons)
                  : row.kill_switch_reasons))
          : null,
      };
    });

    // Get total count (for pagination)
    const countQuery = `
      SELECT COUNT(*) as total
      FROM trade_decisions
      ${whereClause}
    `;
    const countParams = params.slice(0, -2); // Remove limit and offset
    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total, 10);

    const response: AdminDecisionsResponse = {
      data: decisions,
      pagination: {
        limit,
        offset,
        total,
      },
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching decisions', error);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/v1/admin/metrics/daily
 * 
 * Returns daily aggregate metrics
 */
router.get('/metrics/daily', async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({
      error: 'Database not available',
    });
  }

  try {
    // Parse date param (default to today)
    let date: Date;
    if (req.query.date) {
      date = new Date(req.query.date as string);
    } else {
      date = new Date();
    }

    // Set to start of day (00:00:00)
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    // Set to end of day (23:59:59.999)
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

    // Query all decisions for this day
    const query = `
      SELECT 
        symbol,
        strategy,
        decision,
        guardrail_reason,
        risk_reason,
        execution_filter_reasons
      FROM trade_decisions
      WHERE timestamp >= $1 AND timestamp <= $2
      ORDER BY timestamp DESC
    `;

    const result = await pool.query(query, [startOfDay.toISOString(), endOfDay.toISOString()]);

    // Aggregate metrics
    let totalDecisions = 0;
    let totalTrades = 0;
    let totalSkips = 0;
    const tradesBySymbol: Record<string, { trades: number; skips: number }> = {};
    const tradesByStrategy: Record<string, { trades: number; skips: number }> = {};
    const skipReasons: Record<string, number> = {};

    for (const row of result.rows) {
      totalDecisions++;

      // Count trades vs skips
      if (row.decision === 'trade') {
        totalTrades++;
      } else {
        totalSkips++;
      }

      // Per-symbol aggregation
      const symbol = row.symbol;
      if (!tradesBySymbol[symbol]) {
        tradesBySymbol[symbol] = { trades: 0, skips: 0 };
      }
      if (row.decision === 'trade') {
        tradesBySymbol[symbol].trades++;
      } else {
        tradesBySymbol[symbol].skips++;
      }

      // Per-strategy aggregation
      const strategy = row.strategy;
      if (!tradesByStrategy[strategy]) {
        tradesByStrategy[strategy] = { trades: 0, skips: 0 };
      }
      if (row.decision === 'trade') {
        tradesByStrategy[strategy].trades++;
      } else {
        tradesByStrategy[strategy].skips++;
      }

      // Aggregate skip reasons (combine all reasons)
      if (row.decision === 'skip') {
        const reasons: string[] = [];

        if (row.guardrail_reason) {
          reasons.push(`Guardrail: ${row.guardrail_reason}`);
        }
        if (row.risk_reason) {
          reasons.push(`Risk: ${row.risk_reason}`);
        }
        if (row.execution_filter_reasons) {
          const filterReasons = Array.isArray(row.execution_filter_reasons)
            ? row.execution_filter_reasons
            : [row.execution_filter_reasons];
          filterReasons.forEach((reason: string) => {
            if (reason) {
              reasons.push(`Execution Filter: ${reason}`);
            }
          });
        }

        // If no explicit reasons, use a generic one
        if (reasons.length === 0) {
          reasons.push('No reason provided');
        }

        // Count each reason
        reasons.forEach((reason) => {
          skipReasons[reason] = (skipReasons[reason] || 0) + 1;
        });
      }
    }

    // Convert skip reasons to sorted array
    const topSkipReasons = Object.entries(skipReasons)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10

    const response: DailyMetricsResponse = {
      date: dateStr,
      totalDecisions,
      totalTrades,
      totalSkips,
      tradesBySymbol,
      tradesByStrategy,
      topSkipReasons,
      lastUpdated: new Date().toISOString(),
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching daily metrics', error);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

/**
 * GET /api/v1/admin/backtests
 * 
 * Returns recent backtest runs
 */
router.get('/backtests', async (req: Request, res: Response) => {
  const pool = getPool();
  if (!pool) {
    return res.status(503).json({
      error: 'Database not available',
    });
  }

  try {
    // Parse query params
    const symbol = req.query.symbol as string | undefined;
    const strategy = req.query.strategy as string | undefined;
    let limit = parseInt(req.query.limit as string || '20', 10);

    // Validate and clamp limit
    limit = Math.min(Math.max(limit, 1), 100);

    // Build WHERE clause
    const whereConditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (symbol) {
      whereConditions.push(`config_json->>'symbol' = $${paramIndex++}`);
      params.push(symbol.toUpperCase());
    }

    if (strategy) {
      // Check if strategy is in the strategies array or single value
      whereConditions.push(`(config_json->>'strategies' LIKE $${paramIndex++} OR config_json->>'strategies' = $${paramIndex})`);
      params.push(`%${strategy.toLowerCase()}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // Query backtest runs
    const query = `
      SELECT 
        id,
        run_id,
        config_json,
        stats_json,
        start_time,
        end_time,
        initial_balance,
        final_balance,
        total_return,
        total_return_percent,
        created_at
      FROM backtest_runs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}
    `;

    params.push(limit);

    const result = await pool.query(query, params);

    // Map DB rows to BacktestRunSummary objects
    const backtests: BacktestRunSummary[] = result.rows.map((row) => {
      const config = row.config_json || {};
      const stats = row.stats_json || {};
      const symbol = Array.isArray(config.symbol)
        ? config.symbol[0]
        : (config.symbol || 'UNKNOWN');

      return {
        id: row.id,
        runId: row.run_id,
        symbol: (symbol || 'UNKNOWN').toUpperCase(),
        strategy: Array.isArray(config.strategies)
          ? config.strategies.join(',')
          : (typeof config.strategies === 'string' ? config.strategies : 'unknown'),
        fromDate: config.startDate || config.fromDate || '',
        toDate: config.endDate || config.toDate || '',
        winRate: typeof stats.winRate === 'number' ? stats.winRate : 0,
        profitFactor: typeof stats.profitFactor === 'number' ? stats.profitFactor : 0,
        maxDrawdown: typeof stats.maxDrawdown === 'number' ? stats.maxDrawdown : 0,
        maxDrawdownPercent: typeof stats.maxDrawdownPercent === 'number' ? stats.maxDrawdownPercent : 0,
        totalTrades: typeof stats.totalTrades === 'number' ? stats.totalTrades : 0,
        totalPnL: parseFloat(String(row.total_return || 0)),
        totalReturnPercent: parseFloat(String(row.total_return_percent || 0)),
        createdAt: new Date(row.created_at).toISOString(),
      };
    });

    const response: BacktestRunsResponse = {
      data: backtests,
    };

    res.json(response);
  } catch (error) {
    logger.error('Error fetching backtests', error);
    // If table doesn't exist, return empty array (backtests are optional)
    if (error instanceof Error && error.message.includes('does not exist')) {
      logger.warn('backtest_runs table does not exist - returning empty array');
      return res.json({
        data: [],
      });
    }
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

/**
 * Initialize admin services (called from server.ts)
 */
let livePnlService: LivePnlService | null = null;
let killSwitchService: KillSwitchService | null = null;

export function initializeAdminServices(lpnl: LivePnlService, kswitch: KillSwitchService): void {
  livePnlService = lpnl;
  killSwitchService = kswitch;
  logger.info('[AdminAPI] Services initialized: LivePnlService, KillSwitchService');
}

/**
 * GET /api/v1/admin/live-trades
 * Returns closed live trades with filters and pagination
 */
router.get('/live-trades', async (req: Request, res: Response) => {
  if (!livePnlService) {
    return res.status(503).json({ error: 'LivePnlService not available' });
  }

  try {
    const symbol = req.query.symbol as string | undefined;
    const strategy = req.query.strategy as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    let limit = parseInt(req.query.limit as string || '50', 10);
    let offset = parseInt(req.query.offset as string || '0', 10);

    limit = Math.min(Math.max(limit, 1), 500);
    offset = Math.max(offset, 0);

    const trades = await livePnlService.getClosedTrades(
      symbol,
      strategy,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
      limit,
      offset
    );

    res.json({
      data: trades,
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error fetching live trades', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/live-equity
 * Returns equity curve snapshots (latest N points or date range)
 */
router.get('/live-equity', async (req: Request, res: Response) => {
  if (!livePnlService) {
    return res.status(503).json({ error: 'LivePnlService not available' });
  }

  try {
    // For now, return latest snapshot
    // TODO: Add date range query support in LivePnlService
    const latest = await livePnlService.getLatestEquity();

    if (!latest) {
      return res.json({ data: [] });
    }

    res.json({
      data: [latest],
    });
  } catch (error) {
    logger.error('Error fetching live equity', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/optimization/runs
 * Returns list of optimization runs with optional filters
 */
router.get('/optimization/runs', async (req: Request, res: Response) => {
  try {
    const method = req.query.method as string | undefined;
    const symbol = req.query.symbol as string | undefined;
    const status = req.query.status as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const { OptimizerResultStore } = await import('../optimization/OptimizerResultStore');
    const resultStore = new OptimizerResultStore(process.env.DATABASE_URL);
    
    const runs = await resultStore.getAllRuns({
      method: method as any,
      symbol,
      status: status as any,
      limit,
    });

    res.json({
      success: true,
      runs,
      count: runs.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get optimization runs', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/v1/admin/optimization/:id
 * Returns optimization run details with all results
 */
router.get('/optimization/:id', async (req: Request, res: Response) => {
  try {
    const runId = parseInt(req.params.id, 10);
    if (isNaN(runId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid run ID',
      });
      return;
    }

    const { OptimizerResultStore } = await import('../optimization/OptimizerResultStore');
    const resultStore = new OptimizerResultStore(process.env.DATABASE_URL);
    
    const run = await resultStore.loadRun(runId);
    if (!run) {
      res.status(404).json({
        success: false,
        error: 'Optimization run not found',
      });
      return;
    }

    const results = await resultStore.loadResults(runId);

    res.json({
      success: true,
      run,
      results,
      count: results.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get optimization run', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/v1/admin/kill-switch
 * Returns current kill switch state
 */
router.get('/kill-switch', async (req: Request, res: Response) => {
  if (!killSwitchService) {
    return res.status(503).json({ error: 'KillSwitchService not available' });
  }

  try {
    const state = killSwitchService.getState();
    res.json({
      active: state.active,
      reasons: state.reasons,
      activatedAt: state.activatedAt?.toISOString() || null,
      scope: state.scope,
    });
  } catch (error) {
    logger.error('Error getting kill switch state', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/admin/kill-switch/reset
 * Manual reset of kill switch
 */
router.post('/kill-switch/reset', async (req: Request, res: Response) => {
  if (!killSwitchService) {
    return res.status(503).json({ error: 'KillSwitchService not available' });
  }

  try {
    const reason = (req.body.reason as string) || 'Manual reset via admin API';
    await killSwitchService.manualReset(reason);
    res.json({
      success: true,
      message: 'Kill switch reset successfully',
      reason,
    });
  } catch (error) {
    logger.error('Error resetting kill switch', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/accounts
 * Returns list of all accounts with status
 */
router.get('/accounts', async (req: Request, res: Response) => {
  try {
    const { AccountRegistry } = await import('../multiaccount/AccountRegistry');
    const { PerAccountKillSwitch } = await import('../multiaccount/PerAccountKillSwitch');
    const { PerAccountRiskService } = await import('../multiaccount/PerAccountRiskService');

    const accountRegistry = new AccountRegistry();
    await accountRegistry.loadAccounts();
    const accounts = accountRegistry.getAllAccounts();

    const killSwitch = new PerAccountKillSwitch(process.env.DATABASE_URL);
    const riskService = new PerAccountRiskService(process.env.DATABASE_URL);

    // Get account details with status
    const accountDetails = await Promise.all(
      accounts.map(async (account) => {
        const runtimeState = accountRegistry.getRuntimeState(account.id);
        const killSwitchState = killSwitch.getState(account.id);
        const accountEquity = await riskService.getAccountEquity(account.id);
        const todayPnL = await riskService.getTodayRealizedPnL(account.id);
        const todayTrades = await riskService.getTodayTradeCount(account.id);

        return {
          id: account.id,
          name: account.name,
          symbols: account.symbols,
          mt5: {
            baseUrl: account.mt5.baseUrl,
            login: account.mt5.login,
          },
          enabled: account.enabled !== false,
          status: {
            paused: runtimeState?.paused || false,
            isConnected: runtimeState?.isConnected || false,
            lastError: runtimeState?.lastError || null,
            lastTradeTime: runtimeState?.lastTradeTime || null,
            lastTradeSymbol: runtimeState?.lastTradeSymbol || null,
          },
          killSwitch: {
            active: killSwitchState?.active || false,
            reasons: killSwitchState?.reasons || [],
            activatedAt: killSwitchState?.activatedAt || null,
          },
          metrics: {
            equity: accountEquity || null,
            todayPnL: todayPnL || 0,
            todayTrades: todayTrades || 0,
          },
          risk: account.risk,
        };
      })
    );

    res.json({
      success: true,
      accounts: accountDetails,
      count: accountDetails.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get accounts', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/v1/admin/accounts/:id
 * Returns detailed account information
 */
router.get('/accounts/:id', async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;

    const { AccountRegistry } = await import('../multiaccount/AccountRegistry');
    const { PerAccountKillSwitch } = await import('../multiaccount/PerAccountKillSwitch');
    const { PerAccountRiskService } = await import('../multiaccount/PerAccountRiskService');

    const accountRegistry = new AccountRegistry();
    await accountRegistry.loadAccounts();
    const account = accountRegistry.getAccount(accountId);

    if (!account) {
      res.status(404).json({
        success: false,
        error: 'Account not found',
      });
      return;
    }

    const runtimeState = accountRegistry.getRuntimeState(accountId);
    const killSwitch = new PerAccountKillSwitch(process.env.DATABASE_URL);
    const riskService = new PerAccountRiskService(process.env.DATABASE_URL);

    const killSwitchState = killSwitch.getState(accountId);
    const accountEquity = await riskService.getAccountEquity(accountId);
    const todayPnL = await riskService.getTodayRealizedPnL(accountId);
    const todayTrades = await riskService.getTodayTradeCount(accountId);

    res.json({
      success: true,
      account: {
        id: account.id,
        name: account.name,
        symbols: account.symbols,
        mt5: account.mt5,
        enabled: account.enabled !== false,
        risk: account.risk,
        killSwitch: account.killSwitch,
        executionFilter: account.executionFilter,
        status: {
          paused: runtimeState?.paused || false,
          isConnected: runtimeState?.isConnected || false,
          lastError: runtimeState?.lastError || null,
          lastTradeTime: runtimeState?.lastTradeTime || null,
          lastTradeSymbol: runtimeState?.lastTradeSymbol || null,
        },
        killSwitchState: {
          active: killSwitchState?.active || false,
          reasons: killSwitchState?.reasons || [],
          activatedAt: killSwitchState?.activatedAt || null,
        },
        metrics: {
          equity: accountEquity || null,
          todayPnL: todayPnL || 0,
          todayTrades: todayTrades || 0,
        },
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get account', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/v1/admin/accounts/:id/trades
 * Returns recent trades for an account
 */
router.get('/accounts/:id/trades', async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;
    const limit = parseInt(req.query.limit as string || '20', 10);
    const offset = parseInt(req.query.offset as string || '0', 10);

    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not available' });
    }

    const result = await pool.query(
      `SELECT * FROM account_trade_decisions
       WHERE account_id = $1
       ORDER BY timestamp DESC
       LIMIT $2 OFFSET $3`,
      [accountId, limit, offset]
    );

    const trades = result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      symbol: row.symbol,
      strategy: row.strategy,
      decision: row.decision,
      riskReason: row.risk_reason,
      filterReason: row.filter_reason,
      killSwitchReason: row.kill_switch_reason,
      executionResult: row.execution_result,
      pnl: row.pnl,
    }));

    res.json({
      success: true,
      trades,
      count: trades.length,
      pagination: {
        limit,
        offset,
      },
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get account trades', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/v1/admin/accounts/:id/equity
 * Returns equity curve for an account
 */
router.get('/accounts/:id/equity', async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;
    const limit = parseInt(req.query.limit as string || '100', 10);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ error: 'Database not available' });
    }

    let query = `SELECT * FROM account_live_equity WHERE account_id = $1`;
    const params: any[] = [accountId];
    let paramIndex = 2;

    if (from) {
      query += ` AND timestamp >= $${paramIndex++}`;
      params.push(from);
    }

    if (to) {
      query += ` AND timestamp <= $${paramIndex++}`;
      params.push(to);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${paramIndex++}`;
    params.push(limit);

    const result = await pool.query(query, params);

    const equityCurve = result.rows.map(row => ({
      timestamp: row.timestamp,
      equity: parseFloat(row.equity),
      balance: parseFloat(row.balance),
      floatingPnL: row.floating_pnl ? parseFloat(row.floating_pnl) : null,
      drawdown: row.drawdown ? parseFloat(row.drawdown) : null,
    }));

    res.json({
      success: true,
      equityCurve: equityCurve.reverse(), // Reverse to get chronological order
      count: equityCurve.length,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get account equity', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

/**
 * GET /api/v1/admin/accounts/:id/kill-switch
 * Returns kill switch status for an account
 */
router.get('/accounts/:id/kill-switch', async (req: Request, res: Response) => {
  try {
    const accountId = req.params.id;

    const { PerAccountKillSwitch } = await import('../multiaccount/PerAccountKillSwitch');
    const killSwitch = new PerAccountKillSwitch(process.env.DATABASE_URL);

    const state = killSwitch.getState(accountId);

    if (!state) {
      res.status(404).json({
        success: false,
        error: 'Account not found',
      });
      return;
    }

    res.json({
      success: true,
      active: state.active,
      reasons: state.reasons,
      activatedAt: state.activatedAt?.toISOString() || null,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[AdminRoutes] Failed to get account kill switch', error);
    res.status(500).json({
      success: false,
      error: errorMsg,
    });
  }
});

export default router;

