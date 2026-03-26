/**
 * Trade Journal API Routes
 *
 * Provides endpoints for reviewing trade journal entries across all strategies.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradeJournalRepository } from '../journal/TradeJournalRepository';
import { JournalFilters } from '../journal/types';

const logger = new Logger('JournalRoutes');

export default function createJournalRouter(): Router {
  const router: Router = express.Router();
  const repo = new TradeJournalRepository();

  // Initialize table on startup
  repo.initialize().catch(err => logger.error('Failed to initialize trade_journal table', err));

  // GET /api/v1/journal/trades — list with filters
  router.get('/trades', async (req: Request, res: Response) => {
    try {
      const filters: JournalFilters = {
        strategyKey: req.query.strategy as string | undefined,
        symbol: req.query.symbol as string | undefined,
        direction: req.query.direction as 'buy' | 'sell' | undefined,
        status: req.query.status as string | undefined,
        excludeStatus: req.query.exclude_status as string | undefined,
        result: req.query.result as 'win' | 'loss' | 'breakeven' | undefined,
        dateFrom: req.query.from as string | undefined,
        dateTo: req.query.to as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 50,
        offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
      };

      const result = await repo.list(filters);
      res.json({ success: true, ...result });
    } catch (err: any) {
      logger.error('Failed to list journal entries', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v1/journal/trades/:id — single entry
  router.get('/trades/:id', async (req: Request, res: Response) => {
    try {
      const entry = await repo.getById(req.params.id);
      if (!entry) {
        return res.status(404).json({ success: false, error: 'Entry not found' });
      }
      res.json({ success: true, entry });
    } catch (err: any) {
      logger.error('Failed to get journal entry', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v1/journal/summary — aggregate stats
  router.get('/summary', async (req: Request, res: Response) => {
    try {
      const filters: JournalFilters = {
        symbol: req.query.symbol as string | undefined,
        dateFrom: req.query.from as string | undefined,
        dateTo: req.query.to as string | undefined,
      };
      const summary = await repo.getSummary(filters);
      res.json({ success: true, summary });
    } catch (err: any) {
      logger.error('Failed to get journal summary', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v1/journal/strategies/:key — per-strategy breakdown
  router.get('/strategies/:key', async (req: Request, res: Response) => {
    try {
      const stats = await repo.getStrategyBreakdown(req.params.key);
      if (!stats) {
        return res.status(404).json({ success: false, error: 'Strategy not found in journal' });
      }
      res.json({ success: true, stats });
    } catch (err: any) {
      logger.error('Failed to get strategy breakdown', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/v1/journal/trades — clear all journal entries
  router.delete('/trades', async (req: Request, res: Response) => {
    try {
      const pool = (repo as any).pool;
      const result = await pool.query('DELETE FROM trade_journal');
      logger.info(`Cleared ${result.rowCount} journal entries`);
      res.json({ success: true, deleted: result.rowCount });
    } catch (err: any) {
      logger.error('Failed to clear journal', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
