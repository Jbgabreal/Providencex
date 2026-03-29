import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:NkALJdRzDjZIERRYMZuhVhyjpokYQDqp@tramway.proxy.rlwy.net:36748/railway';
const pool = new pg.Pool({ connectionString: DATABASE_URL });

async function main() {
  console.log('Connecting to database...');

  // Insert new V25 H1 Momentum profile
  const result = await pool.query(`
    INSERT INTO strategy_profiles (key, name, description, implementation_key, risk_tier, is_public, is_frozen, config)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    ON CONFLICT (key) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      implementation_key = EXCLUDED.implementation_key,
      is_public = TRUE,
      updated_at = NOW()
    RETURNING id, key, name
  `, [
    'v25_h1_momentum_v1',
    'V25 H1 Momentum',
    'H1 regime-gated momentum with M15 pullback entry for V25 synthetic index. Research-grade — thresholds are defaults pending validation.',
    'V25_H1_MOMENTUM_V1',
    'low',
    true,
    false,
    JSON.stringify({
      autocorrWindow: 20, emaFastPeriod: 20, emaSlowPeriod: 50,
      efficiencyMin: 0.25, signPersistenceMin: 0.60,
      minImpulseAtrMult: 1.5, takeProfitR: 2.0, maxTradesPerDay: 3,
    }),
  ]);

  console.log('INSERTED:', JSON.stringify(result.rows[0]));

  // List all V25 profiles
  const all = await pool.query("SELECT key, name, is_public FROM strategy_profiles WHERE key LIKE '%v25%' OR key LIKE '%V25%'");
  console.log('V25 profiles:', JSON.stringify(all.rows, null, 2));

  // List all profiles
  const allProfiles = await pool.query("SELECT key, name, is_public FROM strategy_profiles ORDER BY key");
  console.log('\nAll profiles:');
  for (const row of allProfiles.rows) {
    console.log(`  ${row.is_public ? '✅' : '❌'} ${row.key} — ${row.name}`);
  }

  await pool.end();
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
