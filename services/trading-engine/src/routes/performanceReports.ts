/**
 * Performance Reports API Routes
 */

import { Router, Request, Response } from 'express';
import { Logger } from '@providencex/shared-utils';
import { PerformanceReportService } from '../services/PerformanceReportService';

const logger = new Logger('PerformanceReportsRoute');
const router: Router = Router();

let reportService: PerformanceReportService | null = null;

export function initializePerformanceReportsService(service: PerformanceReportService): void {
  reportService = service;
  logger.info('[PerformanceReportsRoute] PerformanceReportService initialized');
}

/**
 * GET /api/v1/performance-reports
 * Get recent performance reports
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!reportService) {
      return res.status(503).json({
        success: false,
        error: 'PerformanceReportService not available',
      });
    }

    const limit = parseInt(req.query.limit as string) || 10;
    const reports = await reportService.getRecentReports(limit);

    res.json({
      success: true,
      reports,
      count: reports.length,
    });
  } catch (error) {
    logger.error('[PerformanceReportsRoute] Error getting recent reports', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/v1/performance-reports/:reportId
 * Get a specific report by ID
 */
router.get('/:reportId', async (req: Request, res: Response) => {
  try {
    if (!reportService) {
      return res.status(503).json({
        success: false,
        error: 'PerformanceReportService not available',
      });
    }

    const { reportId } = req.params;
    const report = await reportService.getReport(reportId);

    if (!report) {
      return res.status(404).json({
        success: false,
        error: 'Report not found',
      });
    }

    res.json({
      success: true,
      report,
    });
  } catch (error) {
    logger.error('[PerformanceReportsRoute] Error getting report', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/v1/performance-reports/generate
 * Manually trigger report generation
 */
router.post('/generate', async (req: Request, res: Response) => {
  try {
    if (!reportService) {
      return res.status(503).json({
        success: false,
        error: 'PerformanceReportService not available',
      });
    }

    const { periodStart, periodEnd } = req.body;
    
    const start = periodStart ? new Date(periodStart) : undefined;
    const end = periodEnd ? new Date(periodEnd) : undefined;

    const report = await reportService.generateReport(start, end);

    res.json({
      success: true,
      report,
      message: 'Report generated successfully',
    });
  } catch (error) {
    logger.error('[PerformanceReportsRoute] Error generating report', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

