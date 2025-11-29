import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { PrivyIdentity, UserRow, UserRole } from './types';

const logger = new Logger('UserAuthRepository');

export class UserAuthRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl: string | undefined) {
    if (!databaseUrl) {
      logger.warn('[UserAuthRepository] No databaseUrl provided, repository is disabled');
      return;
    }

    try {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      });

      this.pool.on('error', (err) => {
        logger.error('[UserAuthRepository] Database pool error (non-fatal):', err);
      });
    } catch (error) {
      logger.error('[UserAuthRepository] Failed to create database pool', error);
      this.pool = null;
    }
  }

  private ensurePool(): Pool {
    if (!this.pool) {
      throw new Error('[UserAuthRepository] Database pool not initialized');
    }
    return this.pool;
  }

  async findByExternalAuthId(externalAuthId: string): Promise<UserRow | null> {
    if (!this.pool) {
      return null;
    }

    try {
      const res = await this.pool.query(
        `SELECT id, email, external_auth_id, role, created_at, updated_at
         FROM users
         WHERE external_auth_id = $1`,
        [externalAuthId]
      );
      return res.rows[0] ? this.mapRow(res.rows[0]) : null;
    } catch (error) {
      logger.error(`[UserAuthRepository] Failed to find user by external_auth_id=${externalAuthId}`, error);
      return null;
    }
  }

  async findById(id: string): Promise<UserRow | null> {
    if (!this.pool) {
      return null;
    }

    try {
      const res = await this.pool.query(
        `SELECT id, email, external_auth_id, role, created_at, updated_at
         FROM users
         WHERE id = $1`,
        [id]
      );
      return res.rows[0] ? this.mapRow(res.rows[0]) : null;
    } catch (error) {
      logger.error(`[UserAuthRepository] Failed to find user by id=${id}`, error);
      return null;
    }
  }

  async createFromPrivy(identity: PrivyIdentity): Promise<UserRow> {
    const pool = this.ensurePool();
    const email = (identity.email ?? null)?.toLowerCase() ?? null;
    const externalAuthId = identity.privyUserId;
    const role: UserRole = 'user';

    try {
      const res = await this.pool!.query(
        `INSERT INTO users (email, external_auth_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (external_auth_id) DO UPDATE
         SET email = EXCLUDED.email, updated_at = NOW()
         RETURNING id, email, external_auth_id, role, created_at, updated_at`,
        [email, externalAuthId, role]
      );
      return this.mapRow(res.rows[0]);
    } catch (error: any) {
      // Handle unique constraint violation on email
      if (error.code === '23505' && error.constraint === 'users_email_key') {
        // Email already exists, try to find by email and update external_auth_id
        logger.warn(`[UserAuthRepository] Email ${email} already exists, attempting to link external_auth_id`);
        const res = await pool.query(
          `UPDATE users
           SET external_auth_id = $1, updated_at = NOW()
           WHERE email = $2
           RETURNING id, email, external_auth_id, role, created_at, updated_at`,
          [externalAuthId, email]
        );
        if (res.rows[0]) {
          return this.mapRow(res.rows[0]);
        }
      }
      logger.error('[UserAuthRepository] Failed to create user from Privy identity', error);
      throw error;
    }
  }

  async findOrCreateForPrivy(identity: PrivyIdentity): Promise<UserRow> {
    const existing = await this.findByExternalAuthId(identity.privyUserId);
    if (existing) {
      return existing;
    }
    return this.createFromPrivy(identity);
  }

  private mapRow(row: any): UserRow {
    return {
      id: row.id,
      email: row.email,
      external_auth_id: row.external_auth_id,
      role: row.role as UserRole,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

