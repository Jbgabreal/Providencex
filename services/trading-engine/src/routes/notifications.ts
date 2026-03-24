/**
 * Notification Routes — list, read/unread, preferences.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { NotificationRepository } from '../notifications/NotificationRepository';
import type { NotificationCategory } from '../notifications/types';

const logger = new Logger('NotificationRoutes');

export default function createNotificationRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const repo = new NotificationRepository();

  router.use(authMiddleware, requireUser);

  // ---------- Notifications ----------

  /**
   * GET /api/notifications
   * List notifications for the current user.
   * Query: ?category=trading&unread=true&limit=50&offset=0
   */
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const category = req.query.category as NotificationCategory | undefined;
      const unreadOnly = req.query.unread === 'true';
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const notifications = await repo.getForUser(userId, { category, unreadOnly, limit, offset });
      res.json({ success: true, notifications });
    } catch (error) {
      logger.error('[Notifications] List failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/notifications/unread-count
   */
  router.get('/unread-count', async (req: Request, res: Response) => {
    try {
      const count = await repo.getUnreadCount(req.auth!.userId);
      res.json({ success: true, count });
    } catch (error) {
      logger.error('[Notifications] Unread count failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/notifications/:id/read
   */
  router.patch('/:id/read', async (req: Request, res: Response) => {
    try {
      const success = await repo.markRead(req.params.id, req.auth!.userId);
      res.json({ success });
    } catch (error) {
      logger.error('[Notifications] Mark read failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/notifications/mark-all-read
   * Body: { category?: string }
   */
  router.post('/mark-all-read', async (req: Request, res: Response) => {
    try {
      const category = req.body?.category as NotificationCategory | undefined;
      const count = await repo.markAllRead(req.auth!.userId, category);
      res.json({ success: true, marked: count });
    } catch (error) {
      logger.error('[Notifications] Mark all read failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ---------- Preferences ----------

  /**
   * GET /api/notifications/preferences
   */
  router.get('/preferences', async (req: Request, res: Response) => {
    try {
      const prefs = await repo.getOrCreatePreferences(req.auth!.userId);
      res.json({ success: true, preferences: prefs });
    } catch (error) {
      logger.error('[Notifications] Get preferences failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/notifications/preferences
   */
  router.patch('/preferences', async (req: Request, res: Response) => {
    try {
      const prefs = await repo.updatePreferences(req.auth!.userId, req.body || {});
      res.json({ success: true, preferences: prefs });
    } catch (error) {
      logger.error('[Notifications] Update preferences failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
