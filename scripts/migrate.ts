/**
 * Database migration runner for Railway deployment.
 * Runs all SQL migrations in order against DATABASE_URL.
 *
 * Usage: tsx scripts/migrate.ts
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../services/trading-engine/src/db/migrations');

// Ordered list of migrations
const MIGRATION_FILES = [
  'v7_v8_execution_v3.sql',
  'v9_exit_engine.sql',
  'v15_historical_candles.sql',
  'v16_multi_tenant_trading.sql',
  'v17_analytics_tables.sql',
  'v18_ict_strategy_profile.sql',
  'v19_user_trading_config.sql',
  'v20_broker_adapter.sql',
  'v21_copy_trading.sql',
  'v22_mentor_profile_metadata.sql',
  // Phase 2: Crypto billing
  'v23_crypto_billing.sql',
  // Phase 3: Referral program
  'v24_referral_program.sql',
  // Phase 4: Follower safety controls
  'v25_follower_safety.sql',
  // Phase 5: Notifications
  'v26_notifications.sql',
  // Phase 6: Marketplace maturity
  'v27_marketplace_maturity.sql',
  // Phase 7: Signal ingestion
  'v28_signal_ingestion.sql',
  // Phase 8: Shadow mode
  'v29_shadow_mode.sql',
  // Phase 9: Admin operations
  'v30_admin_operations.sql',
  // Phase 10: Intelligence
  'v31_intelligence.sql',
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
  });

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Check which migrations have been applied
  const applied = await pool.query('SELECT name FROM _migrations');
  const appliedSet = new Set(applied.rows.map((r: any) => r.name));

  let ranCount = 0;
  for (const file of MIGRATION_FILES) {
    if (appliedSet.has(file)) {
      console.log(`  SKIP  ${file} (already applied)`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  WARN  ${file} not found, skipping`);
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf-8');
    console.log(`  RUN   ${file}...`);

    try {
      await pool.query(sql);
      await pool.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
      console.log(`  OK    ${file}`);
      ranCount++;
    } catch (err: any) {
      console.error(`  FAIL  ${file}: ${err.message}`);
      // Continue with other migrations — some may have partial idempotency
    }
  }

  console.log(`\nDone. ${ranCount} migration(s) applied, ${MIGRATION_FILES.length - ranCount} skipped.`);
  await pool.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
