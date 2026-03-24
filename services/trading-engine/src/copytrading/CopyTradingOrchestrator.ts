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
import { SafetyGuardService } from './SafetyGuardService';
import { SafetyRepository } from './SafetyRepository';
import type { MentorSignal, FollowerSubscription, FanoutSummary } from './types';
import type { SafetySettings } from './SafetyTypes';
import { NotificationService } from '../notifications/NotificationService';
import { ShadowExecutionService } from '../shadow/ShadowExecutionService';
import { ShadowRepository } from '../shadow/ShadowRepository';

const logger = new Logger('CopyTradingOrchestrator');

export class CopyTradingOrchestrator {
  private readonly safetyGuard: SafetyGuardService;
  private readonly safetyRepo: SafetyRepository;
  private readonly shadowService: ShadowExecutionService;
  private readonly shadowRepo: ShadowRepository;

  constructor(
    private readonly repo: CopyTradingRepository,
    private readonly tenantRepo: TenantRepository,
    private readonly riskService: CopyTradingRiskService
  ) {
    this.safetyRepo = new SafetyRepository();
    this.safetyGuard = new SafetyGuardService(this.safetyRepo);
    this.shadowRepo = new ShadowRepository();
    this.shadowService = new ShadowExecutionService(this.shadowRepo);
  }

  /**
   * Fan out a newly published signal to all eligible followers.
   */
  async fanoutSignal(signalId: string): Promise<FanoutSummary> {
    const signal = await this.repo.getSignalById(signalId);
    if (!signal) throw new Error(`Signal ${signalId} not found`);

    const subscriptions = await this.repo.getActiveAutoTradeSubscriptions(signal.mentor_profile_id);

    // Phase 8: Also fan out to shadow subscriptions
    const shadowSubs = await this.shadowRepo.getActiveShadowSubscriptions(signal.mentor_profile_id);
    if (shadowSubs.length > 0) {
      logger.info(`[Fanout] Signal ${signalId}: fanning out to ${shadowSubs.length} shadow subscriber(s)`);
      await Promise.all(
        shadowSubs.map(sub =>
          this.shadowService.executeForSubscriber(signal, sub).catch(err => {
            logger.error(`[Fanout] Shadow error for sub ${sub.id}: ${err.message}`);
          })
        )
      );
    }

    if (subscriptions.length === 0) {
      logger.info(`[Fanout] Signal ${signalId}: no active auto-trade subscribers (${shadowSubs.length} shadow)`);
      return { total_subscribers: shadowSubs.length, trades_created: 0, trades_failed: 0 };
    }

    logger.info(`[Fanout] Signal ${signalId} (${signal.symbol} ${signal.direction}): fanning out to ${subscriptions.length} live + ${shadowSubs.length} shadow subscriber(s)`);

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
    // ===== Phase 4: Safety Guardrail Checks =====
    // Load extended subscription data with safety settings
    const subWithSafety = await this.safetyRepo.getSubscriptionWithSafety(sub.id);
    const safetySettings: SafetySettings = subWithSafety?.safety_settings || {};
    const extendedSub = { ...sub, safety_settings: safetySettings, blocked_symbols: subWithSafety?.blocked_symbols || [], auto_disabled_at: subWithSafety?.auto_disabled_at || null };

    // Run all safety guardrails
    const guardResult = await this.safetyGuard.evaluateAll(extendedSub, signal);
    if (!guardResult.allowed) {
      // Record blocked attempt
      await this.safetyRepo.createBlockedAttempt({
        followerSubscriptionId: sub.id,
        mentorSignalId: signal.id,
        userId: sub.user_id,
        blockReason: guardResult.blockReason!,
        guardrailType: guardResult.guardrailType!,
        thresholdValue: guardResult.thresholdValue,
        actualValue: guardResult.actualValue,
        signalSymbol: signal.symbol,
        signalDirection: signal.direction,
        signalEntryPrice: Number(signal.entry_price),
      });
      logger.info(`[Fanout] BLOCKED sub=${sub.id}: ${guardResult.blockReason} (${guardResult.guardrailType})`);
      // Phase 5: Notify user of blocked trade
      NotificationService.getInstance().tradeBlocked(sub.user_id, signal.symbol, guardResult.blockReason!, guardResult.guardrailType!);
      return { created: 0, failed: 0 };
    }

    // Check symbol filter — skip if follower doesn't want this pair
    const selectedSymbols = sub.selected_symbols || [];
    if (selectedSymbols.length > 0 && !selectedSymbols.includes(signal.symbol.toUpperCase())) {
      logger.info(`[Fanout] Symbol ${signal.symbol} not in follower's selected pairs, skipping subscription ${sub.id}`);
      return { created: 0, failed: 0 };
    }

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

    // Phase 4: Max lot guard
    const lotGuard = this.safetyGuard.checkMaxLot(safetySettings, lotResult.lotSize);
    if (!lotGuard.allowed) {
      await this.safetyRepo.createBlockedAttempt({
        followerSubscriptionId: sub.id,
        mentorSignalId: signal.id,
        userId: sub.user_id,
        blockReason: lotGuard.blockReason!,
        guardrailType: lotGuard.guardrailType!,
        thresholdValue: lotGuard.thresholdValue,
        actualValue: lotGuard.actualValue,
        signalSymbol: signal.symbol,
        signalDirection: signal.direction,
        signalEntryPrice: Number(signal.entry_price),
      });
      logger.info(`[Fanout] BLOCKED sub=${sub.id}: max_lot_exceeded (calculated=${lotResult.lotSize}, max=${safetySettings.max_lot_size})`);
      return { created: 0, failed: 0 };
    }

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

          // Phase 4: Record lifecycle event — trade created
          await this.safetyRepo.createTradeEvent({
            copiedTradeId: copiedTrade.id,
            followerSubscriptionId: sub.id,
            mentorSignalId: signal.id,
            eventType: 'trade_created',
            details: { tp_level: tpLevel, lot_size: lotResult.lotSize, symbol: signal.symbol, direction: signal.direction },
          });

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
            // Phase 4: Record lifecycle event — order filled
            await this.safetyRepo.createTradeEvent({
              copiedTradeId: copiedTrade.id,
              followerSubscriptionId: sub.id,
              mentorSignalId: signal.id,
              eventType: 'order_filled',
              details: { ticket: result.ticket, entry_price: result.rawResponse?.price || Number(signal.entry_price) },
            });
            logger.info(`[Fanout] Trade opened: sub=${sub.id} tp=${tpLevel} ticket=${result.ticket}`);
            // Phase 5: Notify user
            NotificationService.getInstance().tradeFilled(sub.user_id, signal.symbol, signal.direction, result.ticket || 0, result.rawResponse?.price || Number(signal.entry_price));
          } else {
            await this.repo.updateCopiedTradeExecution(copiedTrade.id, {
              status: 'failed',
              errorMessage: result.error || 'Unknown error',
            });
            failed++;
            // Phase 4: Record lifecycle event — trade failed
            await this.safetyRepo.createTradeEvent({
              copiedTradeId: copiedTrade.id,
              followerSubscriptionId: sub.id,
              mentorSignalId: signal.id,
              eventType: 'trade_failed',
              details: { error: result.error },
            });
            logger.error(`[Fanout] Trade failed: sub=${sub.id} tp=${tpLevel} error=${result.error}`);
            // Phase 5: Notify user
            NotificationService.getInstance().tradeFailed(sub.user_id, signal.symbol, signal.direction, result.error || 'Unknown error');
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
