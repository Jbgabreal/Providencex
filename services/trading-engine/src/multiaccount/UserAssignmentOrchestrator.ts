import { Logger } from '@providencex/shared-utils';
import { TenantRepository, StrategyProfileRow, Mt5Account, UserStrategyAssignment } from '../db/TenantRepository';
import { buildRiskConfigFromProfileConfig, mergeUserConfig, StrategyProfileRiskConfig } from '../risk/RiskConfigFromProfile';
import { PerAccountRiskService } from './PerAccountRiskService';
import { PerAccountKillSwitch } from './PerAccountKillSwitch';
import { AccountRegistry } from './AccountRegistry';
import { AccountInfo } from './AccountConfig';
import { AccountExecutionEngine } from './AccountExecutionEngine';
import { PriceFeedClient, CandleStore } from '../marketData';
import { RawSignal, ExecutionFilterContext } from '../strategy/v3/types';
import { TradeHistoryRepository } from '../db/TradeHistoryRepository';

export interface ActiveAssignmentContext {
  userId: string;
  mt5Account: Mt5Account;
  assignment: UserStrategyAssignment;
  strategyProfile: StrategyProfileRow;
  profileRiskConfig: StrategyProfileRiskConfig;
}

export class UserAssignmentOrchestrator {
  private readonly logger = new Logger('UserAssignmentOrchestrator');

  constructor(
    private readonly tenantRepo: TenantRepository,
    private readonly riskService: PerAccountRiskService,
    private readonly killSwitch: PerAccountKillSwitch,
    private readonly accountRegistry: AccountRegistry,
    private readonly priceFeed?: PriceFeedClient,
    private readonly candleStore?: CandleStore,
    private readonly tradeHistoryRepo?: TradeHistoryRepository
  ) {}

  /**
   * Load all active user strategy assignments with connected MT5 accounts and public profiles.
   */
  async loadActiveAssignments(): Promise<ActiveAssignmentContext[]> {
    // For now, do a single query joining assignments, accounts, and profiles.
    // This can be optimized or moved into TenantRepository if needed.
    const pool: any = (this.tenantRepo as any)['ensurePool']
      ? (this.tenantRepo as any)['ensurePool']()
      : null;

    if (!pool) {
      this.logger.warn('[UserAssignmentOrchestrator] TenantRepository has no database pool; skipping multi-tenant assignments');
      return [];
    }

    const result = await pool.query(
      `
        SELECT 
          a.id as assignment_id,
          a.user_id,
          a.mt5_account_id,
          a.strategy_profile_id,
          a.status as assignment_status,
          a.started_at,
          a.stopped_at,
          a.user_config,
          ma.*,
          sp.id as sp_id,
          sp.key as sp_key,
          sp.name as sp_name,
          sp.description as sp_description,
          sp.risk_tier,
          sp.implementation_key,
          sp.config as sp_config,
          sp.is_public,
          sp.is_frozen,
          sp.created_at as sp_created_at,
          sp.updated_at as sp_updated_at
        FROM user_strategy_assignments a
        JOIN mt5_accounts ma ON ma.id = a.mt5_account_id
        JOIN strategy_profiles sp ON sp.id = a.strategy_profile_id
        WHERE a.status = 'active'
          AND ma.status = 'connected'
          AND sp.is_public = TRUE
      `
    );

    const rows = result.rows as any[];
    const contexts: ActiveAssignmentContext[] = [];

    for (const row of rows) {
      try {
        const assignment: UserStrategyAssignment = {
          id: row.assignment_id,
          user_id: row.user_id,
          mt5_account_id: row.mt5_account_id,
          strategy_profile_id: row.strategy_profile_id,
          status: row.assignment_status,
          user_config: row.user_config || {},
          started_at: row.started_at,
          stopped_at: row.stopped_at,
          created_at: row.created_at,
          updated_at: row.updated_at,
        };

        const mt5Account: Mt5Account = {
          id: row.mt5_account_id,
          user_id: row.user_id,
          label: row.label,
          account_number: row.account_number,
          server: row.server,
          is_demo: row.is_demo,
          status: row.status,
          connection_meta: row.connection_meta,
          broker_type: row.broker_type || 'mt5',
          broker_credentials: row.broker_credentials || null,
          created_at: row.created_at,
          updated_at: row.updated_at,
          disconnected_at: row.disconnected_at,
        };

        const profile: StrategyProfileRow = {
          id: row.sp_id,
          key: row.sp_key,
          name: row.sp_name,
          description: row.sp_description,
          risk_tier: row.risk_tier,
          implementation_key: row.implementation_key,
          config: row.sp_config || {},
          is_public: row.is_public,
          is_frozen: row.is_frozen,
          created_at: row.sp_created_at,
          updated_at: row.sp_updated_at,
        };

        const baseRiskConfig = buildRiskConfigFromProfileConfig(profile.config);
        const profileRiskConfig = mergeUserConfig(baseRiskConfig, row.user_config);

        contexts.push({
          userId: assignment.user_id,
          mt5Account: mt5Account,
          assignment,
          strategyProfile: profile,
          profileRiskConfig,
        });
      } catch (error) {
        this.logger.error(
          '[UserAssignmentOrchestrator] Failed to map assignment row to context, skipping row',
          error
        );
      }
    }

    this.logger.info(
      `[UserAssignmentOrchestrator] Loaded ${contexts.length} active assignment(s)`
    );
    return contexts;
  }

  /**
   * Process all active assignments for a given signal/market context.
   * This uses AccountExecutionEngine directly and injects StrategyProfileRiskConfig
   * into PerAccountRiskService.
   */
  async processAssignmentsForSignal(
    signal: RawSignal,
    baseContext: ExecutionFilterContext,
    guardrailMode: string,
    strategyKey: string
  ): Promise<void> {
    const assignments = await this.loadActiveAssignments();
    if (assignments.length === 0) {
      return;
    }

    // Build all execution engines first, then execute IN PARALLEL
    const executions: Promise<any>[] = [];

    for (const ctx of assignments) {
      const account: AccountInfo = await this.buildAccountInfoFromAssignment(ctx);
      const accountKey = `mt5:${account.id}`;

      // Register account in AccountRegistry if not already registered
      if (!this.accountRegistry.hasAccount(accountKey)) {
        this.accountRegistry.registerAccount(accountKey, account);
        this.logger.info(
          `[UserAssignmentOrchestrator] Registered DB account in AccountRegistry: ` +
          `key=${accountKey} mt5AccountId=${ctx.mt5Account.id} user=${ctx.userId}`
        );
      }

      // Register account with kill switch
      this.killSwitch.registerAccount(account);

      this.logger.info(
        `[UserAssignmentOrchestrator] Executing assignment: user=${ctx.userId} account=${ctx.mt5Account.id} ` +
        `strategyKey=${ctx.strategyProfile.key} riskTier=${ctx.strategyProfile.risk_tier}`
      );

      // Build per-account execution engine
      const engine = new AccountExecutionEngine(
        account,
        this.accountRegistry,
        this.riskService,
        this.killSwitch,
        this.priceFeed,
        this.candleStore,
        ctx.profileRiskConfig,
        this.tradeHistoryRepo
      );

      // Queue for parallel execution
      executions.push(
        engine.execute(signal, baseContext, guardrailMode, strategyKey).catch((error) => {
          this.logger.error(
            `[UserAssignmentOrchestrator] Error executing assignment for account ${ctx.mt5Account.id}`,
            error
          );
        })
      );
    }

    // Execute ALL accounts in parallel — each BrokerAdapter handles its own connection
    await Promise.all(executions);
    this.logger.info(`[UserAssignmentOrchestrator] All ${executions.length} assignment(s) executed in parallel`);
  }

  private async buildAccountInfoFromAssignment(ctx: ActiveAssignmentContext): Promise<AccountInfo> {
    const meta = ctx.mt5Account.connection_meta || {};

    // Get default MT5 connector URL from system settings (with env fallback)
    let defaultBaseUrl = process.env.MT5_CONNECTOR_URL || 'http://localhost:3030';
    try {
      const { getSystemSettingsService } = await import('../services/SystemSettingsService');
      const settingsService = getSystemSettingsService();
      defaultBaseUrl = await settingsService.getSetting('mt5_connector_url', defaultBaseUrl);
    } catch (error) {
      // If settings service fails, use env fallback
      this.logger.warn(`[UserAssignmentOrchestrator] Failed to get MT5 connector URL from settings, using env: ${defaultBaseUrl}`);
    }

    return {
      id: ctx.mt5Account.id,
      name: ctx.mt5Account.label || `User ${ctx.userId} / ${ctx.mt5Account.account_number}`,
      mt5: {
        baseUrl:
          typeof meta.baseUrl === 'string'
            ? meta.baseUrl
            : defaultBaseUrl,
        login: Number(meta.login || ctx.mt5Account.account_number),
      },
      symbols: ['XAUUSD'], // initial default; can be extended per-profile
      risk: {
        // These values are overridden by StrategyProfileRiskConfig inside PerAccountRiskService.
        riskPercent: ctx.profileRiskConfig.riskPerTradePercent,
        maxDailyLoss: 0,
        maxWeeklyLoss: 0,
        maxConcurrentTrades: ctx.profileRiskConfig.maxTradesPerDay,
        maxDailyRisk: 0,
        maxExposure: 0,
      },
      killSwitch: {
        enabled: true,
        dailyDDLimit: 0,
        weeklyDDLimit: 0,
      },
      executionFilter: {},
      enabled: true,
      // Broker adapter fields
      brokerType: (ctx.mt5Account.broker_type as any) || 'mt5',
      brokerCredentials: ctx.mt5Account.broker_credentials || {
        baseUrl: typeof meta.baseUrl === 'string' ? meta.baseUrl : defaultBaseUrl,
        login: Number(meta.login || ctx.mt5Account.account_number),
        password: meta.password || undefined,
        server: ctx.mt5Account.server || undefined,
      },
      // Store multi-tenant metadata for trade history persistence
      metadata: {
        userId: ctx.userId,
        mt5AccountId: ctx.mt5Account.id,
        strategyProfileId: ctx.strategyProfile.id,
        assignmentId: ctx.assignment.id,
      },
    };
  }
}


