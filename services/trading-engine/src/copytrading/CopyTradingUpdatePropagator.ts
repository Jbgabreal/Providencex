/**
 * CopyTradingUpdatePropagator — propagates mentor signal updates to open copied trades.
 *
 * Handles: move_sl, breakeven, partial_close, close_all, cancel, modify_tp
 */

import { Logger } from '@providencex/shared-utils';
import { CopyTradingRepository } from './CopyTradingRepository';
import { TenantRepository } from '../db/TenantRepository';
import { BrokerAdapterFactory } from '../brokers/BrokerAdapterFactory';
import type { MentorSignalUpdate, CopiedTrade, PropagationSummary } from './types';

const logger = new Logger('CopyTradingUpdatePropagator');

export class CopyTradingUpdatePropagator {
  constructor(
    private readonly repo: CopyTradingRepository,
    private readonly tenantRepo: TenantRepository
  ) {}

  async propagateUpdate(updateId: string): Promise<PropagationSummary> {
    const pool = (this.repo as any).ensurePool();

    // Get the update and its parent signal
    const updateResult = await pool.query('SELECT * FROM mentor_signal_updates WHERE id = $1', [updateId]);
    const update: MentorSignalUpdate = updateResult.rows[0];
    if (!update) throw new Error(`Update ${updateId} not found`);

    const signal = await this.repo.getSignalById(update.mentor_signal_id);
    if (!signal) throw new Error(`Signal ${update.mentor_signal_id} not found`);

    await this.repo.updatePropagationStatus(updateId, 'propagating', 0, 0);

    let propagated = 0;
    let failed = 0;

    try {
      switch (update.update_type) {
        case 'move_sl':
          ({ propagated, failed } = await this.propagateMoveSL(signal.id, Number(update.new_sl)));
          // Update the parent signal's SL
          if (update.new_sl) await this.repo.updateSignalSL(signal.id, Number(update.new_sl));
          break;

        case 'breakeven':
          ({ propagated, failed } = await this.propagateBreakeven(signal.id));
          break;

        case 'partial_close':
          if (update.close_tp_level) {
            ({ propagated, failed } = await this.propagatePartialClose(signal.id, update.close_tp_level));
          }
          break;

        case 'close_all':
          ({ propagated, failed } = await this.propagateCloseAll(signal.id));
          await this.repo.updateSignalStatus(signal.id, 'closed');
          break;

        case 'cancel':
          ({ propagated, failed } = await this.propagateCancel(signal.id));
          await this.repo.updateSignalStatus(signal.id, 'cancelled');
          break;

        case 'modify_tp':
          // Future: modify TP on open positions
          break;
      }
    } catch (err: any) {
      logger.error(`[Propagation] Error: ${err.message}`);
    }

    const status = failed === 0 ? 'completed' : propagated > 0 ? 'completed' : 'failed';
    await this.repo.updatePropagationStatus(updateId, status, propagated, failed);

    logger.info(`[Propagation] Update ${updateId} (${update.update_type}): ${propagated} propagated, ${failed} failed`);
    return { total_trades: propagated + failed, propagated, failed };
  }

  private async propagateMoveSL(signalId: string, newSl: number): Promise<{ propagated: number; failed: number }> {
    const trades = await this.repo.getOpenCopiedTradesBySignal(signalId);
    return this.modifySLForTrades(trades, newSl);
  }

  private async propagateBreakeven(signalId: string): Promise<{ propagated: number; failed: number }> {
    const trades = await this.repo.getOpenCopiedTradesBySignal(signalId);
    // Breakeven = move SL to entry price for each trade
    let propagated = 0;
    let failed = 0;
    await Promise.all(
      trades.map(async (trade) => {
        if (!trade.entry_price) { failed++; return; }
        try {
          await this.modifySLOnBroker(trade, Number(trade.entry_price));
          await this.repo.updateCopiedTradeSL(trade.id, Number(trade.entry_price));
          propagated++;
        } catch {
          failed++;
        }
      })
    );
    return { propagated, failed };
  }

  private async propagatePartialClose(signalId: string, tpLevel: number): Promise<{ propagated: number; failed: number }> {
    const trades = await this.repo.getOpenCopiedTradesBySignalAndTpLevel(signalId, tpLevel);
    let propagated = 0;
    let failed = 0;
    await Promise.all(
      trades.map(async (trade) => {
        try {
          await this.closeTradeOnBroker(trade, `mentor_partial_close_tp${tpLevel}`);
          await this.repo.closeCopiedTrade(trade.id, null, null, `mentor_partial_close_tp${tpLevel}`);
          propagated++;
        } catch {
          failed++;
        }
      })
    );
    // Check if any TPs still open
    const remaining = await this.repo.getOpenCopiedTradesBySignal(signalId);
    if (remaining.length === 0) {
      await this.repo.updateSignalStatus(signalId, 'closed');
    } else {
      await this.repo.updateSignalStatus(signalId, 'partially_closed');
    }
    return { propagated, failed };
  }

  private async propagateCloseAll(signalId: string): Promise<{ propagated: number; failed: number }> {
    const trades = await this.repo.getOpenCopiedTradesBySignal(signalId);
    let propagated = 0;
    let failed = 0;
    await Promise.all(
      trades.map(async (trade) => {
        try {
          await this.closeTradeOnBroker(trade, 'mentor_close_all');
          await this.repo.closeCopiedTrade(trade.id, null, null, 'mentor_close_all');
          propagated++;
        } catch {
          failed++;
        }
      })
    );
    return { propagated, failed };
  }

  private async propagateCancel(signalId: string): Promise<{ propagated: number; failed: number }> {
    // Cancel only pending/executing trades, close open ones
    const pool = (this.repo as any).ensurePool();
    const result = await pool.query(
      `SELECT * FROM copied_trades WHERE mentor_signal_id = $1 AND status IN ('pending', 'executing', 'open')`,
      [signalId]
    );
    const trades: CopiedTrade[] = result.rows;
    let propagated = 0;
    let failed = 0;

    await Promise.all(
      trades.map(async (trade) => {
        try {
          if (trade.status === 'open' && trade.mt5_ticket) {
            await this.closeTradeOnBroker(trade, 'mentor_cancel');
            await this.repo.closeCopiedTrade(trade.id, null, null, 'mentor_cancel');
          } else {
            // Pending/executing — just mark cancelled
            await this.repo.updateCopiedTradeExecution(trade.id, { status: 'cancelled' });
          }
          propagated++;
        } catch {
          failed++;
        }
      })
    );
    return { propagated, failed };
  }

  private async modifySLForTrades(trades: CopiedTrade[], newSl: number): Promise<{ propagated: number; failed: number }> {
    let propagated = 0;
    let failed = 0;
    await Promise.all(
      trades.map(async (trade) => {
        try {
          await this.modifySLOnBroker(trade, newSl);
          await this.repo.updateCopiedTradeSL(trade.id, newSl);
          propagated++;
        } catch {
          failed++;
        }
      })
    );
    return { propagated, failed };
  }

  private async modifySLOnBroker(trade: CopiedTrade, newSl: number): Promise<void> {
    if (!trade.mt5_ticket) return;
    const account = await this.getAccountForTrade(trade);
    if (!account) return;

    const adapter = this.createAdapter(account);
    // Use closeTrade as fallback if modifyTrade not available
    // The BrokerAdapter interface should have modifyTrade
    if ('modifyTrade' in adapter) {
      await (adapter as any).modifyTrade(trade.mt5_ticket, { stopLoss: newSl });
    } else {
      logger.warn(`[Propagation] modifyTrade not supported for broker ${trade.broker_type}, skipping SL update`);
    }
  }

  private async closeTradeOnBroker(trade: CopiedTrade, reason: string): Promise<void> {
    if (!trade.mt5_ticket) return;
    const account = await this.getAccountForTrade(trade);
    if (!account) return;

    const adapter = this.createAdapter(account);
    const result = await adapter.closeTrade(trade.mt5_ticket, reason);
    if (!result.success) {
      throw new Error(result.error || 'Close failed');
    }
  }

  private async getAccountForTrade(trade: CopiedTrade) {
    const accounts = await this.tenantRepo.getMt5AccountsForUser(trade.user_id);
    return accounts.find((a) => a.id === trade.mt5_account_id);
  }

  private createAdapter(account: any) {
    const creds = account.broker_credentials || account.connection_meta || {};
    return BrokerAdapterFactory.create(account.broker_type || 'mt5', {
      baseUrl: creds.baseUrl || process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
      login: Number(creds.login || account.account_number),
      password: creds.password,
      server: account.server,
      apiToken: creds.apiToken,
      appId: creds.appId,
    });
  }
}
