/**
 * CopyTradingOrchestrator — fans out mentor signals to all active followers.
 *
 * When a mentor publishes a signal:
 * 1. Find all active auto_trade subscriptions for this mentor
 * 2. For each subscription, for each selected TP level:
 *    - Calculate lot size
 *    - Create copied_trade row (pending)
 *    - Execute via BrokerAdapter
 *    - Update copied_trade with result
 * 3. Return summary
 *
 * Execution is PARALLEL across subscribers using Promise.all().
 */

import { Logger } from '@providencex/shared-utils';
import { CopyTradingRepository } from './CopyTradingRepository';
import { CopyTradingRiskService } from './CopyTradingRiskService';
import { TenantRepository } from '../db/TenantRepository';
import { BrokerAdapterFactory } from '../brokers/BrokerAdapterFactory';
import type { MentorSignal, FollowerSubscription, FanoutSummary } from './types';

const logger = new Logger('CopyTradingOrchestrator');

export class CopyTradingOrchestrator {
  constructor(
    private readonly repo: CopyTradingRepository,
    private readonly tenantRepo: TenantRepository,
    private readonly riskService: CopyTradingRiskService
  ) {}

  /**
   * Fan out a newly published signal to all eligible followers.
   */
  async fanoutSignal(signalId: string): Promise<FanoutSummary> {
    const signal = await this.repo.getSignalById(signalId);
    if (!signal) throw new Error(`Signal ${signalId} not found`);

    const subscriptions = await this.repo.getActiveAutoTradeSubscriptions(signal.mentor_profile_id);

    if (subscriptions.length === 0) {
      logger.info(`[Fanout] Signal ${signalId}: no active auto-trade subscribers`);
      return { total_subscribers: 0, trades_created: 0, trades_failed: 0 };
    }

    logger.info(`[Fanout] Signal ${signalId} (${signal.symbol} ${signal.direction}): fanning out to ${subscriptions.length} subscriber(s)`);

    let tradesCreated = 0;
    let tradesFailed = 0;

    // Execute ALL subscribers in parallel
    const results = await Promise.all(
      subscriptions.map((sub) =>
        this.executeForSubscriber(signal, sub).catch((err) => {
          logger.error(`[Fanout] Error for subscription ${sub.id}: ${err.message}`);
          return { created: 0, failed: 1 } as { created: number; failed: number };
        })
      )
    );

    for (const r of results) {
      tradesCreated += r.created;
      tradesFailed += r.failed;
    }

    logger.info(
      `[Fanout] Signal ${signalId} complete: ${tradesCreated} trades created, ${tradesFailed} failed, ${subscriptions.length} subscribers`
    );

    return {
      total_subscribers: subscriptions.length,
      trades_created: tradesCreated,
      trades_failed: tradesFailed,
    };
  }

  private async executeForSubscriber(
    signal: MentorSignal,
    sub: FollowerSubscription
  ): Promise<{ created: number; failed: number }> {
    // Get follower's account
    const accounts = await this.tenantRepo.getMt5AccountsForUser(sub.user_id);
    const account = accounts.find((a) => a.id === sub.mt5_account_id);

    if (!account || account.status !== 'connected') {
      logger.warn(`[Fanout] Account ${sub.mt5_account_id} not connected, skipping subscription ${sub.id}`);
      return { created: 0, failed: 0 };
    }

    // Determine which TP levels to trade (intersection of selected + available on signal)
    const availableTps = this.getAvailableTpLevels(signal);
    const tpLevels = sub.selected_tp_levels.filter((tp) => availableTps.includes(tp));

    if (tpLevels.length === 0) {
      logger.info(`[Fanout] No matching TP levels for subscription ${sub.id}`);
      return { created: 0, failed: 0 };
    }

    // Calculate lot size per TP
    const lotResult = this.riskService.calculateLotSizePerTp(
      sub.risk_mode,
      sub.risk_amount,
      Number(signal.entry_price),
      Number(signal.stop_loss),
      10000, // TODO: get real account equity via broker adapter
      tpLevels.length,
      signal.symbol
    );

    // Create broker adapter
    const credentials = account.broker_credentials || account.connection_meta || {};
    const brokerAdapter = BrokerAdapterFactory.create(
      account.broker_type as any,
      {
        baseUrl: credentials.baseUrl || process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
        login: Number(credentials.login || account.account_number),
        password: credentials.password,
        server: account.server,
        apiToken: credentials.apiToken,
        appId: credentials.appId,
      }
    );

    let created = 0;
    let failed = 0;

    // Execute each TP level as a separate child trade (PARALLEL within subscriber)
    await Promise.all(
      tpLevels.map(async (tpLevel) => {
        const tpPrice = this.getTpPrice(signal, tpLevel);

        try {
          // Create pending copied trade (idempotent via UNIQUE constraint)
          const copiedTrade = await this.repo.createCopiedTrade({
            followerSubscriptionId: sub.id,
            mentorSignalId: signal.id,
            tpLevel,
            userId: sub.user_id,
            mt5AccountId: sub.mt5_account_id,
            brokerType: account.broker_type,
            lotSize: lotResult.lotSize,
            stopLoss: Number(signal.stop_loss),
            takeProfit: tpPrice,
          });

          if (!copiedTrade) {
            // UNIQUE conflict — already exists (idempotent)
            logger.info(`[Fanout] Copied trade already exists: sub=${sub.id} signal=${signal.id} tp=${tpLevel}`);
            return;
          }

          // Mark executing
          await this.repo.updateCopiedTradeExecution(copiedTrade.id, { status: 'executing' });

          // Execute trade via broker
          const result = await brokerAdapter.openTrade({
            symbol: signal.symbol,
            direction: signal.direction,
            orderKind: signal.order_kind as any,
            entryPrice: Number(signal.entry_price),
            lotSize: lotResult.lotSize,
            stopLossPrice: Number(signal.stop_loss),
            takeProfitPrice: tpPrice || 0,
            strategyId: 'copy_trade',
            metadata: {
              mentor_signal_id: signal.id,
              copied_trade_id: copiedTrade.id,
              tp_level: tpLevel,
            },
          });

          if (result.success) {
            await this.repo.updateCopiedTradeExecution(copiedTrade.id, {
              status: 'open',
              mt5Ticket: typeof result.ticket === 'string' ? parseInt(result.ticket) : (result.ticket as number),
              entryPrice: result.rawResponse?.price || Number(signal.entry_price),
            });
            created++;
            logger.info(`[Fanout] Trade opened: sub=${sub.id} tp=${tpLevel} ticket=${result.ticket}`);
          } else {
            await this.repo.updateCopiedTradeExecution(copiedTrade.id, {
              status: 'failed',
              errorMessage: result.error || 'Unknown error',
            });
            failed++;
            logger.error(`[Fanout] Trade failed: sub=${sub.id} tp=${tpLevel} error=${result.error}`);
          }
        } catch (err: any) {
          failed++;
          logger.error(`[Fanout] Exception for sub=${sub.id} tp=${tpLevel}: ${err.message}`);
        }
      })
    );

    return { created, failed };
  }

  private getAvailableTpLevels(signal: MentorSignal): number[] {
    const levels: number[] = [];
    if (signal.tp1) levels.push(1);
    if (signal.tp2) levels.push(2);
    if (signal.tp3) levels.push(3);
    if (signal.tp4) levels.push(4);
    return levels;
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
