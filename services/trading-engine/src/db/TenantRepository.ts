import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';

const logger = new Logger('TenantRepository');

export type UserRole = 'admin' | 'user';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export type Mt5AccountStatus = 'connected' | 'paused' | 'disconnected';

export type BrokerType = 'mt5' | 'deriv';

export interface Mt5Account {
  id: string;
  user_id: string;
  label: string | null;
  account_number: string;
  server: string;
  is_demo: boolean;
  status: Mt5AccountStatus;
  connection_meta: any | null;
  broker_type: BrokerType;
  broker_credentials: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  disconnected_at: string | null;
}

export type RiskTier = 'low' | 'medium' | 'high';

export interface StrategyProfileRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  risk_tier: RiskTier;
  implementation_key: string;
  config: Record<string, any>;
  is_public: boolean;
  is_frozen: boolean;
  created_at: string;
  updated_at: string;
}

export type AssignmentStatus = 'active' | 'paused' | 'stopped';

export interface UserTradingConfig {
  risk_mode?: 'percentage' | 'usd';
  risk_per_trade_pct?: number;
  risk_per_trade_usd?: number;
  max_consecutive_losses?: number;
  sessions?: Array<'asian' | 'london' | 'newyork'>;
  symbols?: string[];  // e.g. ['XAUUSD', 'EURUSD'] — pairs the user wants to trade
}

export interface UserStrategyAssignment {
  id: string;
  user_id: string;
  mt5_account_id: string;
  strategy_profile_id: string;
  status: AssignmentStatus;
  user_config: UserTradingConfig;
  started_at: string | null;
  stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * TenantRepository
 *
 * Thin data-access layer for multi-tenant tables:
 * - users
 * - mt5_accounts
 * - strategy_profiles
 * - user_strategy_assignments
 */
export class TenantRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;

    if (!url) {
      logger.warn('[TenantRepository] No databaseUrl configured, repository is disabled');
      return;
    }

    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });

    this.pool.on('error', (err) => {
      logger.error('[TenantRepository] Database pool error (non-fatal):', err);
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      throw new Error('[TenantRepository] Database pool not initialized');
    }
    return this.pool;
  }

  // ---------- Strategy Profiles ----------

  async getAllStrategyProfiles(): Promise<StrategyProfileRow[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id, key, name, description, risk_tier, implementation_key, config,
              is_public, is_frozen, created_at, updated_at
       FROM strategy_profiles
       ORDER BY created_at ASC`
    );
    return result.rows;
  }

  async getPublicStrategyProfiles(): Promise<StrategyProfileRow[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id, key, name, description, risk_tier, implementation_key, config,
              is_public, is_frozen, created_at, updated_at
       FROM strategy_profiles
       WHERE is_public = TRUE
       ORDER BY name ASC`
    );
    return result.rows;
  }

  async getStrategyProfileByKey(key: string): Promise<StrategyProfileRow | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id, key, name, description, risk_tier, implementation_key, config,
              is_public, is_frozen, created_at, updated_at
       FROM strategy_profiles
       WHERE key = $1`,
      [key]
    );
    return result.rows[0] || null;
  }

  async getStrategyProfileById(id: string): Promise<StrategyProfileRow | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT id, key, name, description, risk_tier, implementation_key, config,
              is_public, is_frozen, created_at, updated_at
       FROM strategy_profiles
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async createStrategyProfile(input: {
    key: string;
    name: string;
    description?: string;
    risk_tier: 'low' | 'medium' | 'high';
    implementation_key: string;
    config: any;
    is_public?: boolean;
    is_frozen?: boolean;
  }): Promise<StrategyProfileRow> {
    const pool = this.ensurePool();

    // Check for duplicate key
    const existing = await pool.query(
      `SELECT id FROM strategy_profiles WHERE key = $1`,
      [input.key]
    );
    if (existing.rows.length > 0) {
      throw new Error(`Strategy profile with key '${input.key}' already exists`);
    }

    const result = await pool.query(
      `INSERT INTO strategy_profiles (
         key, name, description, risk_tier, implementation_key, config,
         is_public, is_frozen
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, key, name, description, risk_tier, implementation_key, config,
                 is_public, is_frozen, created_at, updated_at`,
      [
        input.key,
        input.name,
        input.description || null,
        input.risk_tier,
        input.implementation_key,
        JSON.stringify(input.config),
        input.is_public !== false, // default true
        input.is_frozen === true,   // default false
      ]
    );
    return result.rows[0];
  }

  async updateStrategyProfile(
    id: string,
    updates: {
      name?: string;
      description?: string;
      risk_tier?: 'low' | 'medium' | 'high';
      config?: any;
      is_public?: boolean;
      is_frozen?: boolean;
    }
  ): Promise<StrategyProfileRow | null> {
    const pool = this.ensurePool();

    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      params.push(updates.description);
    }
    if (updates.risk_tier !== undefined) {
      setClauses.push(`risk_tier = $${paramIndex++}`);
      params.push(updates.risk_tier);
    }
    if (updates.config !== undefined) {
      setClauses.push(`config = $${paramIndex++}`);
      params.push(JSON.stringify(updates.config));
    }
    if (updates.is_public !== undefined) {
      setClauses.push(`is_public = $${paramIndex++}`);
      params.push(updates.is_public);
    }
    if (updates.is_frozen !== undefined) {
      setClauses.push(`is_frozen = $${paramIndex++}`);
      params.push(updates.is_frozen);
    }

    if (setClauses.length === 0) {
      // No updates, just return existing
      return await this.getStrategyProfileById(id);
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    const result = await pool.query(
      `UPDATE strategy_profiles
       SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, key, name, description, risk_tier, implementation_key, config,
                 is_public, is_frozen, created_at, updated_at`,
      params
    );
    return result.rows[0] || null;
  }

  // ---------- MT5 Accounts ----------

  async getMt5AccountsForUser(userId: string): Promise<Mt5Account[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT *
       FROM mt5_accounts
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [userId]
    );
    return result.rows;
  }

  async createMt5Account(params: {
    userId: string;
    label?: string;
    accountNumber: string;
    server: string;
    isDemo: boolean;
    connectionMeta?: any;
    brokerType?: BrokerType;
    brokerCredentials?: Record<string, any>;
  }): Promise<Mt5Account> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO mt5_accounts (
         user_id, label, account_number, server, is_demo, status, connection_meta,
         broker_type, broker_credentials
       ) VALUES ($1, $2, $3, $4, $5, 'connected', $6, $7, $8)
       RETURNING *`,
      [
        params.userId,
        params.label || null,
        params.accountNumber,
        params.server,
        params.isDemo,
        params.connectionMeta || null,
        params.brokerType || 'mt5',
        params.brokerCredentials ? JSON.stringify(params.brokerCredentials) : null,
      ]
    );
    return result.rows[0];
  }

  async updateMt5AccountStatus(
    accountId: string,
    userId: string,
    status: Mt5AccountStatus
  ): Promise<Mt5Account | null> {
    const pool = this.ensurePool();
    const disconnectedAt =
      status === 'disconnected' ? new Date().toISOString() : null;

    const result = await pool.query(
      `UPDATE mt5_accounts
       SET status = $3,
           disconnected_at = COALESCE($4, disconnected_at),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [accountId, userId, status, disconnectedAt]
    );
    return result.rows[0] || null;
  }

  // ---------- System Settings ----------

  async getSystemSetting(key: string): Promise<any | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT value FROM system_settings WHERE key = $1`,
      [key]
    );
    return result.rows[0]?.value || null;
  }

  async getAllSystemSettings(): Promise<Array<{ key: string; value: any; description: string | null; updated_at: string }>> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT key, value, description, updated_at FROM system_settings ORDER BY key ASC`
    );
    return result.rows.map(row => ({
      key: row.key,
      value: row.value,
      description: row.description,
      updated_at: row.updated_at,
    }));
  }

  async setSystemSetting(key: string, value: any, description: string | null, updatedBy: string | null): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `INSERT INTO system_settings (key, value, description, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           description = EXCLUDED.description,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [key, JSON.stringify(value), description, updatedBy]
    );
  }

  // ---------- User Strategy Assignments ----------

  async getAssignmentById(id: string, userId: string): Promise<UserStrategyAssignment | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT usa.*, sp.key AS strategy_key, sp.name AS strategy_name
       FROM user_strategy_assignments usa
       LEFT JOIN strategy_profiles sp ON sp.id = usa.strategy_profile_id
       WHERE usa.id = $1 AND usa.user_id = $2`,
      [id, userId]
    );
    return result.rows[0] || null;
  }

  async getAssignmentsForUser(userId: string): Promise<UserStrategyAssignment[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `SELECT usa.*, sp.key AS strategy_key, sp.name AS strategy_name
       FROM user_strategy_assignments usa
       LEFT JOIN strategy_profiles sp ON sp.id = usa.strategy_profile_id
       WHERE usa.user_id = $1
       ORDER BY usa.created_at ASC`,
      [userId]
    );
    return result.rows;
  }

  async createAssignment(params: {
    userId: string;
    mt5AccountId: string;
    strategyProfileId: string;
    status?: AssignmentStatus;
  }): Promise<UserStrategyAssignment> {
    const pool = this.ensurePool();
    const status = params.status || 'active';

    const result = await pool.query(
      `INSERT INTO user_strategy_assignments (
         user_id, mt5_account_id, strategy_profile_id, status, started_at
       ) VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'active' THEN NOW() ELSE NULL END)
       RETURNING *`,
      [params.userId, params.mt5AccountId, params.strategyProfileId, status]
    );
    return result.rows[0];
  }

  async updateAssignmentStatus(
    id: string,
    userId: string,
    status: AssignmentStatus
  ): Promise<UserStrategyAssignment | null> {
    const pool = this.ensurePool();
    const nowIso = new Date().toISOString();
    const stoppedAt = status === 'stopped' ? nowIso : null;
    const startedAt = status === 'active' ? nowIso : null;

    const result = await pool.query(
      `UPDATE user_strategy_assignments
       SET status = $3,
           started_at = CASE WHEN $3 = 'active' THEN COALESCE(started_at, $4) ELSE started_at END,
           stopped_at = CASE WHEN $3 = 'stopped' THEN $5 ELSE stopped_at END,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId, status, startedAt, stoppedAt]
    );
    return result.rows[0] || null;
  }

  async updateAssignmentUserConfig(
    id: string,
    userId: string,
    userConfig: UserTradingConfig
  ): Promise<UserStrategyAssignment | null> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `UPDATE user_strategy_assignments
       SET user_config = $3,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId, JSON.stringify(userConfig)]
    );
    return result.rows[0] || null;
  }
}


