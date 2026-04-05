/**
 * TradingView Webhook Route
 *
 * Receives alerts from TradingView Pine indicators and feeds them
 * directly into the trading engine's execution pipeline.
 *
 * This is a simplified, direct path: alert → validate → execute.
 * No auth, no mentor system, no approval workflow.
 *
 * Security: Protected by a secret token (TV_WEBHOOK_SECRET env var).
 *
 * TradingView Alert Setup:
 *   Webhook URL: https://<your-engine>/api/tv/webhook
 *   Message (JSON):
 *   {
 *     "secret": "your-secret-here",
 *     "symbol": "XAUUSD",
 *     "direction": "buy",
 *     "entry": {{close}},
 *     "stopLoss": 3020.50,
 *     "takeProfit": 3055.00,
 *     "reason": "H4 bullish bias, M15 OB retest, M1 BOS confirmation",
 *     "orderKind": "market"
 *   }
 */

import { Router, Request, Response } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradeSignal } from '../types';
import { OBConfluenceFilter } from './OBConfluenceFilter';

const logger = new Logger('TVWebhook');
const router: Router = Router();

// Pip values per symbol for SL distance validation
const PIP_VALUES: Record<string, number> = {
  XAUUSD: 0.1,
  EURUSD: 0.0001,
  GBPUSD: 0.0001,
  USDJPY: 0.01,
  GBPJPY: 0.01,
  EURJPY: 0.01,
  AUDUSD: 0.0001,
  NZDUSD: 0.0001,
  USDCAD: 0.0001,
  USDCHF: 0.0001,
  US30: 1.0,
  US100: 1.0,
  XAGUSD: 0.01,
  BTCUSD: 1.0,
  BTCUSDT: 1.0,
  ETHUSD: 0.1,
  ETHUSDT: 0.1,
};

/**
 * Validate and normalize a TradingView webhook payload
 */
function validatePayload(body: any): { valid: boolean; signal?: TradeSignal; error?: string } {
  // Check secret
  const secret = process.env.TV_WEBHOOK_SECRET;
  if (secret && body.secret !== secret) {
    return { valid: false, error: 'Invalid webhook secret' };
  }

  // Required fields
  if (!body.symbol) return { valid: false, error: 'Missing symbol' };
  if (!body.direction) return { valid: false, error: 'Missing direction' };
  if (!body.entry && body.entry !== 0) return { valid: false, error: 'Missing entry price' };
  if (!body.stopLoss && body.stopLoss !== 0) return { valid: false, error: 'Missing stopLoss' };
  if (!body.takeProfit && body.takeProfit !== 0) return { valid: false, error: 'Missing takeProfit' };

  // Normalize
  const symbol = body.symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const direction = body.direction.toLowerCase();
  if (direction !== 'buy' && direction !== 'sell') {
    return { valid: false, error: `Invalid direction: ${body.direction} (expected buy or sell)` };
  }

  const entry = parseFloat(body.entry);
  const stopLoss = parseFloat(body.stopLoss);
  const takeProfit = parseFloat(body.takeProfit);

  if (isNaN(entry) || isNaN(stopLoss) || isNaN(takeProfit)) {
    return { valid: false, error: 'entry, stopLoss, takeProfit must be valid numbers' };
  }

  // Sanity checks
  if (direction === 'buy') {
    if (stopLoss >= entry) return { valid: false, error: `BUY: stopLoss (${stopLoss}) must be below entry (${entry})` };
    if (takeProfit <= entry) return { valid: false, error: `BUY: takeProfit (${takeProfit}) must be above entry (${entry})` };
  } else {
    if (stopLoss <= entry) return { valid: false, error: `SELL: stopLoss (${stopLoss}) must be above entry (${entry})` };
    if (takeProfit >= entry) return { valid: false, error: `SELL: takeProfit (${takeProfit}) must be below entry (${entry})` };
  }

  // R:R check
  const slDist = Math.abs(entry - stopLoss);
  const tpDist = Math.abs(takeProfit - entry);
  const rr = slDist > 0 ? tpDist / slDist : 0;
  const minRR = parseFloat(process.env.TV_MIN_RR || '1.0');
  if (rr < minRR) {
    return { valid: false, error: `R:R ${rr.toFixed(2)} below minimum ${minRR}` };
  }

  // SL distance sanity (not too wide — protect against bad data)
  const pipValue = PIP_VALUES[symbol] || 0.0001;
  const slPips = slDist / pipValue;
  const maxSlPips = parseFloat(process.env.TV_MAX_SL_PIPS || '500');
  if (slPips > maxSlPips) {
    return { valid: false, error: `SL distance ${slPips.toFixed(1)} pips exceeds max ${maxSlPips}` };
  }

  const signal: TradeSignal = {
    symbol,
    direction: direction as 'buy' | 'sell',
    entry,
    stopLoss,
    takeProfit,
    orderKind: body.orderKind || 'market',
    reason: body.reason || `TradingView alert: ${direction} ${symbol}`,
    meta: {
      source: 'tradingview_webhook',
      riskReward: Math.round(rr * 100) / 100,
      htfTrend: direction === 'buy' ? 'bullish' : 'bearish',
      alertTime: body.time || new Date().toISOString(),
      timenow: body.timenow,
      interval: body.interval,
      ...(body.meta || {}),
    },
  };

  return { valid: true, signal };
}

/**
 * Factory: creates the webhook router with access to the engine's execution pipeline.
 *
 * @param executeTrade - Callback that feeds a TradeSignal into the full pipeline
 *                       (guardrail, risk, execution filter, multi-account)
 */
export function createTVWebhookRouter(
  executeTrade: (signal: TradeSignal, strategy: string) => Promise<{
    decision: 'trade' | 'skip';
    reason?: string;
    ticket?: string | number;
    error?: string;
  }>,
  obFilter?: OBConfluenceFilter,
): Router {

  /**
   * POST /api/tv/webhook
   *
   * Receives TradingView alert webhooks and executes trades.
   */
  router.post('/webhook', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body;

    logger.info('[TVWebhook] Received alert:', JSON.stringify(body).slice(0, 500));

    // Validate
    const validation = validatePayload(body);
    if (!validation.valid || !validation.signal) {
      logger.warn(`[TVWebhook] Rejected: ${validation.error}`);
      return res.status(400).json({ success: false, error: validation.error });
    }

    const signal = validation.signal;
    const strategy = body.strategy || 'low'; // Default risk bucket

    logger.info(
      `[TVWebhook] Valid signal: ${signal.direction} ${signal.symbol} @ ${signal.entry}, ` +
      `SL=${signal.stopLoss}, TP=${signal.takeProfit}, R:R=${signal.meta?.riskReward}`
    );

    try {
      // OB Confluence check (if bridge is connected)
      if (obFilter) {
        const obCheck = await obFilter.checkConfluence(signal.entry, signal.direction, signal.symbol);
        if (!obCheck.hasConfluence) {
          const elapsed = Date.now() - startTime;
          logger.info(`[TVWebhook] Skipped — no OB confluence: ${obCheck.reason}`);
          return res.json({
            success: false,
            decision: 'skip',
            symbol: signal.symbol,
            direction: signal.direction,
            entry: signal.entry,
            reason: `No OB confluence: ${obCheck.reason}`,
            obCheck: { obCount: obCheck.obCount },
            latencyMs: elapsed,
          });
        }
        // Add OB info to signal metadata
        signal.meta = {
          ...signal.meta,
          obConfluence: true,
          nearestOB: obCheck.nearestOB,
          obReason: obCheck.reason,
        };
        logger.info(`[TVWebhook] OB confluence confirmed: ${obCheck.reason}`);
      }

      // Execute through the full pipeline
      const result = await executeTrade(signal, strategy);

      const elapsed = Date.now() - startTime;
      logger.info(
        `[TVWebhook] Result: ${result.decision} (${elapsed}ms)` +
        (result.ticket ? ` ticket=${result.ticket}` : '') +
        (result.reason ? ` reason=${result.reason}` : '')
      );

      res.json({
        success: result.decision === 'trade',
        decision: result.decision,
        symbol: signal.symbol,
        direction: signal.direction,
        entry: signal.entry,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskReward: signal.meta?.riskReward,
        ticket: result.ticket,
        reason: result.reason,
        error: result.error,
        latencyMs: elapsed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[TVWebhook] Execution error: ${msg}`);
      res.status(500).json({ success: false, error: msg });
    }
  });

  /**
   * GET /api/tv/webhook
   *
   * Health check — verifies the webhook is reachable.
   */
  router.get('/webhook', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'tradingview-webhook',
      secretRequired: !!process.env.TV_WEBHOOK_SECRET,
      message: 'Send POST requests with TradingView alert JSON to this endpoint',
    });
  });

  return router;
}

export default router;
