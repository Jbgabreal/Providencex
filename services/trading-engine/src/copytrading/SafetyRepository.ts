/**
 * SafetyRepository — Data access for safety settings, trade events, blocked attempts, guardrail events.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type {
  SafetySettings,
  CopiedTradeEvent,
  BlockedCopyAttempt,
  SubscriptionGuardrailEvent,
  BlockReason,
  GuardrailType,
} from './SafetyTypes';

const logger = new Logger('SafetyRepository');

export class SafetyRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) {
      logger.warn('[SafetyRepository] No databaseUrl, repository disabled');
      return;
    }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[SafetyRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Safety Settings ====================

  async getSafetySettings(subscriptionId: string): Promise<SafetySettings> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT safety_settings FROM follower_subscriptions WHERE id = $1',
      [subscriptionId]
    );
    return (result.rows[0]?.safety_settings || {}) as SafetySettings;
  }

  async updateSafetySettings(subscriptionId: string, userId: string, settings: SafetySettings): Promise<SafetySettings> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE follower_subscriptions SET safety_settings = $3, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 RETURNING safety_settings`,
      [subscriptionId, userId, JSON.stringify(settings)]
    );
    return (result.rows[0]?.safety_settings || {}) as SafetySettings;
  }

  async getSubscriptionWithSafety(subscriptionId: string): Promise<{
    id: string; user_id: string; mentor_profile_id: string; mt5_account_id: string;
    status: string; safety_settings: SafetySettings; blocked_symbols: string[];
    auto_disabled_at: string | null; auto_disabled_reason: string | null;
  } | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id, user_id, mentor_profile_id, mt5_account_id, status,
              safety_settings, blocked_symbols, auto_disabled_at, auto_disabled_reason
       FROM follower_subscriptions WHERE id = $1`,
      [subscriptionId]
    );
    return result.rows[0] || null;
  }

  // ==================== Auto-Disable ====================

  async autoDisableSubscription(subscriptionId: string, reason: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE follower_subscriptions
       SET status = 'paused', auto_disabled_at = NOW(), auto_disabled_reason = $2, updated_at = NOW()
       WHERE id = $1`,
      [subscriptionId, reason]
    );
  }

  async reEnableSubscription(subscriptionId: string, userId: string): Promise<boolean> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE follower_subscriptions
       SET status = 'active', auto_disabled_at = NULL, auto_disabled_reason = NULL, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status = 'paused' RETURNING id`,
      [subscriptionId, userId]
    );
    return (result.rowCount || 0) > 0;
  }

  // ==================== Daily Loss Calculation ====================

  async getDailyLossForSubscription(subscriptionId: string): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT COALESCE(SUM(profit), 0) as daily_pnl
       FROM copied_trades
       WHERE follower_subscription_id = $1
         AND status = 'closed'
         AND closed_at >= CURRENT_DATE
         AND profit < 0`,
      [subscriptionId]
    );
    return Math.abs(Number(result.rows[0]?.daily_pnl || 0));
  }

  // ==================== Concurrent Trade Count ====================

  async getOpenTradeCount(subscriptionId: string): Promise<number> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT COUNT(*) as count FROM copied_trades
       WHERE follower_subscription_id = $1 AND status IN ('pending', 'executing', 'open')`,
      [subscriptionId]
    );
    return parseInt(result.rows[0]?.count || '0');
  }

  // ==================== Copied Trade Events ====================

  async createTradeEvent(params: {
    copiedTradeId: string;
    followerSubscriptionId: string;
    mentorSignalId: string;
    eventType: string;
    details?: Record<string, unknown>;
  }): Promise<CopiedTradeEvent> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO copied_trade_events (copied_trade_id, follower_subscription_id, mentor_signal_id, event_type, details)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [params.copiedTradeId, params.followerSubscriptionId, params.mentorSignalId,
       params.eventType, JSON.stringify(params.details || {})]
    );
    return result.rows[0];
  }

  async getTradeEvents(copiedTradeId: string): Promise<CopiedTradeEvent[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM copied_trade_events WHERE copied_trade_id = $1 ORDER BY created_at ASC',
      [copiedTradeId]
    );
    return result.rows;
  }

  // ==================== Blocked Copy Attempts ====================

  async createBlockedAttempt(params: {
    followerSubscriptionId: string;
    mentorSignalId: string;
    userId: string;
    blockReason: BlockReason;
    guardrailType: GuardrailType;
    thresholdValue?: string;
    actualValue?: string;
    signalSymbol?: string;
    signalDirection?: string;
    signalEntryPrice?: number;
  }): Promise<BlockedCopyAttempt> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO blocked_copy_attempts (
        follower_subscription_id, mentor_signal_id, user_id,
        block_reason, guardrail_type, threshold_value, actual_value,
        signal_symbol, signal_direction, signal_entry_price
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        params.followerSubscriptionId, params.mentorSignalId, params.userId,
        params.blockReason, params.guardrailType,
        params.thresholdValue || null, params.actualValue || null,
        params.signalSymbol || null, params.signalDirection || null,
        params.signalEntryPrice || null,
      ]
    );
    return result.rows[0];
  }

  async getBlockedAttempts(userId: string, limit = 50): Promise<BlockedCopyAttempt[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM blocked_copy_attempts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
      [userId, limit]
    );
    return result.rows;
  }

  async getBlockedAttemptsForSubscription(subscriptionId: string, limit = 50): Promise<BlockedCopyAttempt[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM blocked_copy_attempts WHERE follower_subscription_id = $1 ORDER BY created_at DESC LIMIT $2',
      [subscriptionId, limit]
    );
    return result.rows;
  }

  // ==================== Guardrail Events ====================

  async createGuardrailEvent(params: {
    followerSubscriptionId: string;
    userId: string;
    eventType: 'auto_disabled' | 're_enabled' | 'guardrail_warning';
    reason: string;
    thresholdValue?: string;
    actualValue?: string;
    metadata?: Record<string, unknown>;
  }): Promise<SubscriptionGuardrailEvent> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO subscription_guardrail_events (
        follower_subscription_id, user_id, event_type, reason,
        threshold_value, actual_value, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        params.followerSubscriptionId, params.userId, params.eventType,
        params.reason, params.thresholdValue || null, params.actualValue || null,
        JSON.stringify(params.metadata || {}),
      ]
    );
    return result.rows[0];
  }

  async getGuardrailEvents(subscriptionId: string, limit = 20): Promise<SubscriptionGuardrailEvent[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM subscription_guardrail_events WHERE follower_subscription_id = $1 ORDER BY created_at DESC LIMIT $2',
      [subscriptionId, limit]
    );
    return result.rows;
  }
}
