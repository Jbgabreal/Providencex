import { Pool } from 'pg';
import { getNewsGuardrailConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';

const logger = new Logger('DB');

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const config = getNewsGuardrailConfig();
    pool = new Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      logger.error('Unexpected database error', err);
    });
  }

  return pool;
}

export async function initializeDatabase(): Promise<void> {
  const pool = getDbPool();
  const schema = `
    CREATE TABLE IF NOT EXISTS daily_news_windows (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL UNIQUE,
      avoid_windows JSONB NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_daily_news_windows_date ON daily_news_windows(date);
    
    -- GIN index for efficient JSONB queries
    CREATE INDEX IF NOT EXISTS idx_daily_news_windows_avoid_windows_gin 
    ON daily_news_windows USING GIN (avoid_windows);
    
    -- Clean up any manually added columns that shouldn't exist
    -- (These would be NULL since we store everything in JSONB)
    DO $$ 
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'daily_news_windows' 
        AND column_name = 'is_critical'
      ) THEN
        ALTER TABLE daily_news_windows DROP COLUMN IF EXISTS is_critical;
        ALTER TABLE daily_news_windows DROP COLUMN IF EXISTS risk_score;
        ALTER TABLE daily_news_windows DROP COLUMN IF EXISTS reason;
        ALTER TABLE daily_news_windows DROP COLUMN IF EXISTS detailed_description;
      END IF;
    END $$;
  `;

  try {
    await pool.query(schema);
    logger.info('Database schema initialized');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    logger.error(`Failed to initialize database schema: ${errorMessage}`, { error: errorMessage, stack: errorStack });
    throw error;
  }
}

