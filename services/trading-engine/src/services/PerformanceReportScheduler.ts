/**
 * PerformanceReportScheduler
 * 
 * Schedules performance report generation at:
 * - 12:00 PM (noon)
 * - 6:00 PM
 * - 12:00 AM (midnight)
 * - 6:00 AM
 */

import * as cron from 'node-cron';
import { Logger } from '@providencex/shared-utils';
import { getNowInPXTimezone } from '@providencex/shared-utils';
import { PerformanceReportService } from './PerformanceReportService';

const logger = new Logger('PerformanceReportScheduler');

export class PerformanceReportScheduler {
  private reportService: PerformanceReportService;
  private cronJobs: cron.ScheduledTask[] = [];
  private isRunning: boolean = false;

  constructor(reportService: PerformanceReportService) {
    this.reportService = reportService;
  }

  /**
   * Start the scheduler
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('[PerformanceReportScheduler] Scheduler is already running');
      return;
    }

    logger.info('[PerformanceReportScheduler] Starting performance report scheduler');

    // Schedule reports at 12:00 PM, 6:00 PM, 12:00 AM, and 6:00 AM
    // Using cron format: minute hour * * *
    // Note: Times are in server timezone, adjust if needed for specific timezone
    
    // 12:00 PM (noon)
    const noonJob = cron.schedule('0 12 * * *', async () => {
      await this.generateScheduledReport('noon');
    }, {
      scheduled: false,
      timezone: 'America/New_York', // Adjust to your timezone
    });

    // 6:00 PM
    const eveningJob = cron.schedule('0 18 * * *', async () => {
      await this.generateScheduledReport('evening');
    }, {
      scheduled: false,
      timezone: 'America/New_York',
    });

    // 12:00 AM (midnight)
    const midnightJob = cron.schedule('0 0 * * *', async () => {
      await this.generateScheduledReport('midnight');
    }, {
      scheduled: false,
      timezone: 'America/New_York',
    });

    // 6:00 AM
    const morningJob = cron.schedule('0 6 * * *', async () => {
      await this.generateScheduledReport('morning');
    }, {
      scheduled: false,
      timezone: 'America/New_York',
    });

    this.cronJobs = [noonJob, eveningJob, midnightJob, morningJob];
    
    // Start all jobs
    this.cronJobs.forEach(job => job.start());
    
    this.isRunning = true;
    logger.info('[PerformanceReportScheduler] Performance report scheduler started');
    logger.info('[PerformanceReportScheduler] Reports will be generated at: 12:00 PM, 6:00 PM, 12:00 AM, 6:00 AM (America/New_York)');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('[PerformanceReportScheduler] Stopping performance report scheduler');
    
    this.cronJobs.forEach(job => job.stop());
    this.cronJobs = [];
    this.isRunning = false;
    
    logger.info('[PerformanceReportScheduler] Performance report scheduler stopped');
  }

  /**
   * Generate a scheduled report
   */
  private async generateScheduledReport(period: 'noon' | 'evening' | 'midnight' | 'morning'): Promise<void> {
    try {
      const now = getNowInPXTimezone();
      
      // Calculate period start (6 hours ago for each report)
      const periodStart = now.minus({ hours: 6 }).toJSDate();
      const periodEnd = now.toJSDate();

      logger.info(`[PerformanceReportScheduler] Generating ${period} report for period ${periodStart.toISOString()} to ${periodEnd.toISOString()}`);

      const report = await this.reportService.generateReport(periodStart, periodEnd);

      logger.info(`[PerformanceReportScheduler] ${period} report generated successfully: ${report.reportId}`);
      logger.info(`[PerformanceReportScheduler] Report summary:`, {
        totalSetups: report.summary.totalSetupsFound,
        setupsTraded: report.summary.setupsTraded,
        setupsSkipped: report.summary.setupsSkipped,
        skipRate: `${report.summary.skipRate.toFixed(2)}%`,
        totalTrades: report.summary.totalTrades,
        winRate: `${report.summary.winRate.toFixed(2)}%`,
        totalPnL: report.summary.totalPnL.toFixed(2),
        falseNegatives: report.summary.falseNegativesCount,
        falseNegativesPotentialPnL: report.summary.falseNegativesPotentialPnL.toFixed(2),
      });
    } catch (error) {
      logger.error(`[PerformanceReportScheduler] Failed to generate ${period} report`, error);
    }
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}

