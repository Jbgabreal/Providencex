import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import { RiskContext, RiskCheckResult, Strategy, GuardrailMode } from '../types';

const logger = new Logger('RiskService');

/**
 * RiskService - Enforces risk constraints per strategy
 * Handles daily limits, position sizing, and guardrail-aware risk adjustments
 */
export class RiskService {
  private config = getConfig();

  /**
   * Check if a new trade can be taken based on risk constraints
   */
  canTakeNewTrade(context: RiskContext): RiskCheckResult {
    const { strategy, account_equity, today_realized_pnl, trades_taken_today, guardrail_mode } = context;

    // Get strategy-specific limits
    const limits = this.getStrategyLimits(strategy);

    // Check daily loss limit
    const maxDailyLoss = (limits.maxDailyLossPercent / 100) * account_equity;
    if (today_realized_pnl <= -maxDailyLoss) {
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${today_realized_pnl.toFixed(2)} <= ${-maxDailyLoss.toFixed(2)} (${limits.maxDailyLossPercent}% of equity)`,
      };
    }

    // Check max trades per day
    if (trades_taken_today >= limits.maxTrades) {
      return {
        allowed: false,
        reason: `Max trades per day reached: ${trades_taken_today}/${limits.maxTrades}`,
      };
    }

    // If blocked mode, don't allow trades
    if (guardrail_mode === 'blocked') {
      return {
        allowed: false,
        reason: 'Guardrail mode is blocked - no trades allowed',
      };
    }

    // All checks passed
    return {
      allowed: true,
      adjusted_risk_percent: this.getAdjustedRiskPercent(strategy, guardrail_mode, context.symbol),
    };
  }

  /**
   * Calculate position size (lot size) based on risk
   */
  getPositionSize(context: RiskContext, stopLossPips: number, currentPrice: number): number {
    const { strategy, account_equity, guardrail_mode, symbol } = context;

    // Get adjusted risk percent based on guardrail mode and symbol override
    const riskPercent = this.getAdjustedRiskPercent(strategy, guardrail_mode, symbol);
    const riskAmount = (riskPercent / 100) * account_equity;

    // Calculate lot size based on stop loss distance
    // Formula: lot_size = risk_amount / (stop_loss_distance * pip_value * contract_size)
    // Simplified for v1 - assumes standard contract sizes
    
    const lotSize = this.calculateLotSize(context.strategy, riskAmount, stopLossPips, currentPrice);

    // Round to 2 decimal places (0.01 minimum)
    const roundedLotSize = Math.max(0.01, Math.round(lotSize * 100) / 100);

    logger.debug(
      `Position size calculation: risk_percent=${riskPercent}%, risk_amount=${riskAmount.toFixed(2)}, stop_loss_pips=${stopLossPips}, lot_size=${roundedLotSize}`
    );

    return roundedLotSize;
  }

  /**
   * Get adjusted risk percent based on guardrail mode and symbol
   */
  private getAdjustedRiskPercent(strategy: Strategy, guardrailMode: GuardrailMode, symbol?: string): number {
    // Check for per-symbol override first
    let baseRisk: number;
    if (symbol && this.config.perSymbolRiskOverrides && this.config.perSymbolRiskOverrides[symbol.toUpperCase()]) {
      baseRisk = this.config.perSymbolRiskOverrides[symbol.toUpperCase()];
      logger.debug(`[RiskService] Using per-symbol risk override for ${symbol}: ${baseRisk}%`);
    } else {
      baseRisk = strategy === 'low'
        ? this.config.defaultLowRiskPerTrade
        : this.config.defaultHighRiskPerTrade;
    }

    // In reduced mode, cut risk in half
    if (guardrailMode === 'reduced') {
      return baseRisk * 0.5;
    }

    return baseRisk;
  }

  /**
   * Get strategy-specific limits
   */
  private getStrategyLimits(strategy: Strategy): {
    maxDailyLossPercent: number;
    maxTrades: number;
    maxRiskPerTrade: number;
  } {
    if (strategy === 'low') {
      return {
        maxDailyLossPercent: this.config.lowRiskMaxDailyLoss,
        maxTrades: this.config.lowRiskMaxTrades,
        maxRiskPerTrade: this.config.defaultLowRiskPerTrade,
      };
    } else {
      return {
        maxDailyLossPercent: this.config.highRiskMaxDailyLoss,
        maxTrades: this.config.highRiskMaxTrades,
        maxRiskPerTrade: this.config.defaultHighRiskPerTrade,
      };
    }
  }

  /**
   * Calculate lot size based on risk amount and stop loss
   * Simplified calculation for v1 with realistic constraints
   */
  private calculateLotSize(
    strategy: Strategy,
    riskAmount: number,
    stopLossPips: number,
    currentPrice: number
  ): number {
    // For forex pairs (EURUSD, GBPUSD): 1 pip = 0.0001, standard lot = 100,000 units
    // For XAUUSD: 1 pip = 0.1, standard lot = 100 oz
    // For US30: 1 point = 1.0, standard lot varies by broker (typically $5-10 per point)

    // Simplified: Assume we're trading standard lots
    // Risk amount = (lot_size * stop_loss_pips * pip_value * contract_size)
    // Solving for lot_size: lot_size = risk_amount / (stop_loss_pips * pip_value * contract_size)

    // For now, use a simplified approximation
    // In production, this should use actual broker pip values and contract sizes
    
    if (stopLossPips <= 0 || stopLossPips < 1) {
      // If stop loss is too small, use minimum lot size
      return 0.01;
    }

    // Ensure stop loss pips is reasonable (at least 1 pip, max 500 pips)
    const clampedStopLossPips = Math.max(1, Math.min(500, stopLossPips));

    // Rough approximation: assume $10 per pip per standard lot for forex/gold
    const pipValue = 10; // USD per pip per standard lot (simplified)
    const lotSize = riskAmount / (clampedStopLossPips * pipValue);

    // Apply realistic lot size constraints for v1:
    // - Minimum: 0.01 lots
    // - Maximum: 0.10 lots (safety cap for testing)
    const MAX_TEST_LOT_SIZE = 0.10;
    const minLotSize = 0.01;
    
    const clampedLotSize = Math.max(minLotSize, Math.min(MAX_TEST_LOT_SIZE, lotSize));

    return clampedLotSize;
  }

  /**
   * Check if spread is acceptable
   */
  isSpreadAcceptable(symbol: string, currentSpread: number): boolean {
    const maxSpread = this.config.maxSpread;
    const acceptable = currentSpread <= maxSpread;
    
    if (!acceptable) {
      logger.warn(`Spread too wide for ${symbol}: ${currentSpread} > ${maxSpread}`);
    }
    
    return acceptable;
  }
}
