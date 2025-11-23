/**
 * Per-Account Execution Filter (Trading Engine v12)
 * 
 * Applies execution filter with per-account overrides
 */

import { Logger } from '@providencex/shared-utils';
import { AccountInfo, AccountExecutionFilterConfig } from './AccountConfig';
import { RawSignal, ExecutionDecision, ExecutionFilterConfig, ExecutionFilterContext } from '../strategy/v3/types';
import { evaluateExecution } from '../strategy/v3/ExecutionFilter';
import { executionFilterConfig } from '../config/executionFilterConfig';

const logger = new Logger('PerAccountExecutionFilter');

/**
 * Per-Account Execution Filter
 */
export class PerAccountExecutionFilter {
  /**
   * Evaluate execution filter with account-specific overrides
   */
  async evaluate(
    account: AccountInfo,
    signal: RawSignal,
    baseContext: ExecutionFilterContext,
    openTradesService?: any, // OpenTradesService for exposure checks
    orderFlowService?: any, // v14: Optional order flow service
    executionFilterState?: any // For DB-based exposure queries as fallback
  ): Promise<ExecutionDecision> {
    // Start with base execution filter config
    let config: ExecutionFilterConfig = executionFilterConfig;

    // Apply account-specific overrides if provided
    if (account.executionFilter) {
      config = this.applyAccountOverrides(config, account.executionFilter, signal.symbol);
    }

    // Evaluate using base evaluation function
    return await evaluateExecution(signal, config, baseContext, openTradesService, orderFlowService, executionFilterState);
  }

  /**
   * Apply account-specific filter overrides
   */
  private applyAccountOverrides(
    baseConfig: ExecutionFilterConfig,
    accountFilter: AccountExecutionFilterConfig,
    symbol: string
  ): ExecutionFilterConfig {
    // Clone config to avoid modifying original
    const config: ExecutionFilterConfig = JSON.parse(JSON.stringify(baseConfig));
    const symbolRules = config.rulesBySymbol[symbol];

    if (!symbolRules) {
      return config;
    }

    // Apply overrides
    if (accountFilter.maxTradesPerDay !== undefined) {
      symbolRules.maxTradesPerDay = accountFilter.maxTradesPerDay;
    }

    if (accountFilter.cooldownMinutes !== undefined) {
      symbolRules.minMinutesBetweenTrades = accountFilter.cooldownMinutes;
    }

    // Note: minSpreadPips is NOT the same as maxSpreadPips
    // minSpreadPips would be used to avoid trading in illiquid markets (not implemented)
    // Do NOT override maxSpreadPips with minSpreadPips - use the defaults from executionFilterConfig.ts
    // If an account needs to override maxSpreadPips, add maxSpreadPips to AccountExecutionFilterConfig

    if (accountFilter.sessionWindows !== undefined) {
      // Convert session names to SessionWindow objects
      symbolRules.enabledSessions = accountFilter.sessionWindows.map(session => {
        // Map session names to hours (simplified)
        const sessionMap: Record<string, { startHour: number; endHour: number }> = {
          london: { startHour: 8, endHour: 16 },
          newyork: { startHour: 13, endHour: 21 },
          asian: { startHour: 0, endHour: 8 },
        };

        const hours = sessionMap[session.toLowerCase()] || { startHour: 0, endHour: 24 };
        return {
          label: session.charAt(0).toUpperCase() + session.slice(1),
          startHour: hours.startHour,
          endHour: hours.endHour,
        };
      });
    }

    return config;
  }
}

