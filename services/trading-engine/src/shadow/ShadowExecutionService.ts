/**
 * ShadowExecutionService — Handles simulated trade creation and updates.
 * Never calls real broker APIs. Uses signal prices for simulation.
 *
 * v1 Simulation Rules:
 * - Entry price = signal's entry_price (instant fill assumption)
 * - SL/TP from signal
 * - Lot size calculated same as live using follower settings
 * - PnL calculated as: (exit_price - entry_price) * lot_size * pip_multiplier
 * - Signal updates (move_sl, breakeven, close_all, partial_close, cancel) applied to sim trades
 */

import { Logger } from '@providencex/shared-utils';
import { ShadowRepository } from './ShadowRepository';
import { CopyTradingRiskService } from '../copytrading/CopyTradingRiskService';
import { NotificationService } from '../notifications/NotificationService';
import type { MentorSignal, FollowerSubscription } from '../copytrading/types';

const logger = new Logger('ShadowExecutionService');

export class ShadowExecutionService {
  private riskService = new CopyTradingRiskService();

  constructor(private repo: ShadowRepository) {}

  /**
   * Execute a signal for a shadow subscription — create simulated trades.
   */
  async executeForSubscriber(
    signal: MentorSignal,
    sub: FollowerSubscription
  ): Promise<{ created: number; failed: number }> {
    // Symbol filter
    const selectedSymbols = sub.selected_symbols || [];
    if (selectedSymbols.length > 0 && !selectedSymbols.includes(signal.symbol.toUpperCase())) {
      return { created: 0, failed: 0 };
    }

    // TP levels
    const availableTps: number[] = [];
    if (signal.tp1) availableTps.push(1);
    if (signal.tp2) availableTps.push(2);
    if (signal.tp3) availableTps.push(3);
    if (signal.tp4) availableTps.push(4);
    const tpLevels = sub.selected_tp_levels.filter(tp => availableTps.includes(tp));
    if (tpLevels.length === 0) return { created: 0, failed: 0 };

    // Calculate lot size (same logic as live)
    const lotResult = this.riskService.calculateLotSizePerTp(
      sub.risk_mode, sub.risk_amount,
      Number(signal.entry_price), Number(signal.stop_loss),
      10000, // simulated equity
      tpLevels.length, signal.symbol
    );

    let created = 0;
    let failed = 0;

    for (const tpLevel of tpLevels) {
      try {
        const tpPrice = this.getTpPrice(signal, tpLevel);

        const trade = await this.repo.createTrade({
          followerSubscriptionId: sub.id,
          mentorSignalId: signal.id,
          tpLevel,
          userId: sub.user_id,
          symbol: signal.symbol,
          direction: signal.direction,
          orderKind: signal.order_kind,
          entryPrice: Number(signal.entry_price),
          stopLoss: Number(signal.stop_loss),
          takeProfit: tpPrice,
          lotSize: lotResult.lotSize,
        });

        if (!trade) {
          // Duplicate (idempotent)
          continue;
        }

        await this.repo.createEvent({
          simulatedTradeId: trade.id,
          followerSubscriptionId: sub.id,
          mentorSignalId: signal.id,
          eventType: 'trade_opened',
          details: {
            symbol: signal.symbol, direction: signal.direction,
            entry_price: Number(signal.entry_price), tp_level: tpLevel,
            lot_size: lotResult.lotSize, mode: 'shadow',
          },
        });

        created++;
      } catch (err: any) {
        failed++;
        logger.error(`[Shadow] Failed to create sim trade: ${err.message}`);
      }
    }

    if (created > 0) {
      NotificationService.getInstance().notify({
        userId: sub.user_id,
        category: 'trading',
        eventType: 'shadow_trade_created',
        title: 'Shadow Trade Created',
        body: `${signal.direction} ${signal.symbol} simulated (${created} TP levels)`,
        payload: { symbol: signal.symbol, direction: signal.direction, mode: 'shadow', count: created },
        idempotencyKey: `shadow_trade_${signal.id}_${sub.id}`,
      });
    }

    return { created, failed };
  }

  // ==================== Signal Update Propagation ====================

  /**
   * Propagate a signal update to simulated trades.
   */
  async propagateUpdate(signalId: string, updateType: string, params: {
    newSl?: number; closeTpLevel?: number;
  }): Promise<{ propagated: number }> {
    let propagated = 0;

    switch (updateType) {
      case 'move_sl':
        if (params.newSl) propagated = await this.moveSL(signalId, params.newSl);
        break;
      case 'breakeven':
        propagated = await this.applyBreakeven(signalId);
        break;
      case 'partial_close':
        if (params.closeTpLevel) propagated = await this.partialClose(signalId, params.closeTpLevel);
        break;
      case 'close_all':
        propagated = await this.closeAll(signalId);
        break;
      case 'cancel':
        propagated = await this.cancelAll(signalId);
        break;
    }

    return { propagated };
  }

  private async moveSL(signalId: string, newSl: number): Promise<number> {
    const trades = await this.repo.getOpenTradesBySignal(signalId);
    for (const trade of trades) {
      await this.repo.updateTradeSL(trade.id, newSl);
      await this.repo.createEvent({
        simulatedTradeId: trade.id,
        followerSubscriptionId: trade.follower_subscription_id,
        mentorSignalId: signalId,
        eventType: 'sl_moved',
        details: { old_sl: Number(trade.stop_loss), new_sl: newSl },
      });
    }
    return trades.length;
  }

  private async applyBreakeven(signalId: string): Promise<number> {
    const trades = await this.repo.getOpenTradesBySignal(signalId);
    for (const trade of trades) {
      await this.repo.updateTradeSL(trade.id, Number(trade.entry_price));
      await this.repo.createEvent({
        simulatedTradeId: trade.id,
        followerSubscriptionId: trade.follower_subscription_id,
        mentorSignalId: signalId,
        eventType: 'breakeven_applied',
        details: { old_sl: Number(trade.stop_loss), new_sl: Number(trade.entry_price) },
      });
    }
    return trades.length;
  }

  private async partialClose(signalId: string, tpLevel: number): Promise<number> {
    const trades = await this.repo.getOpenTradesBySignalAndTp(signalId, tpLevel);
    for (const trade of trades) {
      const exitPrice = trade.take_profit ? Number(trade.take_profit) : Number(trade.entry_price);
      const pnl = this.calculatePnl(trade, exitPrice);
      await this.repo.closeTrade(trade.id, exitPrice, pnl, `tp${tpLevel}_hit`);
      await this.repo.createEvent({
        simulatedTradeId: trade.id,
        followerSubscriptionId: trade.follower_subscription_id,
        mentorSignalId: signalId,
        eventType: 'tp_hit',
        details: { tp_level: tpLevel, exit_price: exitPrice, pnl },
      });
    }
    return trades.length;
  }

  private async closeAll(signalId: string): Promise<number> {
    const trades = await this.repo.getOpenTradesBySignal(signalId);
    for (const trade of trades) {
      // Close at entry price (no market data → assume flat for close_all)
      const exitPrice = Number(trade.entry_price);
      const pnl = 0; // Conservative: no assumed price movement
      await this.repo.closeTrade(trade.id, exitPrice, pnl, 'mentor_close_all');
      await this.repo.createEvent({
        simulatedTradeId: trade.id,
        followerSubscriptionId: trade.follower_subscription_id,
        mentorSignalId: signalId,
        eventType: 'close_all',
        details: { exit_price: exitPrice, pnl },
      });
    }
    return trades.length;
  }

  private async cancelAll(signalId: string): Promise<number> {
    const trades = await this.repo.getOpenTradesBySignal(signalId);
    for (const trade of trades) {
      await this.repo.cancelTrade(trade.id);
      await this.repo.createEvent({
        simulatedTradeId: trade.id,
        followerSubscriptionId: trade.follower_subscription_id,
        mentorSignalId: signalId,
        eventType: 'cancelled',
        details: {},
      });
    }
    return trades.length;
  }

  /**
   * Simple PnL calculation for simulation.
   * PnL = (exit - entry) * direction_multiplier * lot_size * pip_multiplier
   */
  private calculatePnl(trade: any, exitPrice: number): number {
    const entry = Number(trade.entry_price);
    const lot = Number(trade.lot_size);
    const multiplier = trade.direction === 'BUY' ? 1 : -1;

    // Simplified: assume $1 per pip per 0.01 lot for forex, $1 per point for gold
    const symbol = (trade.symbol || '').toUpperCase();
    let pipValue: number;
    if (symbol === 'XAUUSD' || symbol === 'GOLD') {
      pipValue = lot * 100; // $1 per 0.01 move per 0.01 lot
    } else if (symbol.includes('JPY')) {
      pipValue = lot * 1000; // JPY pairs
    } else {
      pipValue = lot * 100000; // Standard forex: $10 per pip per standard lot
    }

    return Math.round(multiplier * (exitPrice - entry) * pipValue * 100) / 100;
  }

  private getTpPrice(signal: MentorSignal, tpLevel: number): number | null {
    switch (tpLevel) {
      case 1: return signal.tp1 ? Number(signal.tp1) : null;
      case 2: return signal.tp2 ? Number(signal.tp2) : null;
      case 3: return signal.tp3 ? Number(signal.tp3) : null;
      case 4: return signal.tp4 ? Number(signal.tp4) : null;
      default: return null;
    }
  }
}
