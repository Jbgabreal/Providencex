/**
 * SimulatedRiskService - Simulates RiskService for backtesting
 * 
 * Provides the same interface as RiskService but tracks risk in memory
 * without external dependencies (guardrail, etc.)
 */

import { Logger } from '@providencex/shared-utils';
import { Strategy, RiskContext, RiskCheckResult } from '../types';

const logger = new Logger('SimRisk');

export interface SimulatedRiskConfig {
  initialBalance: number;
  lowRiskMaxDailyLoss?: number; // Percent of equity
  lowRiskMaxTrades?: number;
  highRiskMaxDailyLoss?: number;
  highRiskMaxTrades?: number;
  defaultLowRiskPerTrade?: number; // Percent
  defaultHighRiskPerTrade?: number; // Percent
}

/**
 * SimulatedRiskService - Replacement for RiskService in backtests
 */
export class SimulatedRiskService {
  private config: SimulatedRiskConfig;
  private dailyStats: Map<string, {
    date: string; // YYYY-MM-DD
    realizedPnL: number;
    tradesTaken: number;
    balance: number;
  }> = new Map();

  constructor(config: SimulatedRiskConfig) {
    this.config = {
      initialBalance: config.initialBalance,
      lowRiskMaxDailyLoss: config.lowRiskMaxDailyLoss ?? 1.0,
      lowRiskMaxTrades: config.lowRiskMaxTrades ?? 2,
      highRiskMaxDailyLoss: config.highRiskMaxDailyLoss ?? 3.0,
      highRiskMaxTrades: config.highRiskMaxTrades ?? 4,
      defaultLowRiskPerTrade: config.defaultLowRiskPerTrade ?? 0.5,
      defaultHighRiskPerTrade: config.defaultHighRiskPerTrade ?? 1.5,
    };
    logger.info('[SimRisk] Initialized with risk limits', this.config);
  }

  /**
   * Check if a new trade is allowed based on risk constraints
   */
  canTakeNewTrade(
    riskContext: RiskContext,
    currentBalance: number
  ): RiskCheckResult {
    const today = this.getTodayString();
    const stats = this.getDailyStats(today, currentBalance);

    const strategyConfig = riskContext.strategy === 'low'
      ? {
          maxDailyLoss: this.config.lowRiskMaxDailyLoss!,
          maxTrades: this.config.lowRiskMaxTrades!,
        }
      : {
          maxDailyLoss: this.config.highRiskMaxDailyLoss!,
          maxTrades: this.config.highRiskMaxTrades!,
        };

    // Check daily loss limit
    const maxDailyLossAmount = (currentBalance * strategyConfig.maxDailyLoss) / 100;
    if (stats.realizedPnL <= -maxDailyLossAmount) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${stats.realizedPnL.toFixed(2)} <= -${maxDailyLossAmount.toFixed(2)}`,
      };
    }

    // Check daily trade count
    if (stats.tradesTaken >= strategyConfig.maxTrades) {
      return {
        allowed: false,
        reason: `Max trades per day reached: ${stats.tradesTaken} >= ${strategyConfig.maxTrades}`,
      };
    }

    // Adjust risk based on guardrail mode (simulated)
    let adjustedRiskPercent = riskContext.strategy === 'low'
      ? this.config.defaultLowRiskPerTrade!
      : this.config.defaultHighRiskPerTrade!;

    if (riskContext.guardrail_mode === 'reduced') {
      adjustedRiskPercent = adjustedRiskPercent * 0.5; // Reduce risk by 50%
    } else if (riskContext.guardrail_mode === 'blocked') {
      return {
        allowed: false,
        reason: 'Trading blocked by guardrail mode',
      };
    }

    return {
      allowed: true,
      adjusted_risk_percent: adjustedRiskPercent,
    };
  }

  /**
   * Record a trade completion
   */
  recordTradeCompletion(
    date: string,
    pnl: number,
    currentBalance: number
  ): void {
    const stats = this.getDailyStats(date, currentBalance);
    stats.realizedPnL += pnl;
    stats.tradesTaken += 1;
    stats.balance = currentBalance;
  }

  /**
   * Get daily stats for a date
   */
  private getDailyStats(date: string, currentBalance: number): {
    date: string;
    realizedPnL: number;
    tradesTaken: number;
    balance: number;
  } {
    if (!this.dailyStats.has(date)) {
      this.dailyStats.set(date, {
        date,
        realizedPnL: 0,
        tradesTaken: 0,
        balance: currentBalance,
      });
    }
    return this.dailyStats.get(date)!;
  }

  /**
   * Get today's date string (YYYY-MM-DD)
   */
  private getTodayString(): string {
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  /**
   * Reset daily stats (for new backtest run)
   */
  reset(): void {
    this.dailyStats.clear();
    logger.info('[SimRisk] Reset daily stats');
  }

  /**
   * Get risk per trade in percent
   */
  getRiskPerTrade(strategy: Strategy, guardrailMode: string = 'normal'): number {
    let risk = strategy === 'low'
      ? this.config.defaultLowRiskPerTrade!
      : this.config.defaultHighRiskPerTrade!;

    if (guardrailMode === 'reduced') {
      risk = risk * 0.5;
    }

    return risk;
  }
}


