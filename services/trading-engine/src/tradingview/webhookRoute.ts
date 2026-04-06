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
import axios from 'axios';
import { Logger } from '@providencex/shared-utils';
import { TradeSignal } from '../types';
import { OBConfluenceFilter } from './OBConfluenceFilter';
import { TradeHistoryRepository } from '../db/TradeHistoryRepository';

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
  const minRR = parseFloat(process.env.TV_MIN_RR || '1.5');
  if (rr < minRR) {
    return { valid: false, error: `R:R ${rr.toFixed(2)} below minimum ${minRR}` };
  }

  // Displacement candle check (from Pine meta)
  const requireDisplacement = process.env.TV_REQUIRE_DISPLACEMENT !== 'false';
  if (requireDisplacement && body.meta?.bodyRatio != null) {
    const minBodyRatio = parseFloat(process.env.TV_MIN_BODY_RATIO || '0.4');
    if (parseFloat(body.meta.bodyRatio) < minBodyRatio) {
      return { valid: false, error: `Displacement too weak: body ratio ${body.meta.bodyRatio} < ${minBodyRatio}` };
    }
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
      htfTrend: body.meta?.htfTrend || (direction === 'buy' ? 'bullish' : 'bearish'),
      alertTime: body.time || new Date().toISOString(),
      timenow: body.timenow,
      interval: body.interval,
      obTop: body.meta?.obTop,
      obBot: body.meta?.obBot,
      bodyRatio: body.meta?.bodyRatio,
      emaTF: body.meta?.emaTF,
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
  deps?: { tradeHistoryRepo?: TradeHistoryRepository },
): Router {

  const mt5BaseUrl = process.env.MT5_CONNECTOR_URL || 'http://localhost:3030';

  /**
   * Find all open trades for the TradingView strategy on a given symbol.
   * Returns tickets across ALL users subscribed to the strategy.
   */
  async function findOpenTVTrades(symbol: string): Promise<Array<{ mt5_ticket: number; user_id: string; mt5_account_id: string; direction: string }>> {
    if (!deps?.tradeHistoryRepo) {
      logger.warn('[TVWebhook] No TradeHistoryRepository — cannot find open trades');
      return [];
    }
    const pool = (deps.tradeHistoryRepo as any).pool;
    if (!pool) return [];

    const result = await pool.query(
      `SELECT mt5_ticket, user_id, mt5_account_id, direction
       FROM executed_trades
       WHERE symbol = $1
         AND closed_at IS NULL
         AND (
           strategy_profile_id IN (SELECT id FROM strategy_profiles WHERE key = 'tradingview_signal_v1' OR implementation_key = 'TV_SIGNAL_V1')
           OR metadata->>'strategy' = 'TV_WEBHOOK'
           OR entry_reason LIKE '%TradingView%'
         )
       ORDER BY opened_at DESC`,
      [symbol]
    );
    return result.rows;
  }

  /**
   * Call MT5 connector to modify a trade's SL/TP.
   */
  async function modifyTrade(ticket: number, stopLoss?: number, takeProfit?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const ticketNum = typeof ticket === 'string' ? parseInt(ticket, 10) : ticket;
      const payload: Record<string, any> = { ticket: ticketNum };
      if (stopLoss != null) payload.stop_loss = stopLoss;
      if (takeProfit != null) payload.take_profit = takeProfit;
      const resp = await axios.post(`${mt5BaseUrl}/api/v1/trades/modify`, payload, { timeout: 10000 });
      return { success: resp.data?.success === true, error: resp.data?.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * Call MT5 connector to partially close a trade.
   */
  async function partialCloseTrade(ticket: number, volumePercent: number): Promise<{ success: boolean; error?: string }> {
    try {
      const ticketNum = typeof ticket === 'string' ? parseInt(ticket, 10) : ticket;
      const resp = await axios.post(`${mt5BaseUrl}/api/v1/trades/partial-close`, {
        ticket: ticketNum,
        volume_percent: volumePercent,
      }, { timeout: 10000 });
      return { success: resp.data?.success === true, error: resp.data?.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * Call MT5 connector to fully close a trade.
   */
  async function closeTrade(ticket: number): Promise<{ success: boolean; error?: string }> {
    try {
      const ticketNum = typeof ticket === 'string' ? parseInt(ticket, 10) : ticket;
      const resp = await axios.post(`${mt5BaseUrl}/api/v1/trades/close`, { ticket: ticketNum }, { timeout: 10000 });
      return { success: resp.data?.success === true, error: resp.data?.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /**
   * POST /api/tv/webhook
   *
   * Receives TradingView alert webhooks and executes trades.
   */
  router.post('/webhook', async (req: Request, res: Response) => {
    const startTime = Date.now();
    const body = req.body;

    logger.info('[TVWebhook] Received alert:', JSON.stringify(body).slice(0, 500));

    // ── Lifecycle events: partial_close, modify_sl, close ──
    // These come from the PB v3 indicator after an entry has been made.
    // They operate on ALL open TV strategy trades for the symbol.
    if (body.event && ['partial_close', 'modify_sl', 'close'].includes(body.event)) {
      // Validate secret
      const secret = process.env.TV_WEBHOOK_SECRET;
      if (secret && body.secret !== secret) {
        return res.status(400).json({ success: false, error: 'Invalid webhook secret' });
      }

      const symbol = (body.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!symbol) {
        return res.status(400).json({ success: false, error: 'Missing symbol for lifecycle event' });
      }

      try {
        const openTrades = await findOpenTVTrades(symbol);
        if (openTrades.length === 0) {
          logger.warn(`[TVWebhook] ${body.event}: No open TV trades found for ${symbol}`);
          return res.json({ success: true, event: body.event, symbol, tradesFound: 0, message: 'No open trades to modify' });
        }

        logger.info(`[TVWebhook] ${body.event} ${symbol}: Found ${openTrades.length} open trade(s) across users`);

        const results: Array<{ ticket: number; user_id: string; success: boolean; error?: string }> = [];

        for (const trade of openTrades) {
          const ticketNum = typeof trade.mt5_ticket === 'string' ? parseInt(trade.mt5_ticket as any, 10) : trade.mt5_ticket;
          let result: { success: boolean; error?: string };

          if (body.event === 'partial_close') {
            const closePct = parseFloat(body.closePct || '50');
            result = await partialCloseTrade(ticketNum, closePct);
            // After partial close, update SL to breakeven if provided
            if (result.success && body.newStopLoss != null) {
              const modResult = await modifyTrade(ticketNum, parseFloat(body.newStopLoss));
              if (!modResult.success) {
                logger.warn(`[TVWebhook] partial_close: closed ${closePct}% but failed to move SL for ticket ${ticketNum}: ${modResult.error}`);
              }
            }
            logger.info(`[TVWebhook] partial_close ticket=${ticketNum} user=${trade.user_id}: ${result.success ? 'OK' : result.error}`);

          } else if (body.event === 'modify_sl') {
            const newSL = parseFloat(body.newStopLoss);
            if (isNaN(newSL)) {
              result = { success: false, error: 'Invalid newStopLoss' };
            } else {
              result = await modifyTrade(ticketNum, newSL);
            }
            logger.info(`[TVWebhook] modify_sl ticket=${ticketNum} user=${trade.user_id} SL=${body.newStopLoss}: ${result.success ? 'OK' : result.error}`);

          } else if (body.event === 'close') {
            result = await closeTrade(ticketNum);
            // Mark trade as closed in DB
            if (result.success && deps?.tradeHistoryRepo) {
              try {
                const pool = (deps.tradeHistoryRepo as any).pool;
                if (pool) {
                  await pool.query(
                    `UPDATE executed_trades SET closed_at = NOW(), exit_reason = $1 WHERE mt5_ticket = $2 AND closed_at IS NULL`,
                    [body.reason || 'TV indicator close signal', ticketNum]
                  );
                }
              } catch {}
            }
            logger.info(`[TVWebhook] close ticket=${ticketNum} user=${trade.user_id}: ${result.success ? 'OK' : result.error}`);

          } else {
            result = { success: false, error: `Unknown event: ${body.event}` };
          }

          results.push({ ticket: ticketNum, user_id: trade.user_id, ...result });
        }

        const succeeded = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        const elapsed = Date.now() - startTime;

        logger.info(`[TVWebhook] ${body.event} ${symbol}: ${succeeded} succeeded, ${failed} failed (${elapsed}ms)`);

        return res.json({
          success: succeeded > 0,
          event: body.event,
          symbol,
          tradesFound: openTrades.length,
          succeeded,
          failed,
          results,
          latencyMs: elapsed,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[TVWebhook] Lifecycle event error: ${msg}`);
        return res.status(500).json({ success: false, error: msg });
      }
    }

    // ── Entry signal (original flow) ──
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
   * POST /api/tv/webhook — lifecycle events (partial_close, modify_sl, close)
   *
   * These fire AFTER entry, from the PB v3 indicator tracking position state.
   * The main /webhook handler above processes entry signals.
   * Lifecycle events are detected by the presence of body.event.
   * They are injected at the top of the existing handler via early return.
   */

  // Lifecycle events are handled inside the main /webhook handler above.
  // We detect them by checking body.event before entry validation.
  // This is done by wrapping the handler — see the updated POST /webhook below.

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
