/**
 * CopyTradingRiskService — calculates lot sizes for copied trades.
 * Pure logic, no external dependencies.
 */

import type { RiskMode } from './types';

export interface LotSizeResult {
  lotSize: number;
  totalLots: number;
  tpCount: number;
}

export class CopyTradingRiskService {
  /**
   * Calculate lot size per TP child trade.
   *
   * @param riskMode     'percentage' | 'usd' | 'fixed_lot'
   * @param riskAmount   the value (% of balance, USD amount, or fixed lot)
   * @param entryPrice   signal entry price
   * @param stopLoss     signal stop loss
   * @param accountEquity follower's account equity
   * @param tpCount      number of TP levels selected (lots split evenly)
   * @param symbol       trading symbol (for pip value calculation)
   */
  calculateLotSizePerTp(
    riskMode: RiskMode,
    riskAmount: number,
    entryPrice: number,
    stopLoss: number,
    accountEquity: number,
    tpCount: number,
    symbol: string
  ): LotSizeResult {
    let totalLots: number;

    switch (riskMode) {
      case 'fixed_lot':
        totalLots = riskAmount;
        break;

      case 'usd': {
        const slDistanceUsd = Math.abs(entryPrice - stopLoss);
        const pipValue = this.getPipValue(symbol, entryPrice);
        const slPips = slDistanceUsd / pipValue;
        // risk_amount USD / (SL pips * pip value per lot)
        const pipValuePerLot = pipValue * 100000; // standard lot
        totalLots = slPips > 0 ? riskAmount / (slPips * pipValuePerLot / 100000) : 0.01;
        break;
      }

      case 'percentage':
      default: {
        const riskUsd = (riskAmount / 100) * accountEquity;
        const slDistanceUsd = Math.abs(entryPrice - stopLoss);
        const pipValue = this.getPipValue(symbol, entryPrice);
        const slPips = slDistanceUsd / pipValue;
        const pipValuePerLot = pipValue * 100000;
        totalLots = slPips > 0 ? riskUsd / (slPips * pipValuePerLot / 100000) : 0.01;
        break;
      }
    }

    // Split across TP levels
    const perTpLots = tpCount > 0 ? totalLots / tpCount : totalLots;

    // Clamp to broker constraints
    const clamped = Math.max(0.01, Math.min(10.0, Math.round(perTpLots * 100) / 100));

    return {
      lotSize: clamped,
      totalLots: Math.round(totalLots * 100) / 100,
      tpCount,
    };
  }

  private getPipValue(symbol: string, price: number): number {
    symbol = symbol.toUpperCase();
    if (symbol === 'XAUUSD' || symbol === 'GOLD') return 0.01;
    if (symbol.includes('JPY')) return 0.01;
    if (symbol === 'US30' || symbol === 'US100' || symbol === 'US500') return 1.0;
    return 0.0001; // Standard forex
  }
}
