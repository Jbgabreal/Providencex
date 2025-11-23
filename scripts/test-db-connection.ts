import { getNewsGuardrailConfig } from '@providencex/shared-config';
import { Pool } from 'pg';

async function testConnection() {
  const config = getNewsGuardrailConfig();
  
  console.log('Testing database connection...');
  console.log(`Host: ${config.databaseUrl.replace(/:[^:]+@/, ':****@')}`);
  
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes('localhost') 
      ? false 
      : { rejectUnauthorized: false },
  });

  try {
    const result = await pool.query('SELECT NOW() as current_time, version() as version');
    console.log('✅ Connection successful!');
    console.log('Current time:', result.rows[0].current_time);
    console.log('PostgreSQL version:', result.rows[0].version.split(',')[0]);
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed!');
    if (error instanceof Error) {
      console.error('Error:', error.message);
      if (error.message.includes('ENOTFOUND')) {
        console.error('\n💡 This usually means:');
        console.error('   1. Your Supabase project is PAUSED (most common)');
        console.error('   2. Go to supabase.com/dashboard and RESTORE your project');
        console.error('   3. Or the hostname is incorrect - verify in Supabase Settings → Database');
      }
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();

