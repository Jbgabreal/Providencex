/**
 * Environment Configuration
 * 
 * CRITICAL: In Next.js, NEXT_PUBLIC_* variables are replaced at BUILD TIME by webpack.
 * We MUST access them directly as process.env.KEY (no conditionals) so webpack can replace them.
 */

// Helper to get env var - webpack will replace process.env.KEY with the actual value at build time
function getEnvVar(key: string, defaultValue?: string): string {
  // CRITICAL: Access process.env directly - webpack DefinePlugin will replace this
  // Do NOT use conditionals like typeof process !== 'undefined' - that prevents replacement
  const value = process.env[key];
  
  // Empty string or undefined means missing
  if (!value && !defaultValue) {
    const message = `Missing required environment variable: ${key}\n\n` +
      `Please ensure it's in services/client-portal/.env.local\n` +
      `For Privy App ID: https://dashboard.privy.io/`;
    throw new Error(message);
  }
  
  return value || defaultValue!;
}

// CRITICAL: Access process.env directly - webpack will replace these at build time
// No conditionals, no typeof checks - just direct access
export const env = {
  privyAppId: process.env.NEXT_PUBLIC_PRIVY_APP_ID || '',
  // Use API Gateway as the backend URL (port 3000)
  // API Gateway will route requests to the appropriate backend services
  backendBaseUrl: process.env.NEXT_PUBLIC_BACKEND_BASE_URL || 
                  process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
                  process.env.API_GATEWAY_URL ||
                  'http://localhost:3000',
  devMode: process.env.NEXT_PUBLIC_DEV_MODE === 'true',
} as const;

// Validate required variables at module load time
if (!env.privyAppId) {
  throw new Error(
    'Missing NEXT_PUBLIC_PRIVY_APP_ID. Add it to services/client-portal/.env.local'
  );
}

