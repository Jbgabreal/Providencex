/**
 * Trade Journal Service
 *
 * Orchestrates journal lifecycle: signal → open → closed
 * Called from the execution flow to record every trade with full context.
 */

import { Logger } from '@providencex/shared-utils';
import { TradeJournalRepository } from './TradeJournalRepository';
import { TradeJournalEntry } from './types';

const logger = new Logger('TradeJournalService');

export class TradeJournalService {
  private repo: TradeJournalRepository;

  constructor(repo: TradeJournalRepository) {
    this.repo = repo;
  }

  /**
   * Called when a strategy generates a signal (before execution filter)
   * Creates a journal entry with status='signal'
   */
  async onSignalGenerated(params: {
    strategyKey: string;
    strategyVersion?: string;
    strategyProfileKey?: string;
    symbol: string;
    direction: 'buy' | 'sell';
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    lotSize?: number;
    riskPercent?: number;
    rrTarget?: number;
    setupContext: Record<string, any>;
    entryContext?: Record<string, any>;
  }): Promise<string> {
    try {
      const journalId = await this.repo.createEntry({
        strategyKey: params.strategyKey,
        strategyVersion: params.strategyVersion,
        strategyProfileKey: params.strategyProfileKey,
        symbol: params.symbol,
        direction: params.direction,
        entryPrice: params.entryPrice,
        stopLoss: params.stopLoss,
        takeProfit: params.takeProfit,
        lotSize: params.lotSize,
        riskPercent: params.riskPercent,
        rrTarget: params.rrTarget,
        status: 'signal',
        setupContext: params.setupContext,
        entryContext: params.entryContext || {},
        exitContext: {},
      });
      logger.info(`[Journal] Signal recorded: ${params.strategyKey} ${params.direction} ${params.symbol} → ${journalId}`);
      return journalId;
    } catch (err) {
      logger.error('[Journal] Failed to record signal', err);
      return '';
    }
  }

  /**
   * Called when a trade is opened (after execution)
   */
  async onTradeOpened(journalId: string, params: {
    executedTradeId?: string;
    tradeDecisionId?: number;
    lotSize?: number;
    entryPrice?: number;
  }): Promise<void> {
    if (!journalId) return;
    try {
      await this.repo.updateOnOpen(journalId, {
        executedTradeId: params.executedTradeId,
        tradeDecisionId: params.tradeDecisionId,
        lotSize: params.lotSize,
        entryPrice: params.entryPrice,
        openedAt: new Date(),
      });
      logger.info(`[Journal] Trade opened: ${journalId}`);
    } catch (err) {
      logger.error(`[Journal] Failed to update on open: ${journalId}`, err);
    }
  }

  /**
   * Called when a trade is closed
   * Calculates R-multiple and determines result
   */
  async onTradeClosed(journalId: string, params: {
    exitPrice: number;
    profit: number;
    closeReason: string;
    exitContext?: Record<string, any>;
  }): Promise<void> {
    if (!journalId) return;
    try {
      // Get the entry to calculate R-multiple
      const entry = await this.repo.getById(journalId);
      if (!entry) {
        logger.warn(`[Journal] Entry not found for close: ${journalId}`);
        return;
      }

      let rMultiple: number | undefined;
      if (entry.entryPrice && entry.stopLoss) {
        const risk = Math.abs(entry.entryPrice - entry.stopLoss);
        if (risk > 0) {
          rMultiple = Math.round((params.profit / (risk * (entry.lotSize || 1) * 100)) * 100) / 100;
        }
      }

      const result: 'win' | 'loss' | 'breakeven' =
        params.profit > 0 ? 'win' : params.profit < 0 ? 'loss' : 'breakeven';

      await this.repo.updateOnClose(journalId, {
        exitPrice: params.exitPrice,
        profit: params.profit,
        rMultiple,
        result,
        closeReason: params.closeReason,
        exitContext: params.exitContext,
      });

      logger.info(`[Journal] Trade closed: ${journalId} | ${result} | $${params.profit.toFixed(2)} | R: ${rMultiple?.toFixed(2) || 'N/A'}`);
    } catch (err) {
      logger.error(`[Journal] Failed to update on close: ${journalId}`, err);
    }
  }

  /**
   * Called when a signal is filtered out (didn't become a trade)
   */
  async onSignalCancelled(journalId: string, reason: string): Promise<void> {
    if (!journalId) return;
    try {
      await this.repo.cancel(journalId, reason);
      logger.debug(`[Journal] Signal cancelled: ${journalId} — ${reason}`);
    } catch (err) {
      logger.error(`[Journal] Failed to cancel: ${journalId}`, err);
    }
  }
}
