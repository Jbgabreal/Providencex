/**
 * Optimization Utilities (Trading Engine v11)
 * 
 * Helper functions for optimization
 */

import { BacktestResult, BacktestTrade, EquityPoint as BacktestEquityPoint } from '../backtesting/types';
import { OptimizationMetrics, OptimizationTrade, EquityPoint } from './OptimizationTypes';

/**
 * Convert BacktestResult to OptimizationMetrics
 */
export function convertBacktestToMetrics(backtestResult: BacktestResult): OptimizationMetrics {
  const { stats, trades, equityCurve, initialBalance } = backtestResult;

  // Calculate Sharpe Ratio (simplified - annualized)
  const sharpeRatio = calculateSharpeRatio(equityCurve);

  // Calculate Sortino Ratio
  const sortinoRatio = calculateSortinoRatio(equityCurve);

  // Calculate losing streak statistics
  const losingStreaks = calculateLosingStreaks(trades);
  
  // Calculate recovery factor
  const recoveryFactor = stats.maxDrawdown > 0 
    ? stats.totalPnL / stats.maxDrawdown 
    : 0;

  // Calculate trade frequency (trades per month approximation)
  const daysDiff = (new Date(backtestResult.config.endDate).getTime() - 
                    new Date(backtestResult.config.startDate).getTime()) / (1000 * 60 * 60 * 24);
  const months = daysDiff / 30;
  const tradeFrequency = months > 0 ? stats.totalTrades / months : 0;

  return {
    // Profitability
    winRate: stats.winRate / 100, // Convert from percentage to 0-1
    totalNetProfit: stats.totalPnL,
    profitFactor: stats.profitFactor,
    expectancy: stats.expectancy,
    avgWinner: stats.averageWin,
    avgLoser: Math.abs(stats.averageLoss), // Make positive
    maxDrawdown: stats.maxDrawdown,
    maxDrawdownPct: stats.maxDrawdownPercent,
    recoveryFactor,
    
    // Stability
    sharpeRatio,
    sortinoRatio,
    tradeFrequency,
    losingStreakMax: losingStreaks.max,
    losingStreakAvg: losingStreaks.avg,
    
    // Robustness (filled by walk-forward)
    outOfSampleWinRate: undefined,
    outOfSampleProfitFactor: undefined,
    parameterStability: undefined,
    sensitivityScore: undefined,
  };
}

/**
 * Convert BacktestTrade[] to OptimizationTrade[]
 */
export function convertBacktestTrades(trades: BacktestTrade[]): OptimizationTrade[] {
  return trades.map(trade => ({
    entryDate: new Date(trade.entryTime).toISOString(),
    exitDate: new Date(trade.exitTime).toISOString(),
    direction: trade.direction,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    stopLoss: trade.sl || trade.entryPrice,
    takeProfit: trade.tp || trade.entryPrice,
    profit: trade.profit,
    profitPct: (trade.profit / trade.entryPrice) * 100, // Simplified percentage
    win: trade.profit > 0,
  }));
}

/**
 * Convert BacktestEquityPoint[] to EquityPoint[]
 */
export function convertEquityCurve(equityCurve: BacktestEquityPoint[]): EquityPoint[] {
  return equityCurve.map(point => ({
    date: new Date(point.timestamp).toISOString(),
    equity: point.equity,
    drawdown: point.drawdown,
    drawdownPct: point.drawdownPercent,
  }));
}

/**
 * Calculate Sharpe Ratio from equity curve
 */
function calculateSharpeRatio(equityCurve: BacktestEquityPoint[]): number {
  if (equityCurve.length < 2) return 0;

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEquity = equityCurve[i - 1].equity;
    const currEquity = equityCurve[i].equity;
    if (prevEquity > 0) {
      returns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  if (returns.length === 0) return 0;

  // Calculate mean return
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate standard deviation
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize (assume daily returns, multiply by sqrt(252))
  const annualizedReturn = meanReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);

  return annualizedStdDev > 0 ? annualizedReturn / annualizedStdDev : 0;
}

/**
 * Calculate Sortino Ratio from equity curve (uses downside deviation)
 */
function calculateSortinoRatio(equityCurve: BacktestEquityPoint[]): number {
  if (equityCurve.length < 2) return 0;

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prevEquity = equityCurve[i - 1].equity;
    const currEquity = equityCurve[i].equity;
    if (prevEquity > 0) {
      returns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  if (returns.length === 0) return 0;

  // Calculate mean return
  const meanReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;

  // Calculate downside deviation (only negative returns)
  const downsideReturns = returns.filter(r => r < 0);
  if (downsideReturns.length === 0) return meanReturn > 0 ? 100 : 0; // No downside

  const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / downsideReturns.length;
  const downsideStdDev = Math.sqrt(downsideVariance);

  if (downsideStdDev === 0) return meanReturn > 0 ? 100 : 0;

  // Annualize
  const annualizedReturn = meanReturn * 252;
  const annualizedDownsideStdDev = downsideStdDev * Math.sqrt(252);

  return annualizedDownsideStdDev > 0 ? annualizedReturn / annualizedDownsideStdDev : 0;
}

/**
 * Calculate losing streak statistics
 */
function calculateLosingStreaks(trades: BacktestTrade[]): { max: number; avg: number } {
  if (trades.length === 0) return { max: 0, avg: 0 };

  const streaks: number[] = [];
  let currentStreak = 0;

  for (const trade of trades) {
    if (trade.profit <= 0) {
      currentStreak++;
    } else {
      if (currentStreak > 0) {
        streaks.push(currentStreak);
        currentStreak = 0;
      }
    }
  }

  // Add final streak if ended with losses
  if (currentStreak > 0) {
    streaks.push(currentStreak);
  }

  if (streaks.length === 0) return { max: 0, avg: 0 };

  const max = Math.max(...streaks);
  const avg = streaks.reduce((sum, s) => sum + s, 0) / streaks.length;

  return { max, avg };
}

/**
 * Calculate ranked score for optimization result (composite metric)
 */
export function calculateRankedScore(
  metrics: OptimizationMetrics,
  weights: {
    winRate?: number;
    profitFactor?: number;
    sharpeRatio?: number;
    maxDrawdown?: number;
    stability?: number;
  } = {}
): number {
  const defaultWeights = {
    winRate: 0.25,
    profitFactor: 0.30,
    sharpeRatio: 0.25,
    maxDrawdown: 0.10,
    stability: 0.10,
  };

  const w = { ...defaultWeights, ...weights };

  // Normalize metrics to 0-1 scale
  const normalizedWinRate = Math.min(metrics.winRate, 1.0); // Already 0-1
  const normalizedProfitFactor = Math.min(metrics.profitFactor / 5.0, 1.0); // Cap at 5.0
  const normalizedSharpe = Math.min((metrics.sharpeRatio + 2) / 4, 1.0); // -2 to 2 -> 0 to 1
  const normalizedDrawdown = Math.max(0, 1 - metrics.maxDrawdownPct / 50); // 0% = 1.0, 50%+ = 0
  const normalizedStability = metrics.losingStreakMax > 0 
    ? Math.max(0, 1 - metrics.losingStreakMax / 10) // 0 streaks = 1.0, 10+ = 0
    : 1.0;

  // Weighted sum
  const score = 
    normalizedWinRate * (w.winRate || 0) +
    normalizedProfitFactor * (w.profitFactor || 0) +
    normalizedSharpe * (w.sharpeRatio || 0) +
    normalizedDrawdown * (w.maxDrawdown || 0) +
    normalizedStability * (w.stability || 0);

  return score;
}

