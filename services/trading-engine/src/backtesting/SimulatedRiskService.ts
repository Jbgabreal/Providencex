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
  maxDailyLossUsd?: number;        // Hard USD cap on daily loss (e.g., $200)
  maxDailyLossPct?: number;        // Percentage of balance cap on daily loss (e.g., 10%)
  maxConsecutiveLosses?: number;    // Stop trading after N consecutive losses in a day
  maxDailyLossingTrades?: number;  // Stop after N TOTAL losing trades in a day (regardless of wins between)
  maxConcurrentPositions?: number;  // Max open positions at same time (e.g., 1 for Silver Bullet)
}

/**
 * SimulatedRiskService - Replacement for RiskService in backtests
 */
export class SimulatedRiskService {
  private config: SimulatedRiskConfig;
  private openPositionCount: number = 0;
  private dailyStats: Map<string, {
    date: string; // YYYY-MM-DD
    realizedPnL: number;
    tradesTaken: number;
    balance: number;
    dayStartBalance: number;
    consecutiveLosses: number;
    totalLossingTrades: number; // Total losing trades today (never resets on win)
    dailyStopped: boolean;
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
      maxDailyLossUsd: config.maxDailyLossUsd,
      maxDailyLossPct: config.maxDailyLossPct,
      maxConsecutiveLosses: config.maxConsecutiveLosses,
      maxDailyLossingTrades: config.maxDailyLossingTrades,
      maxConcurrentPositions: config.maxConcurrentPositions,
    };
    logger.info('[SimRisk] Initialized with risk limits', this.config);
  }

  /**
   * Check if a new trade is allowed based on risk constraints
   */
  canTakeNewTrade(
    riskContext: RiskContext,
    currentBalance: number,
    candleDate?: string // YYYY-MM-DD from backtest candle (not system clock)
  ): RiskCheckResult {
    const today = candleDate || this.getTodayString();
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

    // Check if already stopped for the day (consecutive loss or hard limit)
    if (stats.dailyStopped) {
      return {
        allowed: false,
        reason: `Trading stopped for ${today} (daily limit reached)`,
      };
    }

    // Check concurrent position limit
    if (this.config.maxConcurrentPositions && this.openPositionCount >= this.config.maxConcurrentPositions) {
      return {
        allowed: false,
        reason: `Max concurrent positions reached: ${this.openPositionCount} >= ${this.config.maxConcurrentPositions}`,
      };
    }

    // Check total potential exposure: open positions * risk% + already lost must not exceed daily cap
    if (this.config.maxDailyLossPct) {
      const dayStartBal = stats.dayStartBalance;
      const maxLoss = (dayStartBal * this.config.maxDailyLossPct) / 100;
      const riskPerTrade = this.config.defaultLowRiskPerTrade || 10;
      const openExposure = this.openPositionCount * (dayStartBal * riskPerTrade) / 100;
      const totalPotentialLoss = Math.abs(stats.realizedPnL < 0 ? stats.realizedPnL : 0) + openExposure;
      if (totalPotentialLoss >= maxLoss) {
        return {
          allowed: false,
          reason: `Exposure cap: realized=$${Math.abs(stats.realizedPnL).toFixed(0)} + open=${this.openPositionCount}x${riskPerTrade}%=$${openExposure.toFixed(0)} = $${totalPotentialLoss.toFixed(0)} >= $${maxLoss.toFixed(0)} (${this.config.maxDailyLossPct}%)`,
        };
      }
    }

    // Check daily loss limit (percentage)
    const maxDailyLossAmount = (currentBalance * strategyConfig.maxDailyLoss) / 100;
    if (stats.realizedPnL <= -maxDailyLossAmount) {
      stats.dailyStopped = true;
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${stats.realizedPnL.toFixed(2)} <= -${maxDailyLossAmount.toFixed(2)}`,
      };
    }

    // Check hard USD daily loss cap
    if (this.config.maxDailyLossUsd && stats.realizedPnL <= -this.config.maxDailyLossUsd) {
      stats.dailyStopped = true;
      return {
        allowed: false,
        reason: `Daily USD loss cap reached: ${stats.realizedPnL.toFixed(2)} <= -$${this.config.maxDailyLossUsd}`,
      };
    }

    // Check percentage-of-balance daily loss cap (based on DAY START balance, not current)
    if (this.config.maxDailyLossPct) {
      const dayStartBalance = stats.dayStartBalance; // Locked at first access of the day
      const maxLossAmount = (dayStartBalance * this.config.maxDailyLossPct) / 100;
      if (stats.realizedPnL <= -maxLossAmount) {
        stats.dailyStopped = true;
        return {
          allowed: false,
          reason: `Daily ${this.config.maxDailyLossPct}% loss cap reached: ${stats.realizedPnL.toFixed(2)} <= -$${maxLossAmount.toFixed(2)} (${this.config.maxDailyLossPct}% of day start $${dayStartBalance.toFixed(2)})`,
        };
      }
    }

    // Check consecutive losses
    if (this.config.maxConsecutiveLosses && stats.consecutiveLosses >= this.config.maxConsecutiveLosses) {
      stats.dailyStopped = true;
      return {
        allowed: false,
        reason: `Max consecutive losses reached: ${stats.consecutiveLosses} >= ${this.config.maxConsecutiveLosses} — stopped for the day`,
      };
    }

    // Check total losing trades per day (hard cap — doesn't reset on wins)
    if (this.config.maxDailyLossingTrades && stats.totalLossingTrades >= this.config.maxDailyLossingTrades) {
      stats.dailyStopped = true;
      return {
        allowed: false,
        reason: `Max daily losing trades reached: ${stats.totalLossingTrades} >= ${this.config.maxDailyLossingTrades} — stopped for the day`,
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
  /** Called when a trade opens — track concurrent positions */
  recordTradeOpen(): void {
    this.openPositionCount++;
  }

  /** Called when a trade closes — update position count + daily stats */
  recordTradeCompletion(
    date: string,
    pnl: number,
    currentBalance: number
  ): void {
    this.openPositionCount = Math.max(0, this.openPositionCount - 1);
    const stats = this.getDailyStats(date, currentBalance);
    stats.realizedPnL += pnl;
    stats.tradesTaken += 1;
    stats.balance = currentBalance;

    // Track consecutive losses AND total losing trades
    if (pnl < 0) {
      stats.consecutiveLosses += 1;
      stats.totalLossingTrades += 1;
    } else {
      stats.consecutiveLosses = 0; // Reset consecutive on win (but total never resets)
    }
  }

  /**
   * Get daily stats for a date
   */
  private getDailyStats(date: string, currentBalance: number): {
    date: string;
    realizedPnL: number;
    tradesTaken: number;
    balance: number;
    dayStartBalance: number;
    consecutiveLosses: number;
    totalLossingTrades: number;
    dailyStopped: boolean;
  } {
    if (!this.dailyStats.has(date)) {
      this.dailyStats.set(date, {
        date,
        realizedPnL: 0,
        tradesTaken: 0,
        balance: currentBalance,
        dayStartBalance: currentBalance,
        consecutiveLosses: 0,
        totalLossingTrades: 0,
        dailyStopped: false,
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


