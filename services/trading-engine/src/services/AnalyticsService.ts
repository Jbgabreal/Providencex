import { Logger } from '@providencex/shared-utils';
import { TradeHistoryRepository, ExecutedTrade, DailyAccountMetric } from '../db/TradeHistoryRepository';

const logger = new Logger('AnalyticsService');

export interface TradeSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  totalPnL: number;
  realizedPnL: number;
  unrealizedPnL: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  averageR: number;
  totalWins: number;
  totalLosses: number;
}

export interface AccountSummary {
  mt5AccountId: string;
  strategyProfileId: string;
  summary: TradeSummary;
  equityCurve: Array<{ date: string; equity: number; balance: number }>;
}

/**
 * AnalyticsService
 *
 * Computes statistics and summaries from trade history
 */
export class AnalyticsService {
  constructor(private readonly tradeHistoryRepo: TradeHistoryRepository) {}

  /**
   * Compute summary statistics for a user's trades
   */
  async computeSummary(params: {
    userId: string;
    mt5AccountId?: string;
    strategyProfileId?: string;
  }): Promise<TradeSummary> {
    const { trades } = await this.tradeHistoryRepo.getTradesForUser({
      userId: params.userId,
      mt5AccountId: params.mt5AccountId,
      strategyProfileId: params.strategyProfileId,
      includeOpen: true,
    });

    const closedTrades = trades.filter(t => t.closed_at !== null && t.profit !== null);
    const openTrades = trades.filter(t => t.closed_at === null);

    const totalTrades = trades.length;
    const totalClosed = closedTrades.length;

    // Realized PnL (from closed trades)
    const realizedPnL = closedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);

    // Unrealized PnL (estimate from open trades - would need current price from MT5)
    // For now, we'll set to 0 and let the frontend compute it from live positions
    const unrealizedPnL = 0;

    const totalPnL = realizedPnL + unrealizedPnL;

    // Win/Loss stats
    const wins = closedTrades.filter(t => (t.profit || 0) > 0);
    const losses = closedTrades.filter(t => (t.profit || 0) < 0);
    const totalWins = wins.length;
    const totalLosses = losses.length;

    const winRate = totalClosed > 0 ? (totalWins / totalClosed) * 100 : 0;

    // Profit factor
    const grossProfit = wins.reduce((sum, t) => sum + (t.profit || 0), 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profit || 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Average win/loss
    const averageWin = totalWins > 0 ? grossProfit / totalWins : 0;
    const averageLoss = totalLosses > 0 ? grossLoss / totalLosses : 0;

    // Largest win/loss
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profit || 0)) : 0;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profit || 0)) : 0;

    // Average R (risk-reward ratio)
    // For each closed trade, compute R = profit / risk (where risk = |entry - SL| * lot_size * pip_value)
    // Simplified: assume risk is the absolute value of the largest loss for now
    // In production, compute actual risk per trade from entry/SL
    const averageR = averageLoss !== 0 ? averageWin / Math.abs(averageLoss) : 0;

    // Max drawdown (simplified - would need equity curve)
    // For now, compute from largest loss
    const maxDrawdown = Math.abs(largestLoss);
    const maxDrawdownPercent = 0; // Would need equity curve to compute properly

    return {
      totalTrades,
      openTrades: openTrades.length,
      closedTrades: totalClosed,
      totalPnL,
      realizedPnL,
      unrealizedPnL,
      winRate: Math.round(winRate * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxDrawdown,
      maxDrawdownPercent,
      averageWin: Math.round(averageWin * 100) / 100,
      averageLoss: Math.round(averageLoss * 100) / 100,
      largestWin: Math.round(largestWin * 100) / 100,
      largestLoss: Math.round(largestLoss * 100) / 100,
      averageR: Math.round(averageR * 100) / 100,
      totalWins,
      totalLosses,
    };
  }

  /**
   * Get equity curve from daily metrics
   */
  async getEquityCurve(params: {
    userId: string;
    mt5AccountId?: string;
    strategyProfileId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<Array<{ date: string; equity: number; balance: number }>> {
    const metrics = await this.tradeHistoryRepo.getDailyMetrics({
      userId: params.userId,
      mt5AccountId: params.mt5AccountId,
      strategyProfileId: params.strategyProfileId,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });

    return metrics.map(m => ({
      date: m.date,
      equity: parseFloat(m.equity_end.toString()),
      balance: parseFloat(m.balance_end.toString()),
    }));
  }

  /**
   * Compute and upsert daily metrics for a given date
   * This should be called daily (via cron or scheduled job)
   */
  async computeAndUpsertDailyMetric(params: {
    date: string; // YYYY-MM-DD
    userId: string;
    mt5AccountId: string;
    strategyProfileId: string;
    assignmentId?: string;
    balanceStart: number;
    balanceEnd: number;
    equityStart: number;
    equityEnd: number;
  }): Promise<DailyAccountMetric> {
    // Get all trades for this account+strategy on this date
    const { trades } = await this.tradeHistoryRepo.getTradesForUser({
      userId: params.userId,
      mt5AccountId: params.mt5AccountId,
      strategyProfileId: params.strategyProfileId,
      includeOpen: true,
    });

    // Filter trades opened on this date
    const dateStr = params.date;
    const tradesOpened = trades.filter(t => t.opened_at.startsWith(dateStr));
    const tradesClosed = trades.filter(
      t => t.closed_at && t.closed_at.startsWith(dateStr)
    );

    const closedTrades = trades.filter(
      t => t.closed_at !== null && t.profit !== null
    );
    const wins = closedTrades.filter(t => (t.profit || 0) > 0);
    const losses = closedTrades.filter(t => (t.profit || 0) < 0);

    const realizedPnL = closedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);
    const unrealizedPnL = params.equityEnd - params.balanceEnd; // Simplified
    const totalPnL = realizedPnL + unrealizedPnL;

    const tradesWon = wins.length;
    const tradesLost = losses.length;
    const winRate = closedTrades.length > 0 ? (tradesWon / closedTrades.length) * 100 : null;

    const grossProfit = wins.reduce((sum, t) => sum + (t.profit || 0), 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + (t.profit || 0), 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null;

    const averageWin = tradesWon > 0 ? grossProfit / tradesWon : null;
    const averageLoss = tradesLost > 0 ? grossLoss / tradesLost : null;
    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => t.profit || 0)) : null;
    const largestLoss = losses.length > 0 ? Math.min(...losses.map(t => t.profit || 0)) : null;
    const averageR = averageLoss !== 0 && averageLoss !== null ? (averageWin || 0) / Math.abs(averageLoss) : null;

    // Max drawdown (simplified - would need intraday equity curve)
    const maxDrawdown = Math.abs(largestLoss || 0);
    const maxDrawdownPercent =
      params.equityStart > 0 ? (maxDrawdown / params.equityStart) * 100 : 0;

    return await this.tradeHistoryRepo.upsertDailyMetric({
      date: params.date,
      userId: params.userId,
      mt5AccountId: params.mt5AccountId,
      strategyProfileId: params.strategyProfileId,
      assignmentId: params.assignmentId,
      balanceStart: params.balanceStart,
      balanceEnd: params.balanceEnd,
      equityStart: params.equityStart,
      equityEnd: params.equityEnd,
      realizedPnL,
      unrealizedPnL,
      totalPnL,
      tradesOpened: tradesOpened.length,
      tradesClosed: tradesClosed.length,
      tradesWon,
      tradesLost,
      maxDrawdown,
      maxDrawdownPercent,
      winRate: winRate ? Math.round(winRate * 100) / 100 : undefined,
      profitFactor: profitFactor ? Math.round(profitFactor * 100) / 100 : undefined,
      averageWin: averageWin ? Math.round(averageWin * 100) / 100 : undefined,
      averageLoss: averageLoss ? Math.round(averageLoss * 100) / 100 : undefined,
      largestWin: largestWin ? Math.round(largestWin * 100) / 100 : undefined,
      largestLoss: largestLoss ? Math.round(largestLoss * 100) / 100 : undefined,
      averageR: averageR ? Math.round(averageR * 100) / 100 : undefined,
    });
  }
}

