/**
 * Public Mentor Marketplace Routes — no auth required.
 * Provides discovery, filtering, sorting, and detailed analytics for mentors.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { MentorAnalyticsService } from '../copytrading/MentorAnalyticsService';

const logger = new Logger('PublicMentorRoutes');

export default function createPublicMentorRouter() {
  const router: Router = express.Router();
  const repo = new CopyTradingRepository();
  const analyticsService = new MentorAnalyticsService();

  /**
   * GET /api/public/mentors
   * Browse mentors with filtering and sorting.
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
      const offset = parseInt(req.query.offset as string) || 0;
      const search = req.query.search as string | undefined;
      const sortBy = (req.query.sort_by as string) || 'followers';
      const sortDir = (req.query.sort_dir as string) === 'asc' ? 'ASC' : 'DESC';
      const symbolFilter = req.query.symbol as string | undefined;
      const styleFilter = req.query.style as string | undefined;
      const riskFilter = req.query.risk as string | undefined;

      // Build query
      const conditions = ['mp.is_active = TRUE', 'mp.is_approved = TRUE'];
      const params: any[] = [];
      let paramIdx = 1;

      if (search) {
        conditions.push(`mp.display_name ILIKE $${paramIdx++}`);
        params.push(`%${search}%`);
      }
      if (symbolFilter) {
        conditions.push(`$${paramIdx++} = ANY(mp.markets_traded)`);
        params.push(symbolFilter.toUpperCase());
      }
      if (styleFilter) {
        conditions.push(`$${paramIdx++} = ANY(mp.trading_style)`);
        params.push(styleFilter.toLowerCase());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Sort mapping
      const sortMap: Record<string, string> = {
        followers: 'mp.total_followers',
        newest: 'mp.created_at',
        name: 'mp.display_name',
      };
      const orderColumn = sortMap[sortBy] || 'mp.total_followers';

      // Count
      const countParams = [...params];
      const countResult = await (repo as any).ensurePool().query(
        `SELECT COUNT(*) FROM mentor_profiles mp ${whereClause}`, countParams
      );
      const total = parseInt(countResult.rows[0].count);

      // Fetch mentors
      params.push(limit, offset);
      const result = await (repo as any).ensurePool().query(
        `SELECT mp.* FROM mentor_profiles mp ${whereClause}
         ORDER BY mp.is_featured DESC, ${orderColumn} ${sortDir}
         LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
        params
      );

      // Attach analytics to each mentor (lightweight version)
      const mentors = await Promise.all(
        result.rows.map(async (mentor: any) => {
          try {
            const analytics = await analyticsService.getFullAnalytics(mentor.id);

            // Apply risk filter after analytics computed
            if (riskFilter && analytics.risk_label !== riskFilter) return null;

            return {
              ...mentor,
              analytics: {
                win_rate: analytics.win_rate,
                total_pnl: analytics.total_pnl,
                profit_factor: analytics.profit_factor,
                total_signals: analytics.total_signals,
                winning_trades: analytics.winning_trades,
                losing_trades: analytics.losing_trades,
                avg_rr: analytics.avg_rr,
                max_drawdown_pct: analytics.max_drawdown_pct,
                risk_label: analytics.risk_label,
                risk_score: analytics.risk_score,
                active_subscribers: analytics.active_subscribers,
                last_30d: analytics.last_30d,
              },
            };
          } catch {
            return { ...mentor, analytics: null };
          }
        })
      );

      const filtered = mentors.filter(Boolean);

      res.json({ success: true, mentors: filtered, total });
    } catch (error) {
      logger.error('[PublicMentors] List failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/mentors/:mentorId
   * Full public mentor profile with all analytics.
   */
  router.get('/:mentorId', async (req: Request, res: Response) => {
    try {
      const mentor = await repo.getMentorProfileById(req.params.mentorId);
      if (!mentor || !mentor.is_active || !mentor.is_approved) {
        return res.status(404).json({ error: 'Mentor not found' });
      }

      const analytics = await analyticsService.getFullAnalytics(mentor.id);

      res.json({
        success: true,
        mentor,
        analytics,
      });
    } catch (error) {
      logger.error('[PublicMentors] Profile failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/mentors/:mentorId/analytics
   * Just the analytics (for refreshing without full profile).
   */
  router.get('/:mentorId/analytics', async (req: Request, res: Response) => {
    try {
      const mentor = await repo.getMentorProfileById(req.params.mentorId);
      if (!mentor || !mentor.is_active || !mentor.is_approved) {
        return res.status(404).json({ error: 'Mentor not found' });
      }

      const analytics = await analyticsService.getFullAnalytics(mentor.id);
      res.json({ success: true, analytics });
    } catch (error) {
      logger.error('[PublicMentors] Analytics failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/public/mentors/:mentorId/signals
   * Public signal history for a mentor.
   */
  router.get('/:mentorId/signals', async (req: Request, res: Response) => {
    try {
      const mentor = await repo.getMentorProfileById(req.params.mentorId);
      if (!mentor || !mentor.is_active || !mentor.is_approved) {
        return res.status(404).json({ error: 'Mentor not found' });
      }

      const status = req.query.status as string | undefined;
      const limit = parseInt(req.query.limit as string) || 20;
      const offset = parseInt(req.query.offset as string) || 0;
      const { signals, total } = await repo.getSignalsByMentor(mentor.id, status, limit, offset);

      res.json({ success: true, signals, total });
    } catch (error) {
      logger.error('[PublicMentors] Signals failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
