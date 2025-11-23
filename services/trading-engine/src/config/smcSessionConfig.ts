/**
 * SMC Session Configuration
 * 
 * Reads session configuration from environment variables for SMC v2 strategy
 * Supports separate configurations for 'low' and 'high' strategies
 */

import { SessionName } from '@providencex/shared-types';

export interface SMCSessionConfig {
  low: SessionName[];
  high: SessionName[];
}

/**
 * Parse comma-separated session string to SessionName array
 * Maps 'ny' -> 'newyork' for convenience
 */
function parseSessions(sessionStr: string | undefined, defaultSessions: SessionName[]): SessionName[] {
  if (!sessionStr || !sessionStr.trim()) {
    return defaultSessions;
  }

  const sessions = sessionStr
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0)
    .map(s => {
      // Map 'ny' -> 'newyork' for convenience
      if (s === 'ny') {
        return 'newyork';
      }
      return s as SessionName;
    })
    .filter((s): s is SessionName => 
      s === 'london' || s === 'newyork' || s === 'asian' || s === 'all'
    );

  // If no valid sessions parsed, return default
  if (sessions.length === 0) {
    return defaultSessions;
  }

  return sessions;
}

/**
 * Get SMC session configuration
 * Reads from environment variables:
 * - SMC_LOW_ALLOWED_SESSIONS (e.g. "london,ny,asian")
 * - SMC_HIGH_ALLOWED_SESSIONS (e.g. "london,ny")
 * 
 * Defaults to ['london', 'newyork'] when env vars are not set (backward compatible)
 */
export function getSMCSessionConfig(): SMCSessionConfig {
  const lowSessions = parseSessions(
    process.env.SMC_LOW_ALLOWED_SESSIONS,
    ['london', 'newyork'] // Default: backward compatible
  );

  const highSessions = parseSessions(
    process.env.SMC_HIGH_ALLOWED_SESSIONS,
    ['london', 'newyork'] // Default: backward compatible
  );

  return {
    low: lowSessions,
    high: highSessions,
  };
}

/**
 * Get allowed sessions for a specific strategy
 */
export function getAllowedSessions(strategy: 'low' | 'high'): SessionName[] {
  const config = getSMCSessionConfig();
  return config[strategy];
}

/**
 * Log session configuration at startup (for debugging)
 */
export function logSessionConfig(): void {
  const config = getSMCSessionConfig();
  const lowEnv = process.env.SMC_LOW_ALLOWED_SESSIONS;
  const highEnv = process.env.SMC_HIGH_ALLOWED_SESSIONS;
  
  // eslint-disable-next-line no-console
  console.log(`[SMC Session Config] Low strategy allowed sessions: [${config.low.join(', ')}] ${lowEnv ? `(from env: ${lowEnv})` : '(default)'}`);
  // eslint-disable-next-line no-console
  console.log(`[SMC Session Config] High strategy allowed sessions: [${config.high.join(', ')}] ${highEnv ? `(from env: ${highEnv})` : '(default)'}`);
}

