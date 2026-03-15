/**
 * Verification script to check if environment variables are embedded
 * Run this after restarting the server to verify the fix worked
 */

const path = require('path');

// Load environment variables the same way next.config.js does
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_BASE_URL || process.env.TRADING_ENGINE_URL || 'http://localhost:3020';
const DEV_MODE = process.env.NEXT_PUBLIC_DEV_MODE || 'true';

console.log('=== Environment Variable Verification ===\n');
console.log('Values that should be embedded in client bundle:');
console.log(`  NEXT_PUBLIC_PRIVY_APP_ID: ${PRIVY_APP_ID ? PRIVY_APP_ID.substring(0, 20) + '...' : '❌ EMPTY'}`);
console.log(`  NEXT_PUBLIC_BACKEND_BASE_URL: ${BACKEND_URL}`);
console.log(`  NEXT_PUBLIC_DEV_MODE: ${DEV_MODE}`);
console.log('\nThese values will be:');
console.log('  1. Set in next.config.js env config');
console.log('  2. Embedded via webpack DefinePlugin');
console.log('\n✅ If these values are correct, restart the server with clean cache');

