/**
 * Feature Store (Trading Engine v13)
 * 
 * Stores and retrieves feature vectors for model retraining
 */

import { Logger } from '@providencex/shared-utils';
import { Pool } from 'pg';
import { FeatureVector, MLSignalScore, RegimeType } from './types';

const logger = new Logger('FeatureStore');

/**
 * Feature Store - Stores feature vectors and outcomes for ML retraining
 */
export class FeatureStore {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    if (databaseUrl) {
      try {
        this.pool = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        
        // Handle pool errors gracefully (prevent app crash)
        this.pool.on('error', (err) => {
          logger.error('[FeatureStore] Database pool error (non-fatal):', err);
        });
        
        this.initializeDatabase();
        logger.info('[FeatureStore] Connected to database');
      } catch (error) {
        logger.error('[FeatureStore] Failed to connect to database', error);
        this.pool = null;
      }
    }
  }

  /**
   * Initialize database tables
   */
  private async initializeDatabase(): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      // Create ml_feature_vectors table
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS ml_feature_vectors (
          id BIGSERIAL PRIMARY KEY,
          symbol VARCHAR(20) NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL,
          features JSONB NOT NULL, -- Feature vector
          regime VARCHAR(32) NOT NULL, -- Regime at time of prediction
          ml_score JSONB, -- ML predictions
          signal_direction VARCHAR(4), -- buy or sell
          actual_outcome VARCHAR(32), -- win, loss, breakeven (null until trade closes)
          actual_pnl NUMERIC, -- Actual PnL (null until trade closes)
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Create indexes
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_feature_vectors_symbol ON ml_feature_vectors(symbol)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_feature_vectors_timestamp ON ml_feature_vectors(timestamp DESC)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_feature_vectors_regime ON ml_feature_vectors(regime)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_feature_vectors_outcome ON ml_feature_vectors(actual_outcome)
      `);

      // GIN index for JSONB features
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS idx_ml_feature_vectors_features_gin 
        ON ml_feature_vectors USING GIN (features)
      `);

      logger.info('[FeatureStore] Database tables initialized');
    } catch (error) {
      logger.error('[FeatureStore] Failed to initialize database', error);
    }
  }

  /**
   * Store feature vector with prediction
   */
  async storeFeatures(
    symbol: string,
    features: FeatureVector,
    regime: RegimeType,
    mlScore: MLSignalScore | null,
    signalDirection: 'buy' | 'sell' | null
  ): Promise<number | null> {
    if (!this.pool) {
      return null;
    }

    try {
      const result = await this.pool.query(
        `INSERT INTO ml_feature_vectors (
          symbol, timestamp, features, regime, ml_score, signal_direction
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id`,
        [
          symbol,
          new Date(),
          JSON.stringify(features),
          regime,
          mlScore ? JSON.stringify(mlScore) : null,
          signalDirection,
        ]
      );

      return parseInt(result.rows[0].id, 10);
    } catch (error) {
      logger.error('[FeatureStore] Failed to store features', error);
      return null;
    }
  }

  /**
   * Update feature vector with actual outcome
   */
  async updateOutcome(
    id: number,
    outcome: 'win' | 'loss' | 'breakeven',
    pnl: number | null
  ): Promise<void> {
    if (!this.pool) {
      return;
    }

    try {
      await this.pool.query(
        `UPDATE ml_feature_vectors 
         SET actual_outcome = $1, actual_pnl = $2
         WHERE id = $3`,
        [outcome, pnl, id]
      );
    } catch (error) {
      logger.error('[FeatureStore] Failed to update outcome', error);
    }
  }

  /**
   * Export features for model retraining
   */
  async exportFeatures(filters?: {
    symbol?: string;
    from?: Date;
    to?: Date;
    hasOutcome?: boolean; // Only export completed trades
  }): Promise<Array<{
    id: number;
    symbol: string;
    timestamp: Date;
    features: FeatureVector;
    regime: RegimeType;
    mlScore: MLSignalScore | null;
    signalDirection: string | null;
    actualOutcome: string | null;
    actualPnL: number | null;
  }>> {
    if (!this.pool) {
      return [];
    }

    try {
      let query = `SELECT * FROM ml_feature_vectors WHERE 1=1`;
      const params: any[] = [];
      let paramIndex = 1;

      if (filters?.symbol) {
        query += ` AND symbol = $${paramIndex++}`;
        params.push(filters.symbol);
      }

      if (filters?.from) {
        query += ` AND timestamp >= $${paramIndex++}`;
        params.push(filters.from.toISOString());
      }

      if (filters?.to) {
        query += ` AND timestamp <= $${paramIndex++}`;
        params.push(filters.to.toISOString());
      }

      if (filters?.hasOutcome === true) {
        query += ` AND actual_outcome IS NOT NULL`;
      }

      query += ` ORDER BY timestamp DESC`;

      const result = await this.pool.query(query, params);

      return result.rows.map(row => ({
        id: row.id,
        symbol: row.symbol,
        timestamp: new Date(row.timestamp),
        features: JSON.parse(row.features),
        regime: row.regime as RegimeType,
        mlScore: row.ml_score ? JSON.parse(row.ml_score) : null,
        signalDirection: row.signal_direction,
        actualOutcome: row.actual_outcome,
        actualPnL: row.actual_pnl ? parseFloat(row.actual_pnl) : null,
      }));
    } catch (error) {
      logger.error('[FeatureStore] Failed to export features', error);
      return [];
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

