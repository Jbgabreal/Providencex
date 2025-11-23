/**
 * SessionFilterService - Session-based trade filtering (SMC v2)
 * 
 * Filters trades based on trading sessions (London, New York, Asian)
 * Each symbol has custom session mapping
 */

import { Logger } from '@providencex/shared-utils';
import { getNowInPXTimezone } from '@providencex/shared-utils';
import { SessionName } from '@providencex/shared-types';
import { getAllowedSessions } from '../../config/smcSessionConfig';

const logger = new Logger('SessionFilterService');

export interface SessionConfig {
  symbol: string;
  allowedSessions: SessionName[];
  timezone?: string;
}

export class SessionFilterService {
  private sessionMap: Record<string, SessionName[]>;
  private timezone: string;

  constructor(
    sessionMap: Record<string, SessionName[]> = {},
    timezone: string = 'America/New_York'
  ) {
    // Default session map
    this.sessionMap = {
      XAUUSD: ['london', 'newyork'],
      EURUSD: ['london', 'newyork'],
      GBPUSD: ['london', 'newyork'],
      US30: ['newyork'],
      ...sessionMap,
    };
    this.timezone = timezone;
  }

  /**
   * Check if current session is valid for trading a symbol
   * @param symbol Symbol to check
   * @param currentTime Optional current time (defaults to now)
   * @param strategy Optional strategy type ('low' | 'high') - uses SMC session config if provided
   * @returns Validation result with ok flag and reason
   */
  validateSession(symbol: string, currentTime?: Date, strategy?: 'low' | 'high'): { ok: boolean; reason: string | null; currentSession: SessionName; allowedSessions: SessionName[] } {
    const now = currentTime || getNowInPXTimezone().setZone(this.timezone).toJSDate();
    const currentSession = this.getCurrentSession(now);

    // If strategy is provided, use SMC session config
    // Otherwise, fall back to symbol-specific session map (backward compatible)
    let allowedSessions: SessionName[];
    
    if (strategy) {
      // Use SMC session config for the specified strategy
      allowedSessions = getAllowedSessions(strategy);
    } else {
      // Fall back to symbol-specific session map (backward compatible)
      allowedSessions = this.sessionMap[symbol] || ['all'];
    }
    
    // If 'all' sessions allowed, always valid
    if (allowedSessions.includes('all')) {
      return {
        ok: true,
        reason: null,
        currentSession,
        allowedSessions,
      };
    }

    const isValid = allowedSessions.includes(currentSession);
    
    // Build reason message
    const reason = isValid 
      ? null 
      : `Session not valid (current session: ${currentSession}, allowed: ${allowedSessions.join(', ')})`;
    
    // Debug logging for session detection (always log in debug mode, or when invalid)
    const smcDebug = process.env.SMC_DEBUG === 'true';
    if (smcDebug || !isValid) {
      logger.info(
        `[SMC_DEBUG] ${symbol}: Session check - current=${currentSession}, allowed=[${allowedSessions.join(', ')}], strategy=${strategy || 'symbol-map'}, isValid=${isValid}`
      );
    }

    return {
      ok: isValid,
      reason,
      currentSession,
      allowedSessions,
    };
  }

  /**
   * Check if current session is valid for trading a symbol (backward compatible)
   * @deprecated Use validateSession() instead for better error reporting
   */
  isSessionValid(symbol: string, currentTime?: Date): boolean {
    const result = this.validateSession(symbol, currentTime);
    return result.ok;
  }

  /**
   * Get current trading session
   * Uses New York timezone for accurate session detection (matches News Guardrail)
   */
  private getCurrentSession(date: Date): SessionName {
    // Convert to New York timezone for accurate session boundaries
    // Using Intl.DateTimeFormat for timezone conversion (no external dependencies needed)
    const nyTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hour12: false,
      day: 'numeric',
    }).formatToParts(date);
    
    const hour = parseInt(nyTime.find(part => part.type === 'hour')?.value || '0', 10);
    const dayOfWeek = date.getUTCDay(); // 0 = Sunday, 6 = Saturday

    // Asian session: 23:00 NY (prev day) - 08:00 NY (Monday-Saturday)
    // Simplified: Check if within Asian trading hours in NY time
    if ((hour >= 23 || hour < 8) && dayOfWeek >= 1 && dayOfWeek <= 6) {
      // Early morning NY time = Asian session overlap
      if (hour >= 0 && hour < 8) {
        return 'asian';
      }
    }

    // London session: 03:00 NY - 12:00 NY (Monday-Friday)
    // This is 08:00 - 17:00 London time (GMT)
    if (hour >= 3 && hour < 12 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      return 'london';
    }

    // New York session: 08:00 NY - 17:00 NY (Monday-Friday)
    // This is 13:00 - 22:00 UTC
    if (hour >= 8 && hour < 17 && dayOfWeek >= 1 && dayOfWeek <= 5) {
      return 'newyork';
    }

    // After hours or weekend: determine based on nearest session
    // During weekend, default to 'asian' for next week's opening
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return 'asian'; // Weekend - next session will be Asian
    }

    // Outside trading hours on weekdays: return based on time
    if (hour >= 17 && hour < 23) {
      return 'newyork'; // Late NY hours - still NY session window
    }

    // Default fallback
    return 'asian';
  }

  /**
   * Get current session for a symbol (always returns a session name for debugging)
   * Returns the detected session even if it's not allowed for the symbol
   */
  getCurrentSessionForSymbol(symbol: string, currentTime?: Date): SessionName {
    const now = currentTime || getNowInPXTimezone().setZone(this.timezone).toJSDate();
    const currentSession = this.getCurrentSession(now);
    
    // Always return the detected session for debugging purposes
    // Don't return undefined - we want to see what session was detected
    return currentSession;
  }

  /**
   * Update session map for a symbol
   */
  updateSessionMap(symbol: string, allowedSessions: SessionName[]): void {
    this.sessionMap[symbol] = allowedSessions;
    logger.info(`[SessionFilter] Updated session map for ${symbol}: ${allowedSessions.join(', ')}`);
  }
}
