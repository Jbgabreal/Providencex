/**
 * NotificationRepository — Data access for notifications and preferences.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type { Notification, NotificationPreferences, NotificationCategory } from './types';

const logger = new Logger('NotificationRepository');

export class NotificationRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) {
      logger.warn('[NotificationRepository] No databaseUrl, repository disabled');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[NotificationRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Notifications ====================

  async create(params: {
    userId: string;
    category: NotificationCategory;
    eventType: string;
    title: string;
    body: string;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<Notification | null> {
    const pool = this.ensurePool();
    try {
      const result = await pool.query(
        `INSERT INTO notifications (user_id, category, event_type, title, body, payload, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [
          params.userId, params.category, params.eventType,
          params.title, params.body,
          JSON.stringify(params.payload || {}),
          params.idempotencyKey || null,
        ]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('[NotificationRepo] Create failed', error);
      return null;
    }
  }

  async getForUser(userId: string, opts?: {
    category?: NotificationCategory;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  }): Promise<Notification[]> {
    const pool = this.ensurePool();
    let where = 'WHERE user_id = $1';
    const params: any[] = [userId];
    let i = 2;
    if (opts?.category) { where += ` AND category = $${i++}`; params.push(opts.category); }
    if (opts?.unreadOnly) { where += ' AND is_read = FALSE'; }
    const limit = opts?.limit || 50;
    const offset = opts?.offset || 0;
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      params
    );
    return result.rows;
  }

  async getUnreadCount(userId: string): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = FALSE',
      [userId]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  async markRead(notificationId: string, userId: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE notifications SET is_read = TRUE, read_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_read = FALSE RETURNING id`,
      [notificationId, userId]
    );
    return (result.rowCount || 0) > 0;
  }

  async markAllRead(userId: string, category?: NotificationCategory): Promise<number> {
    const pool = this.ensurePool();
    let query = `UPDATE notifications SET is_read = TRUE, read_at = NOW()
                 WHERE user_id = $1 AND is_read = FALSE`;
    const params: any[] = [userId];
    if (category) {
      query += ' AND category = $2';
      params.push(category);
    }
    query += ' RETURNING id';
    const result = await pool.query(query, params);
    return result.rowCount || 0;
  }

  // ==================== Preferences ====================

  async getPreferences(userId: string): Promise<NotificationPreferences | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM notification_preferences WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  }

  async getOrCreatePreferences(userId: string): Promise<NotificationPreferences> {
    const existing = await this.getPreferences(userId);
    if (existing) return existing;
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO notification_preferences (user_id)
       VALUES ($1)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING *`,
      [userId]
    );
    return result.rows[0];
  }

  async updatePreferences(userId: string, updates: {
    trading_enabled?: boolean;
    safety_enabled?: boolean;
    billing_enabled?: boolean;
    referrals_enabled?: boolean;
    system_enabled?: boolean;
    muted_event_types?: string[];
    email_enabled?: boolean;
    telegram_enabled?: boolean;
    push_enabled?: boolean;
  }): Promise<NotificationPreferences> {
    // Ensure preferences row exists
    await this.getOrCreatePreferences(userId);
    const pool = this.ensurePool();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (updates.trading_enabled !== undefined) { sets.push(`trading_enabled = $${i++}`); params.push(updates.trading_enabled); }
    if (updates.safety_enabled !== undefined) { sets.push(`safety_enabled = $${i++}`); params.push(updates.safety_enabled); }
    if (updates.billing_enabled !== undefined) { sets.push(`billing_enabled = $${i++}`); params.push(updates.billing_enabled); }
    if (updates.referrals_enabled !== undefined) { sets.push(`referrals_enabled = $${i++}`); params.push(updates.referrals_enabled); }
    if (updates.system_enabled !== undefined) { sets.push(`system_enabled = $${i++}`); params.push(updates.system_enabled); }
    if (updates.muted_event_types !== undefined) { sets.push(`muted_event_types = $${i++}`); params.push(updates.muted_event_types); }
    if (updates.email_enabled !== undefined) { sets.push(`email_enabled = $${i++}`); params.push(updates.email_enabled); }
    if (updates.telegram_enabled !== undefined) { sets.push(`telegram_enabled = $${i++}`); params.push(updates.telegram_enabled); }
    if (updates.push_enabled !== undefined) { sets.push(`push_enabled = $${i++}`); params.push(updates.push_enabled); }
    if (sets.length === 0) return (await this.getPreferences(userId))!;
    sets.push('updated_at = NOW()');
    params.push(userId);
    const result = await pool.query(
      `UPDATE notification_preferences SET ${sets.join(', ')} WHERE user_id = $${i} RETURNING *`,
      params
    );
    return result.rows[0];
  }

  /**
   * Check if a notification should be created based on user preferences.
   */
  async isCategoryEnabled(userId: string, category: NotificationCategory): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    if (!prefs) return true; // Default: all enabled
    const key = `${category}_enabled` as keyof NotificationPreferences;
    return prefs[key] !== false;
  }

  async isEventMuted(userId: string, eventType: string): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    if (!prefs) return false;
    return (prefs.muted_event_types || []).includes(eventType);
  }
}
