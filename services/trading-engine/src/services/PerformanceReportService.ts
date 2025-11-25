/**
 * PerformanceReportService
 * 
 * Generates comprehensive performance reports including:
 * - Setup performance (traded vs skipped)
 * - Trade outcomes (won/lost/break-even)
 * - Reasons setups were not traded
 * - Entry and exit points
 * - False negatives analysis (blocked trades that would have been profitable)
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import { getNowInPXTimezone } from '@providencex/shared-utils';

const logger = new Logger('PerformanceReportService');

export interface SetupAnalysis {
  totalSetups: number;
  tradedSetups: number;
  skippedSetups: number;
  skippedByReason: Record<string, number>;
  skippedDetails: Array<{
    timestamp: string;
    symbol: string;
    strategy: string;
    reason: string;
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
    direction?: string;
  }>;
}

export interface TradeOutcome {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakEvenTrades: number;
  totalPnL: number;
  grossProfit: number;
  grossLoss: number;
  averageWin: number;
  averageLoss: number;
  winRate: number;
  profitFactor: number;
  trades: Array<{
    ticket: string;
    symbol: string;
    strategy: string;
    direction: string;
    entryPrice: number;
    exitPrice: number;
    stopLoss: number;
    takeProfit: number;
    entryTime: string;
    exitTime: string;
    profit: number;
    outcome: 'win' | 'loss' | 'breakeven';
    closedReason?: string;
  }>;
}

export interface FalseNegative {
  decisionId: number;
  timestamp: string;
  symbol: string;
  strategy: string;
  skipReason: string;
  plannedEntry: number;
  plannedStopLoss: number;
  plannedTakeProfit: number;
  direction: string;
  wouldHaveHitTP: boolean;
  wouldHaveHitSL: boolean;
  maxFavorableMove: number;
  maxAdverseMove: number;
  potentialPnL: number; // Estimated PnL if trade was taken
}

export interface PerformanceReport {
  reportId: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  setupAnalysis: SetupAnalysis;
  tradeOutcomes: TradeOutcome;
  falseNegatives: FalseNegative[];
  summary: {
    totalSetupsFound: number;
    setupsTraded: number;
    setupsSkipped: number;
    skipRate: number;
    totalTrades: number;
    winRate: number;
    totalPnL: number;
    falseNegativesCount: number;
    falseNegativesPotentialPnL: number;
  };
}

export class PerformanceReportService {
  private pool: Pool | null = null;
  private useDatabase: boolean = false;

  constructor() {
    const config = getConfig();
    if (config.databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: config.databaseUrl,
          ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        this.pool.on('error', (err) => {
          logger.error('[PerformanceReportService] Database pool error (non-fatal):', err);
        });
        
        this.useDatabase = true;
        this.ensureSchema();
        logger.info('[PerformanceReportService] Connected to Postgres for performance reports');
      } catch (error) {
        logger.warn('[PerformanceReportService] Database connection failed, reports will not be persisted', error);
        this.useDatabase = false;
      }
    } else {
      logger.warn('[PerformanceReportService] No DATABASE_URL configured, reports will not be persisted');
    }
  }

  /**
   * Ensure database schema exists for storing reports
   */
  private async ensureSchema(): Promise<void> {
    if (!this.pool) return;

    try {
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS performance_reports (
          id SERIAL PRIMARY KEY,
          report_id VARCHAR(64) NOT NULL UNIQUE,
          generated_at TIMESTAMP WITH TIME ZONE NOT NULL,
          period_start TIMESTAMP WITH TIME ZONE NOT NULL,
          period_end TIMESTAMP WITH TIME ZONE NOT NULL,
          report_data JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_performance_reports_generated_at 
          ON performance_reports(generated_at DESC);
        
        CREATE INDEX IF NOT EXISTS idx_performance_reports_period 
          ON performance_reports(period_start, period_end);
      `);
      logger.debug('[PerformanceReportService] Schema ensured');
    } catch (error) {
      logger.error('[PerformanceReportService] Failed to ensure schema', error);
    }
  }

  /**
   * Generate a performance report for a given time period
   */
  async generateReport(periodStart?: Date, periodEnd?: Date): Promise<PerformanceReport> {
    if (!this.pool) {
      throw new Error('Database not available for report generation');
    }

    const now = getNowInPXTimezone();
    const end = periodEnd || now.toJSDate();
    const start = periodStart || now.minus({ hours: 6 }).toJSDate(); // Default: last 6 hours

    logger.info(`[PerformanceReportService] Generating report from ${start.toISOString()} to ${end.toISOString()}`);

    // Get all setups (traded and skipped) in the period
    const setupAnalysis = await this.analyzeSetups(start, end);
    
    // Get trade outcomes for the period
    const tradeOutcomes = await this.analyzeTradeOutcomes(start, end);
    
    // Analyze false negatives (skipped setups that would have been profitable)
    const falseNegatives = await this.analyzeFalseNegatives(start, end);

    // Calculate summary
    const summary = {
      totalSetupsFound: setupAnalysis.totalSetups,
      setupsTraded: setupAnalysis.tradedSetups,
      setupsSkipped: setupAnalysis.skippedSetups,
      skipRate: setupAnalysis.totalSetups > 0 
        ? (setupAnalysis.skippedSetups / setupAnalysis.totalSetups) * 100 
        : 0,
      totalTrades: tradeOutcomes.totalTrades,
      winRate: tradeOutcomes.winRate,
      totalPnL: tradeOutcomes.totalPnL,
      falseNegativesCount: falseNegatives.length,
      falseNegativesPotentialPnL: falseNegatives.reduce((sum, fn) => sum + fn.potentialPnL, 0),
    };

    const report: PerformanceReport = {
      reportId: `report_${now.toMillis()}`,
      generatedAt: now.toISO()!,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      setupAnalysis,
      tradeOutcomes,
      falseNegatives,
      summary,
    };

    // Store report in database
    if (this.useDatabase && this.pool) {
      try {
        await this.pool.query(
          `INSERT INTO performance_reports (report_id, generated_at, period_start, period_end, report_data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (report_id) DO UPDATE SET report_data = EXCLUDED.report_data`,
          [
            report.reportId,
            report.generatedAt,
            report.periodStart,
            report.periodEnd,
            JSON.stringify(report),
          ]
        );
        logger.info(`[PerformanceReportService] Report stored: ${report.reportId}`);
      } catch (error) {
        logger.error('[PerformanceReportService] Failed to store report', error);
      }
    }

    return report;
  }

  /**
   * Analyze setups (traded vs skipped) in the period
   */
  private async analyzeSetups(start: Date, end: Date): Promise<SetupAnalysis> {
    if (!this.pool) {
      throw new Error('Database not available');
    }

    const result = await this.pool.query(
      `SELECT 
        id,
        timestamp,
        symbol,
        strategy,
        decision,
        signal_reason,
        risk_reason,
        guardrail_reason,
        execution_filter_reasons,
        trade_request
      FROM trade_decisions
      WHERE timestamp >= $1 AND timestamp <= $2
      ORDER BY timestamp DESC`,
      [start, end]
    );

    const totalSetups = result.rows.length;
    const tradedSetups = result.rows.filter((r: any) => r.decision === 'trade').length;
    const skippedSetups = totalSetups - tradedSetups;

    // Group skipped setups by reason
    const skippedByReason: Record<string, number> = {};
    const skippedDetails: SetupAnalysis['skippedDetails'] = [];

    for (const row of result.rows) {
      if (row.decision === 'skip') {
        // Determine primary skip reason
        let reason = 'Unknown';
        if (row.execution_filter_reasons && Array.isArray(JSON.parse(row.execution_filter_reasons))) {
          const reasons = JSON.parse(row.execution_filter_reasons);
          reason = reasons.length > 0 ? reasons[0] : 'Execution filter';
        } else if (row.risk_reason) {
          reason = row.risk_reason;
        } else if (row.guardrail_reason) {
          reason = row.guardrail_reason;
        } else if (row.signal_reason) {
          reason = row.signal_reason;
        }

        skippedByReason[reason] = (skippedByReason[reason] || 0) + 1;

        const tradeRequest = row.trade_request ? JSON.parse(row.trade_request) : null;
        skippedDetails.push({
          timestamp: row.timestamp,
          symbol: row.symbol,
          strategy: row.strategy,
          reason,
          entry: tradeRequest?.entry,
          stopLoss: tradeRequest?.stopLoss,
          takeProfit: tradeRequest?.takeProfit,
          direction: tradeRequest?.direction,
        });
      }
    }

    return {
      totalSetups,
      tradedSetups,
      skippedSetups,
      skippedByReason,
      skippedDetails,
    };
  }

  /**
   * Analyze trade outcomes (won/lost/break-even) in the period
   */
  private async analyzeTradeOutcomes(start: Date, end: Date): Promise<TradeOutcome> {
    if (!this.pool) {
      throw new Error('Database not available');
    }

    // Get closed trades from live_trades table
    const result = await this.pool.query(
      `SELECT 
        mt5_ticket,
        symbol,
        strategy,
        direction,
        entry_price,
        exit_price,
        sl_price,
        tp_price,
        entry_time,
        exit_time,
        profit_net,
        closed_reason
      FROM live_trades
      WHERE exit_time >= $1 AND exit_time <= $2
      ORDER BY exit_time DESC`,
      [start, end]
    );

    const trades: TradeOutcome['trades'] = [];
    let totalPnL = 0;
    let grossProfit = 0;
    let grossLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let breakEvenTrades = 0;

    for (const row of result.rows) {
      const profit = parseFloat(row.profit_net) || 0;
      totalPnL += profit;

      let outcome: 'win' | 'loss' | 'breakeven';
      if (profit > 0.01) {
        outcome = 'win';
        winningTrades++;
        grossProfit += profit;
      } else if (profit < -0.01) {
        outcome = 'loss';
        losingTrades++;
        grossLoss += Math.abs(profit);
      } else {
        outcome = 'breakeven';
        breakEvenTrades++;
      }

      trades.push({
        ticket: row.mt5_ticket.toString(),
        symbol: row.symbol,
        strategy: row.strategy || 'unknown',
        direction: row.direction,
        entryPrice: parseFloat(row.entry_price),
        exitPrice: parseFloat(row.exit_price),
        stopLoss: parseFloat(row.sl_price) || 0,
        takeProfit: parseFloat(row.tp_price) || 0,
        entryTime: row.entry_time,
        exitTime: row.exit_time,
        profit,
        outcome,
        closedReason: row.closed_reason,
      });
    }

    const totalTrades = trades.length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const averageWin = winningTrades > 0 ? grossProfit / winningTrades : 0;
    const averageLoss = losingTrades > 0 ? grossLoss / losingTrades : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      breakEvenTrades,
      totalPnL,
      grossProfit,
      grossLoss,
      averageWin,
      averageLoss,
      winRate,
      profitFactor,
      trades,
    };
  }

  /**
   * Analyze false negatives: skipped setups that would have been profitable
   * This checks if price moved favorably after a setup was skipped
   */
  private async analyzeFalseNegatives(start: Date, end: Date): Promise<FalseNegative[]> {
    if (!this.pool) {
      throw new Error('Database not available');
    }

    // Get skipped setups with trade_request data
    const skippedSetups = await this.pool.query(
      `SELECT 
        id,
        timestamp,
        symbol,
        strategy,
        signal_reason,
        risk_reason,
        guardrail_reason,
        execution_filter_reasons,
        trade_request
      FROM trade_decisions
      WHERE timestamp >= $1 AND timestamp <= $2
        AND decision = 'skip'
        AND trade_request IS NOT NULL
      ORDER BY timestamp DESC`,
      [start, end]
    );

    const falseNegatives: FalseNegative[] = [];

    for (const row of skippedSetups.rows) {
      const tradeRequest = JSON.parse(row.trade_request);
      if (!tradeRequest || !tradeRequest.entry || !tradeRequest.stopLoss || !tradeRequest.takeProfit) {
        continue;
      }

      const { entry, stopLoss, takeProfit, direction } = tradeRequest;
      const setupTime = new Date(row.timestamp);

      // Get price data after the setup time to see if TP or SL would have been hit
      // We'll check the next 24 hours of price movement
      const checkEndTime = new Date(setupTime.getTime() + 24 * 60 * 60 * 1000);

      // Query order_events or live_trades to see price movement
      // For now, we'll use a simplified approach: check if there were any trades
      // in the same direction around the same time that were profitable
      
      // Get price candles or ticks after setup time to simulate what would have happened
      // This is a simplified version - in production, you'd want to use actual price data
      const priceCheck = await this.pool.query(
        `SELECT 
          MIN(CASE WHEN direction = $1 THEN entry_price ELSE NULL END) as min_price,
          MAX(CASE WHEN direction = $1 THEN entry_price ELSE NULL END) as max_price
        FROM live_trades
        WHERE symbol = $2
          AND entry_time >= $3
          AND entry_time <= $4`,
        [direction.toUpperCase(), row.symbol, setupTime, checkEndTime]
      );

      if (priceCheck.rows.length === 0 || !priceCheck.rows[0].min_price) {
        continue; // No price data available
      }

      const minPrice = parseFloat(priceCheck.rows[0].min_price);
      const maxPrice = parseFloat(priceCheck.rows[0].max_price);

      // Determine if TP or SL would have been hit
      let wouldHaveHitTP = false;
      let wouldHaveHitSL = false;
      let maxFavorableMove = 0;
      let maxAdverseMove = 0;

      if (direction === 'buy') {
        wouldHaveHitTP = maxPrice >= takeProfit;
        wouldHaveHitSL = minPrice <= stopLoss;
        maxFavorableMove = maxPrice - entry;
        maxAdverseMove = entry - minPrice;
      } else {
        wouldHaveHitTP = minPrice <= takeProfit;
        wouldHaveHitSL = maxPrice >= stopLoss;
        maxFavorableMove = entry - minPrice;
        maxAdverseMove = maxPrice - entry;
      }

      // Only consider it a false negative if TP would have been hit before SL
      if (wouldHaveHitTP && !wouldHaveHitSL) {
        // Estimate potential PnL (simplified calculation)
        const priceMove = direction === 'buy' 
          ? takeProfit - entry 
          : entry - takeProfit;
        const lotSize = tradeRequest.lotSize || 0.01;
        // Simplified PnL calculation (would need proper pip/point conversion in production)
        const potentialPnL = priceMove * lotSize * 100; // Rough estimate

        // Determine skip reason
        let skipReason = 'Unknown';
        if (row.execution_filter_reasons) {
          const reasons = JSON.parse(row.execution_filter_reasons);
          skipReason = Array.isArray(reasons) ? reasons.join('; ') : 'Execution filter';
        } else if (row.risk_reason) {
          skipReason = row.risk_reason;
        } else if (row.guardrail_reason) {
          skipReason = row.guardrail_reason;
        } else if (row.signal_reason) {
          skipReason = row.signal_reason;
        }

        falseNegatives.push({
          decisionId: row.id,
          timestamp: row.timestamp,
          symbol: row.symbol,
          strategy: row.strategy,
          skipReason,
          plannedEntry: entry,
          plannedStopLoss: stopLoss,
          plannedTakeProfit: takeProfit,
          direction,
          wouldHaveHitTP,
          wouldHaveHitSL,
          maxFavorableMove,
          maxAdverseMove,
          potentialPnL,
        });
      }
    }

    return falseNegatives;
  }

  /**
   * Get recent reports
   */
  async getRecentReports(limit: number = 10): Promise<PerformanceReport[]> {
    if (!this.pool) {
      return [];
    }

    try {
      const result = await this.pool.query(
        `SELECT report_data
         FROM performance_reports
         ORDER BY generated_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map((row: any) => JSON.parse(row.report_data) as PerformanceReport);
    } catch (error) {
      logger.error('[PerformanceReportService] Failed to get recent reports', error);
      return [];
    }
  }

  /**
   * Get a specific report by ID
   */
  async getReport(reportId: string): Promise<PerformanceReport | null> {
    if (!this.pool) {
      return null;
    }

    try {
      const result = await this.pool.query(
        `SELECT report_data
         FROM performance_reports
         WHERE report_id = $1`,
        [reportId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return JSON.parse(result.rows[0].report_data) as PerformanceReport;
    } catch (error) {
      logger.error('[PerformanceReportService] Failed to get report', error);
      return null;
    }
  }

  /**
   * Cleanup: Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.useDatabase = false;
      logger.info('[PerformanceReportService] Database connection closed');
    }
  }
}

