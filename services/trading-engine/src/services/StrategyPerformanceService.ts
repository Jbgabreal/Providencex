/**
 * StrategyPerformanceService
 * 
 * Aggregates performance statistics across all users for strategy profiles.
 * Used to display strategy performance in the catalog.
 */

import { Logger } from '@providencex/shared-utils';
import { TradeHistoryRepository, ExecutedTrade, DailyAccountMetric } from '../db/TradeHistoryRepository';
import { TenantRepository } from '../db/TenantRepository';

const logger = new Logger('StrategyPerformanceService');

export interface StrategyPerformance {
  total_users: number;
  total_trades: number;
  closed_trades: number;
  win_rate: number;
  profit_factor: number;
  total_pnl: number;
  avg_daily_return: number;
  max_drawdown_percent: number;
  average_win: number;
  average_loss: number;
  largest_win: number;
  largest_loss: number;
  average_r: number;
  last_30_days_return?: number;
  last_7_days_return?: number;
}

export interface PerformanceHistoryPoint {
  date: string;
  cumulative_return: number;
  daily_return: number;
  trades_count: number;
  win_rate: number;
  profit_factor: number;
}

export interface StrategyPerformanceHistory {
  strategy_key: string;
  period: string;
  data: PerformanceHistoryPoint[];
  summary: StrategyPerformance;
}

export class StrategyPerformanceService {
  constructor(
    private readonly tradeHistoryRepo: TradeHistoryRepository,
    private readonly tenantRepo: TenantRepository
  ) {}

  /**
   * Get aggregate performance for a strategy across all users
   */
  async getAggregatePerformance(strategyProfileKey: string): Promise<StrategyPerformance | null> {
    try {
      // Get strategy profile
      const profile = await this.tenantRepo.getStrategyProfileByKey(strategyProfileKey);
      if (!profile) {
        logger.warn(`[StrategyPerformanceService] Strategy profile not found: ${strategyProfileKey}`);
        return null;
      }

      // Get all trades for this strategy across all users
      // Handle case where repository might not be initialized (no DB)
      let trades: ExecutedTrade[] = [];
      let total = 0;
      
      try {
        const result = await this.tradeHistoryRepo.getTradesForStrategy({
          strategyProfileId: profile.id,
          includeOpen: false, // Only closed trades for stats
        });
        trades = result.trades;
        total = result.total;
      } catch (error) {
        // Database might not be available - return empty stats
        logger.warn(`[StrategyPerformanceService] Could not fetch trades for ${strategyProfileKey}, database may not be available`);
        return {
          total_users: 0,
          total_trades: 0,
          closed_trades: 0,
          win_rate: 0,
          profit_factor: 0,
          total_pnl: 0,
          avg_daily_return: 0,
          max_drawdown_percent: 0,
          average_win: 0,
          average_loss: 0,
          largest_win: 0,
          largest_loss: 0,
          average_r: 0,
        };
      }

      if (trades.length === 0) {
        // Return empty stats if no trades
        return {
          total_users: 0,
          total_trades: 0,
          closed_trades: 0,
          win_rate: 0,
          profit_factor: 0,
          total_pnl: 0,
          avg_daily_return: 0,
          max_drawdown_percent: 0,
          average_win: 0,
          average_loss: 0,
          largest_win: 0,
          largest_loss: 0,
          average_r: 0,
        };
      }

      // Filter closed trades with profit data
      const closedTrades = trades.filter(t => t.closed_at !== null && t.profit !== null);
      
      // Get unique user count
      const uniqueUsers = new Set(trades.map(t => t.user_id)).size;

      // Calculate basic stats
      const wins = closedTrades.filter(t => (t.profit || 0) > 0);
      const losses = closedTrades.filter(t => (t.profit || 0) < 0);
      const totalWins = wins.length;
      const totalLosses = losses.length;

      const winRate = closedTrades.length > 0 
        ? (totalWins / closedTrades.length) * 100 
        : 0;

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

      // Average R
      const averageR = averageLoss !== 0 ? averageWin / Math.abs(averageLoss) : 0;

      // Total PnL
      const totalPnL = closedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);

      // Calculate average daily return from daily metrics (with error handling)
      let avgDailyReturn = 0;
      let maxDrawdownPercent = 0;
      let last30DaysReturn: number | null = null;
      let last7DaysReturn: number | null = null;

      try {
        avgDailyReturn = await this.calculateAverageDailyReturn(profile.id);
        maxDrawdownPercent = await this.calculateMaxDrawdown(profile.id);
        last30DaysReturn = await this.calculatePeriodReturn(profile.id, 30);
        last7DaysReturn = await this.calculatePeriodReturn(profile.id, 7);
      } catch (error) {
        logger.warn(`[StrategyPerformanceService] Error calculating metrics for ${strategyProfileKey}:`, error);
        // Continue with default values
      }

      return {
        total_users: uniqueUsers,
        total_trades: trades.length,
        closed_trades: closedTrades.length,
        win_rate: Math.round(winRate * 100) / 100,
        profit_factor: Math.round(profitFactor * 100) / 100,
        total_pnl: Math.round(totalPnL * 100) / 100,
        avg_daily_return: Math.round(avgDailyReturn * 100) / 100,
        max_drawdown_percent: Math.round(maxDrawdownPercent * 100) / 100,
        average_win: Math.round(averageWin * 100) / 100,
        average_loss: Math.round(averageLoss * 100) / 100,
        largest_win: Math.round(largestWin * 100) / 100,
        largest_loss: Math.round(largestLoss * 100) / 100,
        average_r: Math.round(averageR * 100) / 100,
        last_30_days_return: last30DaysReturn !== null ? Math.round(last30DaysReturn * 100) / 100 : undefined,
        last_7_days_return: last7DaysReturn !== null ? Math.round(last7DaysReturn * 100) / 100 : undefined,
      };
    } catch (error) {
      logger.error(`[StrategyPerformanceService] Error getting aggregate performance for ${strategyProfileKey}:`, error);
      return null;
    }
  }

  /**
   * Get performance history (time series) for a strategy
   */
  async getPerformanceHistory(
    strategyProfileKey: string,
    period: '7d' | '30d' | '90d' | 'all' = '30d'
  ): Promise<StrategyPerformanceHistory | null> {
    try {
      const profile = await this.tenantRepo.getStrategyProfileByKey(strategyProfileKey);
      if (!profile) {
        return null;
      }

      // Calculate date range
      const now = new Date();
      let fromDate: string | undefined;
      
      if (period === '7d') {
        const date = new Date(now);
        date.setDate(date.getDate() - 7);
        fromDate = date.toISOString().split('T')[0];
      } else if (period === '30d') {
        const date = new Date(now);
        date.setDate(date.getDate() - 30);
        fromDate = date.toISOString().split('T')[0];
      } else if (period === '90d') {
        const date = new Date(now);
        date.setDate(date.getDate() - 90);
        fromDate = date.toISOString().split('T')[0];
      }
      // 'all' means no date filter

      // Get daily metrics for this strategy across all users
      const metrics = await this.tradeHistoryRepo.getDailyMetricsForStrategy({
        strategyProfileId: profile.id,
        fromDate,
      });

      if (metrics.length === 0) {
        // Return empty history
        const summary = await this.getAggregatePerformance(strategyProfileKey);
        return {
          strategy_key: strategyProfileKey,
          period,
          data: [],
          summary: summary || {
            total_users: 0,
            total_trades: 0,
            closed_trades: 0,
            win_rate: 0,
            profit_factor: 0,
            total_pnl: 0,
            avg_daily_return: 0,
            max_drawdown_percent: 0,
            average_win: 0,
            average_loss: 0,
            largest_win: 0,
            largest_loss: 0,
            average_r: 0,
          },
        };
      }

      // Aggregate metrics by date (sum across all users/accounts)
      const metricsByDate = new Map<string, {
        totalPnL: number;
        tradesCount: number;
        wins: number;
        losses: number;
        grossProfit: number;
        grossLoss: number;
      }>();

      for (const metric of metrics) {
        const date = metric.date;
        const existing = metricsByDate.get(date) || {
          totalPnL: 0,
          tradesCount: 0,
          wins: 0,
          losses: 0,
          grossProfit: 0,
          grossLoss: 0,
        };

        existing.totalPnL += parseFloat(metric.total_pnl.toString());
        existing.tradesCount += metric.trades_closed;
        existing.wins += metric.trades_won;
        existing.losses += metric.trades_lost;
        existing.grossProfit += (metric.average_win || 0) * (metric.trades_won || 0);
        existing.grossLoss += Math.abs((metric.average_loss || 0) * (metric.trades_lost || 0));

        metricsByDate.set(date, existing);
      }

      // Build time series data
      const sortedDates = Array.from(metricsByDate.keys()).sort();
      let cumulativeReturn = 0;
      const data: PerformanceHistoryPoint[] = [];

      for (const date of sortedDates) {
        const dayData = metricsByDate.get(date)!;
        const dailyReturn = dayData.totalPnL;
        cumulativeReturn += dailyReturn;

        const winRate = dayData.tradesCount > 0 
          ? (dayData.wins / dayData.tradesCount) * 100 
          : 0;
        
        const profitFactor = dayData.grossLoss > 0 
          ? dayData.grossProfit / dayData.grossLoss 
          : dayData.grossProfit > 0 ? Infinity : 0;

        data.push({
          date,
          cumulative_return: Math.round(cumulativeReturn * 100) / 100,
          daily_return: Math.round(dailyReturn * 100) / 100,
          trades_count: dayData.tradesCount,
          win_rate: Math.round(winRate * 100) / 100,
          profit_factor: Math.round(profitFactor * 100) / 100,
        });
      }

      // Get summary
      const summary = await this.getAggregatePerformance(strategyProfileKey);

      return {
        strategy_key: strategyProfileKey,
        period,
        data,
        summary: summary || {
          total_users: 0,
          total_trades: 0,
          closed_trades: 0,
          win_rate: 0,
          profit_factor: 0,
          total_pnl: 0,
          avg_daily_return: 0,
          max_drawdown_percent: 0,
          average_win: 0,
          average_loss: 0,
          largest_win: 0,
          largest_loss: 0,
          average_r: 0,
        },
      };
    } catch (error) {
      logger.error(`[StrategyPerformanceService] Error getting performance history for ${strategyProfileKey}:`, error);
      return null;
    }
  }

  /**
   * Calculate average daily return from daily metrics
   */
  private async calculateAverageDailyReturn(strategyProfileId: string): Promise<number> {
    try {
      const metrics = await this.tradeHistoryRepo.getDailyMetricsForStrategy({
        strategyProfileId,
        fromDate: undefined, // Get all
      });

      if (metrics.length === 0) return 0;

      // Calculate average daily return across all accounts/users
      const totalReturn = metrics.reduce((sum, m) => {
        return sum + parseFloat(m.total_pnl.toString());
      }, 0);

      return totalReturn / metrics.length;
    } catch (error) {
      logger.warn('[StrategyPerformanceService] Error calculating average daily return:', error);
      return 0;
    }
  }

  /**
   * Calculate max drawdown from daily metrics
   */
  private async calculateMaxDrawdown(strategyProfileId: string): Promise<number> {
    try {
      const metrics = await this.tradeHistoryRepo.getDailyMetricsForStrategy({
        strategyProfileId,
        fromDate: undefined,
      });

      if (metrics.length === 0) return 0;

      // Find max drawdown percent across all metrics
      const maxDD = metrics.reduce((max, m) => {
        const dd = parseFloat(m.max_drawdown_percent.toString());
        return dd > max ? dd : max;
      }, 0);

      return maxDD;
    } catch (error) {
      logger.warn('[StrategyPerformanceService] Error calculating max drawdown:', error);
      return 0;
    }
  }

  /**
   * Calculate return for a specific period (in days)
   */
  private async calculatePeriodReturn(strategyProfileId: string, days: number): Promise<number | null> {
    try {
      const now = new Date();
      const fromDate = new Date(now);
      fromDate.setDate(fromDate.getDate() - days);
      const fromDateStr = fromDate.toISOString().split('T')[0];

      const metrics = await this.tradeHistoryRepo.getDailyMetricsForStrategy({
        strategyProfileId,
        fromDate: fromDateStr,
      });

      if (metrics.length === 0) return null;

      const totalReturn = metrics.reduce((sum, m) => {
        return sum + parseFloat(m.total_pnl.toString());
      }, 0);

      return totalReturn;
    } catch (error) {
      logger.warn(`[StrategyPerformanceService] Error calculating ${days}-day return:`, error);
      return null;
    }
  }
}

