import axios from 'axios';
import { CanTradeResponse, NewsWindow } from '@providencex/shared-types';
import { getConfig } from '../config';
import { Logger } from '@providencex/shared-utils';
import { GuardrailDecision, Strategy, GuardrailMode } from '../types';
import { getNowInPXTimezone, parseToPXTimezone } from '@providencex/shared-utils';

const logger = new Logger('GuardrailService');

/**
 * GuardrailService - Calls News Guardrail API with strategy parameter
 * Maps response to GuardrailDecision with mode (normal/reduced/blocked)
 */
export class GuardrailService {
  private newsGuardrailUrl: string;

  constructor() {
    const config = getConfig();
    this.newsGuardrailUrl = config.newsGuardrailUrl;
  }

  /**
   * Get guardrail decision for a specific strategy
   * Calls: GET {NEWS_GUARDRAIL_URL}/can-i-trade-now?strategy={low|high}
   */
  async getDecision(strategy: Strategy): Promise<GuardrailDecision> {
    try {
      const response = await axios.get<CanTradeResponse>(
        `${this.newsGuardrailUrl}/can-i-trade-now`,
        {
          params: { strategy },
        }
      );

      const data = response.data;
      
      // Determine mode based on response and risk scores
      const mode = this.determineMode(data, strategy);
      const active_windows = data.active_window ? [data.active_window] : [];
      
      // Build reason summary
      const reason_summary = this.buildReasonSummary(data, mode, active_windows);

      return {
        can_trade: data.can_trade && mode !== 'blocked',
        mode,
        active_windows,
        reason_summary,
      };
    } catch (error) {
      // Log concise error message instead of full error object
      if (axios.isAxiosError(error)) {
        const errorCode = error.code || 'UNKNOWN';
        const errorMessage = error.message || 'Unknown error';
        
        // Only log detailed error on first failure or if it's not a connection error
        if (errorCode === 'ECONNREFUSED' || errorCode === 'ETIMEDOUT' || errorCode === 'ENOTFOUND') {
          // Connection errors: log once per minute (approximate) to reduce noise
          // Use a simple approach - log with reduced detail
          logger.warn(
            `Guardrail service unavailable (${errorCode}): ${this.newsGuardrailUrl} - blocking trades for safety`
          );
        } else {
          // Other errors: log with more detail
          logger.error(
            `Failed to get guardrail decision: ${errorCode} - ${errorMessage}`,
            { url: `${this.newsGuardrailUrl}/can-i-trade-now`, strategy }
          );
        }
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to get guardrail decision: ${errorMessage}`);
      }
      
      // Fail-safe: if guardrail is down, default to blocked mode for safety
      return {
        can_trade: false,
        mode: 'blocked',
        active_windows: [],
        reason_summary: 'Guardrail service unavailable - blocking trades for safety',
      };
    }
  }

  /**
   * Determine guardrail mode based on response and strategy rules.
   *
   * The news-guardrail service now handles look-ahead in canTradeNow, so
   * `data.can_trade = false` covers both "currently inside window" and
   * "upcoming high-risk event within the look-ahead horizon".
   * We still apply strategy-specific risk_score thresholds for the active window.
   */
  private determineMode(data: CanTradeResponse, strategy: Strategy): GuardrailMode {
    if (!data.can_trade) {
      return 'blocked';
    }

    if (!data.active_window) {
      return 'normal';
    }

    const window = data.active_window;
    const riskScore = window.risk_score ?? 0;

    if (strategy === 'low') {
      // Low risk strategy: block on any event with risk_score >= 30
      if (riskScore >= 30) return 'blocked';
      // Reduced mode for minor events (risk_score 15–29)
      if (riskScore >= 15) return 'reduced';
      return 'normal';
    } else {
      // High risk strategy: hard block at risk_score >= 80
      if (riskScore >= 80) return 'blocked';
      // Reduced mode for medium events (risk_score 40–79)
      if (riskScore >= 40) return 'reduced';
      return 'normal';
    }
  }

  /**
   * Build reason summary for logging
   */
  private buildReasonSummary(
    data: CanTradeResponse,
    mode: GuardrailMode,
    active_windows: NewsWindow[]
  ): string {
    if (mode === 'blocked') {
      if (active_windows.length > 0) {
        const window = active_windows[0];
        return `Blocked: ${window.event_name} (risk_score: ${window.risk_score}) - ${window.reason}`;
      }
      return 'Blocked: Guardrail service indicates trading is not safe';
    }

    if (mode === 'reduced') {
      if (active_windows.length > 0) {
        const window = active_windows[0];
        return `Reduced mode: ${window.event_name} (risk_score: ${window.risk_score}) - Trading allowed with reduced risk`;
      }
      return 'Reduced mode: Medium risk event detected';
    }

    if (data.inside_avoid_window && active_windows.length > 0) {
      const window = active_windows[0];
      return `Normal mode with active window: ${window.event_name} (risk_score: ${window.risk_score})`;
    }

    return 'Normal mode: No active avoid windows';
  }
}
