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
      logger.error('Failed to get guardrail decision', error);
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
   * Determine guardrail mode based on response and strategy rules
   */
  private determineMode(data: CanTradeResponse, strategy: Strategy): GuardrailMode {
    if (!data.can_trade) {
      return 'blocked';
    }

    if (!data.active_window) {
      return 'normal';
    }

    const window = data.active_window;
    const riskScore = window.risk_score;

    // Apply strategy-specific rules
    if (strategy === 'low') {
      // Low risk: block if risk_score >= 30
      if (riskScore >= 30) {
        return 'blocked';
      }
      // Low risk: check for upcoming high-risk windows (risk_score >= 70 within 45 min)
      // This would need additional logic to check future windows
      return 'normal';
    } else {
      // High risk: hard block if risk_score >= 80
      if (riskScore >= 80) {
        return 'blocked';
      }
      // High risk: reduced mode if risk_score in [50, 79]
      if (riskScore >= 50 && riskScore < 80) {
        return 'reduced';
      }
      // High risk: check for upcoming very high risk (risk_score >= 90 within 30 min)
      // This would need additional logic to check future windows
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
