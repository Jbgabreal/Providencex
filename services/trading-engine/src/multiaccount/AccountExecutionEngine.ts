/**
 * Account Execution Engine (Trading Engine v12)
 * 
 * Handles trade execution for a single account
 */

import { Logger, getNowInPXTimezone } from '@providencex/shared-utils';
import axios, { AxiosError } from 'axios';
import { AccountInfo } from './AccountConfig';
import { AccountRegistry } from './AccountRegistry';
import { PerAccountRiskService, AccountRiskContext } from './PerAccountRiskService';
import { PerAccountKillSwitch, AccountKillSwitchContext } from './PerAccountKillSwitch';
import { PerAccountExecutionFilter } from './PerAccountExecutionFilter';
import { RawSignal, ExecutionDecision, ExecutionFilterContext } from '../strategy/v3/types';
import { TradeRequest, TradeResponse } from '@providencex/shared-types';
import { PriceFeedClient, CandleStore } from '../marketData';
import { StrategyProfileRiskConfig } from '../risk/RiskConfigFromProfile';
import { TradeHistoryRepository } from '../db/TradeHistoryRepository';

const logger = new Logger('AccountExecutionEngine');

/**
 * Account execution result
 */
export interface AccountExecutionResult {
  accountId: string;
  success: boolean;
  decision: 'TRADE' | 'SKIP';
  reasons: string[];
  ticket?: string | number; // MT5 ticket can be string or number
  error?: string;
  riskReason?: string;
  filterReason?: string;
  killSwitchReason?: string;
}

/**
 * Account Execution Engine - Handles execution for one account
 */
export class AccountExecutionEngine {
  private account: AccountInfo;
  private accountRegistry: AccountRegistry;
  private riskService: PerAccountRiskService;
  private killSwitch: PerAccountKillSwitch;
  private executionFilter: PerAccountExecutionFilter;
  private priceFeed?: PriceFeedClient;
  private candleStore?: CandleStore;
  private profileRiskConfig?: StrategyProfileRiskConfig;
  private tradeHistoryRepo?: TradeHistoryRepository;

  constructor(
    account: AccountInfo,
    accountRegistry: AccountRegistry,
    riskService: PerAccountRiskService,
    killSwitch: PerAccountKillSwitch,
    priceFeed?: PriceFeedClient,
    candleStore?: CandleStore,
    profileRiskConfig?: StrategyProfileRiskConfig,
    tradeHistoryRepo?: TradeHistoryRepository
  ) {
    this.account = account;
    this.accountRegistry = accountRegistry;
    this.riskService = riskService;
    this.killSwitch = killSwitch;
    this.executionFilter = new PerAccountExecutionFilter();
    this.priceFeed = priceFeed;
    this.candleStore = candleStore;
    this.profileRiskConfig = profileRiskConfig;
    this.tradeHistoryRepo = tradeHistoryRepo;
  }

  /**
   * Execute trade for this account
   */
  async execute(
    signal: RawSignal,
    baseContext: ExecutionFilterContext,
    guardrailMode: string,
    strategy: string
  ): Promise<AccountExecutionResult> {
    // Check if account trades this symbol
    if (!this.account.symbols.includes(signal.symbol.toUpperCase())) {
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: [`Symbol ${signal.symbol} not configured for account ${this.account.id}`],
      };
    }

    // Check if account is paused (runtime state)
    const runtimeState = this.accountRegistry.getRuntimeState(this.account.id);
    if (runtimeState?.paused) {
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: [`Account ${this.account.id} is paused: ${runtimeState.lastError || 'Kill switch active'}`],
        killSwitchReason: runtimeState.lastError || 'Account paused',
      };
    }

    // Check if account is connected
    if (runtimeState && !runtimeState.isConnected) {
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: [`Account ${this.account.id} MT5 connector not connected`],
        error: 'MT5 connector not connected',
      };
    }

    // Step 1: Check account kill switch
    const killSwitchContext: AccountKillSwitchContext = {
      accountId: this.account.id,
      symbol: signal.symbol,
      todayRealizedPnL: 0, // Will be loaded
      currentDrawdown: 0, // Will be loaded
      currentSpreadPips: baseContext.spreadPips || 0,
      currentExposure: 0, // Will be loaded
      consecutiveLosses: 0, // Will be loaded
      latestTick: this.priceFeed?.getLatestTick(signal.symbol),
    };

    // Load account-specific data
    const accountEquity = await this.riskService.getAccountEquity(this.account.id) || 10000; // Default if not found
    killSwitchContext.todayRealizedPnL = await this.riskService.getTodayRealizedPnL(this.account.id);
    // TODO: Load weekly PnL, drawdown, consecutive losses, exposure

    const killSwitchResult = await this.killSwitch.evaluate(this.account, killSwitchContext);

    if (killSwitchResult.blocked) {
      this.accountRegistry.pauseAccount(this.account.id, killSwitchResult.reasons.join('; '));
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: killSwitchResult.reasons,
        killSwitchReason: killSwitchResult.reasons.join('; '),
      };
    }

    // Step 2: Check account risk
    const riskContext: AccountRiskContext = {
      accountId: this.account.id,
      accountEquity,
      todayRealizedPnL: killSwitchContext.todayRealizedPnL,
      tradesTakenToday: await this.riskService.getTodayTradeCount(this.account.id),
      currentExposure: killSwitchContext.currentExposure,
      concurrentTrades: 0, // TODO: Load from open trades
      guardrailMode: guardrailMode as any,
    };

    // NOTE: profile-driven risk can be injected via StrategyProfileRiskConfig in future
    const riskCheck = this.riskService.canTakeNewTrade(
      this.account,
      riskContext,
      this.profileRiskConfig
    );

    if (!riskCheck.allowed) {
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: [riskCheck.reason || 'Risk check failed'],
        riskReason: riskCheck.reason,
      };
    }

    // Step 3: Check account execution filter
    const filterDecision = await this.executionFilter.evaluate(
      this.account,
      signal,
      baseContext,
      undefined, // TODO: Pass per-account OpenTradesService
      undefined, // orderFlowService - not used in multi-account
      undefined // executionFilterState - not used in multi-account (yet)
    );

    if (filterDecision.action === 'SKIP') {
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: filterDecision.reasons,
        filterReason: filterDecision.reasons.join('; '),
      };
    }

    // Step 4: Calculate lot size
    const stopLossPips = Math.abs(signal.entryPrice - signal.sl) / this.getPipValue(signal.symbol, signal.entryPrice);
    const currentPrice = baseContext.currentPrice || signal.entryPrice;
    const lotSize = this.riskService.calculateLotSize(
      this.account,
      riskContext,
      stopLossPips,
      currentPrice,
      signal.symbol,
      this.profileRiskConfig
    );

    // Step 4.5: Check if market is open (weekend/market hours check)
    const now = getNowInPXTimezone();
    const dayOfWeek = now.weekday; // 1 = Monday, 7 = Sunday
    const hour = now.hour;
    
    // Market hours check (configurable via env)
    const checkMarketHours = process.env.CHECK_MARKET_HOURS !== 'false'; // Default: true
    if (checkMarketHours) {
      // Weekend check: Saturday (6) or Sunday (7) - market is closed
      if (dayOfWeek === 6 || dayOfWeek === 7) {
        const dayName = dayOfWeek === 6 ? 'Saturday' : 'Sunday';
        logger.warn(`[${this.account.id}] Market is closed: ${dayName} - skipping trade`);
        return {
          accountId: this.account.id,
          success: false,
          decision: 'SKIP',
          reasons: [`Market is closed: ${dayName}`],
        };
      }
      
      // Friday after market close: FX markets typically close around 17:00 ET (5 PM)
      if (dayOfWeek === 5 && hour >= 17) {
        logger.warn(`[${this.account.id}] Market is closed: Friday after 17:00 ET - skipping trade`);
        return {
          accountId: this.account.id,
          success: false,
          decision: 'SKIP',
          reasons: ['Market is closed: Friday after 17:00 ET'],
        };
      }
    }

    // Step 5: Execute trade via MT5 connector
    // Build trade request outside try-catch for error logging
    const latestTick = this.priceFeed?.getLatestTick(signal.symbol);
    const latestCandle = this.candleStore?.getLatestCandle(signal.symbol);

    logger.info(
      `[${this.account.id}] Executing trade: ${signal.symbol} ${signal.direction} @ ${signal.entryPrice}, ` +
      `lot_size: ${lotSize}, current_price: ${latestTick?.mid.toFixed(5) || 'N/A'}`
    );

    const tradeRequest: TradeRequest = {
      symbol: signal.symbol,
      direction: signal.direction.toUpperCase() as 'BUY' | 'SELL',
      entry_type: 'MARKET',
      order_kind: 'market',
      entry_price: signal.entryPrice,
      lot_size: lotSize,
      stop_loss_price: signal.sl,
      take_profit_price: signal.tp,
      strategy_id: 'smc_v1',
      metadata: {
        signal_reason: signal.smcMetadata?.entryReason || 'SMC signal',
        strategy,
        account_id: this.account.id,
      },
    };

    try {

      // Call account-specific MT5 connector
      const response = await axios.post<TradeResponse>(
        `${this.account.mt5.baseUrl}/api/v1/trades/open`,
        tradeRequest,
        {
          timeout: 10000,
          validateStatus: (status) => status < 500,
        }
      );

      if (response.status >= 200 && response.status < 300) {
        logger.info(`[${this.account.id}] Trade executed successfully: MT5 ticket ${response.data.mt5_ticket}`);

        // Record successful trade
        this.accountRegistry.recordTrade(this.account.id, signal.symbol);

        // Persist trade to history if this is a multi-tenant account
        if (this.tradeHistoryRepo && this.account.metadata) {
          const metadata = this.account.metadata;
          try {
            await this.tradeHistoryRepo.recordTradeOpened({
              userId: metadata.userId,
              mt5AccountId: metadata.mt5AccountId,
              strategyProfileId: metadata.strategyProfileId,
              assignmentId: metadata.assignmentId,
              mt5Ticket: typeof response.data.mt5_ticket === 'string'
                ? parseInt(response.data.mt5_ticket, 10)
                : response.data.mt5_ticket,
              mt5OrderId: (response.data as any).mt5_order_id || undefined,
              symbol: signal.symbol,
              direction: signal.direction.toUpperCase() as 'BUY' | 'SELL',
              lotSize,
              entryPrice: signal.entryPrice,
              stopLossPrice: signal.sl || undefined,
              takeProfitPrice: signal.tp || undefined,
              entryReason: signal.smcMetadata?.entryReason || 'SMC signal',
              metadata: {
                strategy,
                account_id: this.account.id,
              },
            });
            logger.debug(`[${this.account.id}] Trade persisted to history: ticket ${response.data.mt5_ticket}`);
          } catch (error) {
            logger.error(`[${this.account.id}] Failed to persist trade to history`, error);
            // Don't fail the trade execution if history persistence fails
          }
        }

        return {
          accountId: this.account.id,
          success: true,
          decision: 'TRADE',
          reasons: ['Trade executed successfully'],
          ticket: typeof response.data.mt5_ticket === 'string' ? parseInt(response.data.mt5_ticket, 10) : response.data.mt5_ticket,
        };
      } else {
        // Extract error message from response body
        const errorDetail = response.data as any;
        const errorMessage = errorDetail?.error || errorDetail?.message || errorDetail?.detail || `MT5 Connector returned status ${response.status}`;
        const errorMsg = `MT5 Connector returned status ${response.status}: ${errorMessage}`;
        
        logger.error(`[${this.account.id}] ${errorMsg}`, {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
          request: {
            symbol: tradeRequest.symbol,
            direction: tradeRequest.direction,
            lotSize: tradeRequest.lot_size,
          },
        });
        
        this.accountRegistry.recordError(this.account.id, errorMsg);
        return {
          accountId: this.account.id,
          success: false,
          decision: 'SKIP',
          reasons: [errorMsg],
          error: errorMsg,
        };
      }
    } catch (error) {
      // Handle Axios errors with better detail extraction
      let errorMsg: string;
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        const errorDetail = axiosError.response?.data as any;
        const errorMessage = errorDetail?.error || errorDetail?.message || errorDetail?.detail || axiosError.message;
        errorMsg = `MT5 Connector error (${axiosError.response?.status || 'network'}): ${errorMessage}`;
        
        logger.error(`[${this.account.id}] Trade execution failed: ${errorMsg}`, {
          code: axiosError.code,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
          request: {
            url: axiosError.config?.url,
            method: axiosError.config?.method,
            symbol: tradeRequest.symbol,
            direction: tradeRequest.direction,
          },
        });
      } else {
        errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[${this.account.id}] Trade execution failed: ${errorMsg}`, error);
      }
      
      this.accountRegistry.recordError(this.account.id, errorMsg);
      return {
        accountId: this.account.id,
        success: false,
        decision: 'SKIP',
        reasons: [errorMsg],
        error: errorMsg,
      };
    }
  }

  /**
   * Get pip value for symbol
   */
  private getPipValue(symbol: string, price: number): number {
    symbol = symbol.toUpperCase();

    if (symbol.includes('USD') && !symbol.includes('XAU')) {
      return 0.0001;
    }

    if (symbol === 'XAUUSD' || symbol === 'GOLD') {
      return 0.1;
    }

    if (symbol === 'US30' || symbol === 'DOW') {
      return 1.0;
    }

    return 0.0001;
  }
}

