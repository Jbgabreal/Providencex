/**
 * Execution Filter v3
 * 
 * Evaluates raw signals with multi-confirmation logic:
 * - Multi-timeframe alignment
 * - Structural confirmations (BOS/CHOCH, liquidity sweep, displacement)
 * - Session and time-of-day constraints
 * - Trade frequency limits
 * - Additional risk filters
 */

import { Logger } from '@providencex/shared-utils';
import {
  RawSignal,
  ExecutionDecision,
  ExecutionAction,
  ExecutionFilterConfig,
  ExecutionFilterContext,
  SymbolExecutionRules,
  TimeframeContext,
} from './types';
import { getNowInPXTimezone } from '@providencex/shared-utils';
import { OpenTradesService } from '../../services/OpenTradesService';
import { OrderFlowService, OrderFlowSnapshot } from '../../services/OrderFlowService';
import { getOrderFlowConfig } from '@providencex/shared-config';
import { ExecutionFilterState, SymbolExposureSnapshot } from './ExecutionFilterState';
import { LossStreakFilterService } from '../../services/LossStreakFilterService';

const logger = new Logger('ExecutionFilter');

/**
 * Evaluate a raw signal against execution filter rules
 * 
 * @param signal - Raw signal from StrategyService
 * @param config - Execution filter configuration
 * @param ctx - Context (guardrail mode, spread, trade counts, etc.)
 * @param openTradesService - v4 OpenTradesService for exposure checks (optional for backward compatibility)
 * @param orderFlowService - v14: Optional order flow service
 * @param executionFilterState - ExecutionFilterState for DB-based exposure queries (optional for backward compatibility)
 * @returns Execution decision with action and reasons
 */
export async function evaluateExecution(
  signal: RawSignal,
  config: ExecutionFilterConfig,
  ctx: ExecutionFilterContext,
  openTradesService?: OpenTradesService,
  orderFlowService?: OrderFlowService, // v14: Optional order flow service
  executionFilterState?: ExecutionFilterState, // For DB-based exposure queries as fallback
  lossStreakFilterService?: LossStreakFilterService // v15: Optional loss streak filter service
): Promise<ExecutionDecision> {
  const reasons: string[] = [];
  const now = ctx.now || new Date();

  // Step 1: Look up symbol rules
  const symbol = signal.symbol.toUpperCase();
  const rules = config.rulesBySymbol[symbol];

  if (!rules || !rules.enabled) {
    return {
      action: 'SKIP',
      reasons: [`No execution rules configured for symbol ${symbol}`],
      normalizedSignal: signal,
    };
  }

  // Step 2: Check allowed directions
  if (!rules.allowedDirections.includes(signal.direction)) {
    reasons.push(`Direction ${signal.direction} not allowed for ${symbol}`);
  }

  // Step 3: Check news guardrail modes
  if (rules.blockNewsGuardrailModes && ctx.guardrailMode) {
    if (rules.blockNewsGuardrailModes.includes(ctx.guardrailMode)) {
      reasons.push(`Blocked by news guardrail mode: ${ctx.guardrailMode}`);
    }
  }

  // Step 4: Check session windows
  // If SMC v2 already validated session (sessionValid: true), trust it and skip hour-based check
  // Only use hour-based check if SMC metadata is not available or sessionValid is explicitly false
  const smcMeta = signal.smcMetadata;
  if (smcMeta?.sessionValid === true) {
    // SMC v2 validated session - skip hour-based check
    // Trust SMC's session validation (which respects SMC_LOW_ALLOWED_SESSIONS / SMC_HIGH_ALLOWED_SESSIONS)
  } else if (smcMeta?.sessionValid === false) {
    // SMC explicitly says session is invalid - add reason (will be added again at Step 8.5, but that's fine)
    reasons.push('Outside allowed trading sessions');
  } else {
    // No SMC session validation available - fall back to hour-based check
    if (!isWithinSession(now, rules.enabledSessions, config.timezone)) {
      reasons.push('Outside allowed trading sessions');
    }
  }

  // Step 5: Multi-timeframe alignment
  if (rules.requireHtfAlignment) {
    if (!isHtfAligned(signal.direction, signal.timeframeContext.htfTrend, rules)) {
      reasons.push(`HTF trend ${signal.timeframeContext.htfTrend} not aligned with signal direction`);
    }
  }

  // Step 6: BOS/CHOCH confirmation
  if (rules.requireBosInDirection) {
    if (!hasBosInDirection(signal.direction, signal.timeframeContext)) {
      reasons.push('BOS/CHOCH does not confirm direction');
    }
  }

  // Step 7: Liquidity sweep
  if (rules.requireLiquiditySweep) {
    if (!signal.smcMetadata?.liquiditySwept) {
      reasons.push('No liquidity sweep before entry');
    }
  }

  // Step 8: Displacement candle
  if (rules.requireDisplacementCandle) {
    if (!signal.smcMetadata?.displacementCandle) {
      reasons.push('No displacement candle confirming move');
    }
  }

  // Step 8.5: v10 SMC v2 specific checks (when available)
  // Note: smcMeta is already defined above (Step 4) for session check
  
  // Premium/Discount check (v2)
  if (smcMeta?.premiumDiscount) {
    const pd = smcMeta.premiumDiscount;
    // Buy in discount, sell in premium
    if (signal.direction === 'buy' && pd !== 'discount') {
      reasons.push(`Buy signal in ${pd} zone (should be discount)`);
    }
    if (signal.direction === 'sell' && pd !== 'premium') {
      reasons.push(`Sell signal in ${pd} zone (should be premium)`);
    }
  }

  // ITF Flow alignment check (v2)
  if (smcMeta?.itfFlow && smcMeta.itfFlow === 'counter') {
    reasons.push('ITF flow is counter to HTF trend');
  }

  // Session validity check (v2)
  // Note: Session check is handled in Step 4 above, but we keep this check for explicit false
  // to ensure SMC's session validation is always respected
  if (smcMeta?.sessionValid === false && !reasons.some(r => r.includes('Outside allowed trading sessions'))) {
    reasons.push(`Session not valid for ${symbol}`);
  }

  // FVG validity check (v2) - require at least one FVG level
  if (smcMeta?.fvgLevels) {
    const hasFVG = smcMeta.fvgLevels.htf || smcMeta.fvgLevels.itf || smcMeta.fvgLevels.ltf;
    if (!hasFVG) {
      reasons.push('No Fair Value Gap detected');
    }
  }

  // OB score check (v2) - require at least HTF + ITF OB alignment
  if (smcMeta?.orderBlockZone) {
    // OB zone exists - check if multiple TFs aligned (via meta if available)
    // This is a basic check - full alignment is validated in strategy layer
  }

  // Volume Imbalance alignment check (v2) - configurable hard/soft mode
  const requireVolumeImbalanceAlignment = config.requireVolumeImbalanceAlignment !== false; // Default: true (hard rule)
  
  if (smcMeta?.volumeImbalance && smcMeta.volumeImbalance.aligned === false) {
    // Log volume imbalance details for debugging
    const volumeImbalance = smcMeta.volumeImbalance;
    logger.debug(
      `[ExecutionFilter] [${symbol}] Volume imbalance check: zones=${volumeImbalance.zones?.length || 0}, aligned=${volumeImbalance.aligned}, direction=${signal.direction}`
    );
    
    if (requireVolumeImbalanceAlignment) {
      // HARD mode (current behavior) - block the trade
      logger.info(
        `[ExecutionFilter] [${symbol}] Volume Imbalance not aligned with OB + FVG - hard reject`
      );
      reasons.push('Volume Imbalance not aligned with OB + FVG');
    } else {
      // SOFT mode (new behavior) - log warning but continue evaluation
      logger.warn(
        `[ExecutionFilter] [${symbol}] Volume Imbalance not aligned with OB + FVG - SOFT mode, continuing evaluation`
      );
      // Do NOT add to reasons array - allow trade to proceed
      // Note: This info will still be visible in SMC metadata for observability
    }
  }

  // Confluence score check (v2) - require minimum score (per-symbol threshold)
  if (smcMeta?.confluenceScore !== undefined) {
    const minConfluenceScore = rules.minConfluenceScore || 65; // Default: 65, XAUUSD: 65 (v15b: relaxed from 70)
    if (smcMeta.confluenceScore < minConfluenceScore) {
      reasons.push(`Confluence score too low: ${smcMeta.confluenceScore} < ${minConfluenceScore} (required)`);
      logger.info(
        `[ExecutionFilter] [${symbol}] Reject trade - low confluence score: ` +
        `score=${smcMeta.confluenceScore}, min=${minConfluenceScore}, ` +
        `direction=${signal.direction}, ` +
        `PD=${smcMeta.premiumDiscount || 'unknown'}, ` +
        `reasons: ${smcMeta.confluenceReasons?.length || 0} confluences`
      );
    } else {
      logger.debug(
        `[ExecutionFilter] [${symbol}] Confluence score check passed: ` +
        `score=${smcMeta.confluenceScore} >= ${minConfluenceScore}, ` +
        `PD=${smcMeta.premiumDiscount || 'unknown'}`
      );
    }
  }

  // SMT Divergence check (v2) - optional but preferred
  if (smcMeta?.smtDivergence) {
    const smt = smcMeta.smtDivergence;
    // Check if divergence aligns with direction
    if (signal.direction === 'buy' && smt.bearish) {
      reasons.push('Bearish SMT divergence conflicts with buy signal');
    }
    if (signal.direction === 'sell' && smt.bullish) {
      reasons.push('Bullish SMT divergence conflicts with sell signal');
    }
  }

  // Step 9: Spread check (if configured)
  if (rules.maxSpreadPips !== undefined && ctx.spreadPips !== undefined) {
    if (ctx.spreadPips > rules.maxSpreadPips) {
      reasons.push(`Spread too wide (${ctx.spreadPips} > ${rules.maxSpreadPips} pips)`);
    }
  }

  // Step 10: Max trades per day
  if (ctx.todayTradeCountForSymbolStrategy !== undefined) {
    if (ctx.todayTradeCountForSymbolStrategy >= rules.maxTradesPerDay) {
      reasons.push(`Max trades per day reached for ${symbol}/${signal.strategyName} (${rules.maxTradesPerDay})`);
    }
  }

  // Step 11: Cooldown between trades
  if (ctx.lastTradeAtForSymbolStrategy) {
    const minutesSinceLastTrade = (now.getTime() - ctx.lastTradeAtForSymbolStrategy.getTime()) / (1000 * 60);
    if (minutesSinceLastTrade < rules.minMinutesBetweenTrades) {
      reasons.push(
        `Cooldown not satisfied: ${minutesSinceLastTrade.toFixed(1)} min < ${rules.minMinutesBetweenTrades} min`
      );
    }
  }

  // Step 11.5: Loss Streak Filter (v15) - Check if symbol is paused due to consecutive losses
  if (lossStreakFilterService) {
    try {
      const lossStreakCheck = await lossStreakFilterService.checkLossStreak(symbol);
      if (!lossStreakCheck.allowed) {
        reasons.push(lossStreakCheck.reason || `Loss streak pause active: ${lossStreakCheck.consecutiveLosses} consecutive losses`);
      } else if (lossStreakCheck.consecutiveLosses > 0) {
        logger.debug(`[ExecutionFilter] [${symbol}] Loss streak check passed (${lossStreakCheck.consecutiveLosses} consecutive losses, not paused)`);
      }
    } catch (error) {
      logger.error(`[ExecutionFilter] [${symbol}] Error checking loss streak (fail-open)`, error);
      // On error, allow trading (fail-open for safety)
    }
  }

  // Step 12: Max concurrent trades per symbol (v3 - from DB/state)
  if (ctx.openTradesForSymbol !== undefined) {
    if (ctx.openTradesForSymbol >= rules.maxConcurrentTradesPerSymbol) {
      reasons.push(`Max open trades reached for ${symbol} (${rules.maxConcurrentTradesPerSymbol})`);
    }
  }

  // Step 13: v4 Exposure & Concurrency checks (if OpenTradesService available)
  if (openTradesService) {
    let symbolSnapshot = openTradesService.getSnapshotForSymbol(symbol);
    const globalSnapshot = openTradesService.getGlobalSnapshot();

    // If snapshot is unavailable but exposure rules are configured, try DB fallback
    if (!symbolSnapshot && (rules.maxConcurrentTradesPerDirection !== undefined || rules.maxDailyRiskPerSymbol !== undefined)) {
      // Try DB fallback if ExecutionFilterState is available
      if (executionFilterState) {
        try {
          const dbSnapshot = await executionFilterState.getExposureSnapshot(symbol);
          // Convert DB snapshot to OpenTradesService format
          if (dbSnapshot.totalCount > 0) {
            symbolSnapshot = {
              symbol: dbSnapshot.symbol,
              longCount: dbSnapshot.longCount,
              shortCount: dbSnapshot.shortCount,
              totalCount: dbSnapshot.totalCount,
              estimatedRiskAmount: 0, // DB snapshot doesn't have risk amount, use 0
              lastUpdated: new Date(),
            };
            logger.debug(`[ExecutionFilter] [${symbol}] Using DB exposure snapshot: long=${dbSnapshot.longCount}, short=${dbSnapshot.shortCount}, total=${dbSnapshot.totalCount}`);
          } else {
            // Zero exposure - create empty snapshot to continue
            symbolSnapshot = {
              symbol: dbSnapshot.symbol,
              longCount: 0,
              shortCount: 0,
              totalCount: 0,
              estimatedRiskAmount: 0,
              lastUpdated: new Date(),
            };
            logger.debug(`[ExecutionFilter] [${symbol}] DB exposure snapshot shows zero exposure (no open trades)`);
          }
        } catch (err) {
          // DB query failed - conservative skip
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.warn(`[ExecutionFilter] [${symbol}] Failed to load exposure snapshot from DB - conservative skip: ${errorMessage}`);
          reasons.push('Exposure snapshot DB error - conservative skip');
        }
      } else {
        // No DB fallback available - in backtests or when ExecutionFilterState is not provided,
        // create a zero-exposure snapshot to continue (conservative: assume no open trades)
        symbolSnapshot = {
          symbol,
          longCount: 0,
          shortCount: 0,
          totalCount: 0,
          estimatedRiskAmount: 0,
          lastUpdated: new Date(),
        };
        logger.debug(`[ExecutionFilter] [${symbol}] No exposure snapshot available, assuming zero exposure (backtest mode)`);
        // Don't add to reasons - zero exposure is acceptable
      }
    }

    // Now check if we have a valid snapshot (either from OpenTradesService or DB fallback)
    if (symbolSnapshot && globalSnapshot) {
      // v4.1: Per-symbol concurrent trades (from real-time snapshot)
      if (rules.maxConcurrentTradesPerSymbol !== undefined) {
        if (symbolSnapshot.totalCount >= rules.maxConcurrentTradesPerSymbol) {
          reasons.push(
            `Max concurrent trades per symbol reached for ${symbol}: ${symbolSnapshot.totalCount} >= ${rules.maxConcurrentTradesPerSymbol}`
          );
        }
      }

      // v4.2: Per-direction concurrent trades (new)
      if (rules.maxConcurrentTradesPerDirection !== undefined) {
        const sideCount = signal.direction === 'buy' ? symbolSnapshot.longCount : symbolSnapshot.shortCount;
        if (sideCount >= rules.maxConcurrentTradesPerDirection) {
          reasons.push(
            `Max concurrent ${signal.direction} trades reached for ${symbol}: ${sideCount} >= ${rules.maxConcurrentTradesPerDirection}`
          );
        }
      }

      // v4.3: Global concurrent trades (new)
      if (config.maxConcurrentTradesGlobal !== undefined) {
        if (globalSnapshot.totalOpenTrades >= config.maxConcurrentTradesGlobal) {
          reasons.push(
            `Max global concurrent trades reached: ${globalSnapshot.totalOpenTrades} >= ${config.maxConcurrentTradesGlobal}`
          );
        }
      }

      // v4.4: Per-symbol daily risk (new)
      if (rules.maxDailyRiskPerSymbol !== undefined) {
        if (symbolSnapshot.estimatedRiskAmount >= rules.maxDailyRiskPerSymbol) {
          reasons.push(
            `Max daily risk for ${symbol} reached: ${symbolSnapshot.estimatedRiskAmount.toFixed(2)} >= ${rules.maxDailyRiskPerSymbol}`
          );
        }
      }

      // v4.5: Global daily risk (new)
      if (config.maxDailyRiskGlobal !== undefined) {
        if (globalSnapshot.totalEstimatedRiskAmount >= config.maxDailyRiskGlobal) {
          reasons.push(
            `Max global daily risk reached: ${globalSnapshot.totalEstimatedRiskAmount.toFixed(2)} >= ${config.maxDailyRiskGlobal}`
          );
        }
      }

      // Log exposure context for debugging
      if (reasons.length > 0) {
        logger.debug(`[${symbol}] v4 Exposure check details`, {
          symbol,
          direction: signal.direction,
          symbolSnapshot: {
            longCount: symbolSnapshot.longCount,
            shortCount: symbolSnapshot.shortCount,
            totalCount: symbolSnapshot.totalCount,
            estimatedRiskAmount: symbolSnapshot.estimatedRiskAmount,
          },
          globalSnapshot: {
            totalOpenTrades: globalSnapshot.totalOpenTrades,
            totalEstimatedRiskAmount: globalSnapshot.totalEstimatedRiskAmount,
          },
          configThresholds: {
            maxConcurrentTradesPerSymbol: rules.maxConcurrentTradesPerSymbol,
            maxConcurrentTradesPerDirection: rules.maxConcurrentTradesPerDirection,
            maxConcurrentTradesGlobal: config.maxConcurrentTradesGlobal,
            maxDailyRiskPerSymbol: rules.maxDailyRiskPerSymbol,
            maxDailyRiskGlobal: config.maxDailyRiskGlobal,
          },
        });
      }
    }
  }

  // Step 14: Distance from daily high/low (optional)
  if (
    rules.minDistanceFromDailyHighLowPips !== undefined &&
    ctx.currentPrice !== undefined &&
    ctx.dailyHigh !== undefined &&
    ctx.dailyLow !== undefined
  ) {
    const distanceFromHigh = ctx.dailyHigh - ctx.currentPrice;
    const distanceFromLow = ctx.currentPrice - ctx.dailyLow;
    
    // Convert to pips (simplified - assumes same conversion as spread)
    const distanceFromHighPips = distanceFromHigh / (signal.entryPrice * 0.0001); // Approximation
    const distanceFromLowPips = distanceFromLow / (signal.entryPrice * 0.0001); // Approximation

    if (signal.direction === 'buy' && distanceFromHighPips < rules.minDistanceFromDailyHighLowPips) {
      reasons.push(`Too close to daily high (${distanceFromHighPips.toFixed(1)} pips)`);
    }
    if (signal.direction === 'sell' && distanceFromLowPips < rules.minDistanceFromDailyHighLowPips) {
      reasons.push(`Too close to daily low (${distanceFromLowPips.toFixed(1)} pips)`);
    }
  }

  // Step 15: v14 Order Flow Checks (if OrderFlowService available)
  if (orderFlowService && orderFlowService.isEnabled() && orderFlowService.isServiceRunning()) {
    const orderFlowSnapshot = orderFlowService.getSnapshot(signal.symbol);
    
    if (orderFlowSnapshot) {
      // Get order flow config (synchronous)
      const orderFlowConfig = getOrderFlowConfig();
      const minDeltaTrendConfirmation = orderFlowConfig.minDeltaTrendConfirmation || 50;
      const exhaustionThreshold = orderFlowConfig.exhaustionThreshold || 70;
      
      // Condition 1: No Trade Against Strong Delta
      const delta15s = orderFlowSnapshot.delta15s;
      
      // Check if delta opposes trade direction
      if (signal.direction === 'buy' && delta15s < -minDeltaTrendConfirmation) {
        reasons.push(`orderflow_delta_conflict: Strong selling pressure (delta15s=${delta15s.toFixed(2)}) opposes buy signal`);
      }
      if (signal.direction === 'sell' && delta15s > minDeltaTrendConfirmation) {
        reasons.push(`orderflow_delta_conflict: Strong buying pressure (delta15s=${delta15s.toFixed(2)}) opposes sell signal`);
      }
      
      // Condition 2: Avoid Reversal Exhaustion
      const deltaMomentum = orderFlowSnapshot.deltaMomentum;
      
      // Check if delta collapses after spike (exhaustion pattern)
      if (Math.abs(delta15s) > exhaustionThreshold && Math.abs(deltaMomentum) < 10) {
        reasons.push(`orderflow_exhaustion: Delta spike collapsed (delta15s=${delta15s.toFixed(2)}, momentum=${deltaMomentum.toFixed(2)})`);
      }
      
      // Condition 3: Confirm Trend Continuation
      // Require delta15s to agree with signal direction
      if (signal.direction === 'buy' && delta15s < 0) {
        reasons.push(`orderflow_no_buy_pressure: No buying pressure confirmed (delta15s=${delta15s.toFixed(2)})`);
      }
      if (signal.direction === 'sell' && delta15s > 0) {
        reasons.push(`orderflow_no_sell_pressure: No selling pressure confirmed (delta15s=${delta15s.toFixed(2)})`);
      }
      
      // Condition 4: Large Opposing Orders
      const largeOrdersAgainst = signal.direction === 'buy' 
        ? orderFlowSnapshot.largeSellOrders 
        : orderFlowSnapshot.largeBuyOrders;
      
      if (largeOrdersAgainst >= 3) { // Threshold: 3+ large orders against
        reasons.push(`orderflow_large_orders_against: ${largeOrdersAgainst} large ${signal.direction === 'buy' ? 'sell' : 'buy'} orders detected`);
      }
      
      // Condition 5: Absorption Detection
      if (signal.direction === 'buy' && orderFlowSnapshot.absorptionSell) {
        reasons.push(`orderflow_absorption_detected: Sell absorption detected (buyers absorbing sell pressure)`);
      }
      if (signal.direction === 'sell' && orderFlowSnapshot.absorptionBuy) {
        reasons.push(`orderflow_absorption_detected: Buy absorption detected (sellers absorbing buy pressure)`);
      }
    } else {
      // Order flow snapshot not available - log but don't fail (backward compatible)
      logger.debug(`[${symbol}] Order flow snapshot not available - skipping order flow checks`);
    }
  } else {
    // Order flow service not available - log but continue (backward compatible)
    if (!orderFlowService || !orderFlowService.isEnabled()) {
      logger.debug(`[${symbol}] Order flow disabled - skipping order flow checks`);
    }
  }

  // Decision: If any reasons, SKIP; otherwise TRADE
  const action: ExecutionAction = reasons.length > 0 ? 'SKIP' : 'TRADE';

  if (action === 'TRADE') {
    logger.debug(`[${symbol}] Execution filter PASSED for ${signal.direction} signal`);
  } else {
    logger.debug(`[${symbol}] Execution filter SKIPPED: ${reasons.join('; ')}`);
  }

  return {
    action,
    reasons: action === 'TRADE' ? [] : reasons,
    normalizedSignal: signal, // For now, no normalization; future: adjust lot size, SL/TP
  };
}

/**
 * Check if current time is within any enabled session window
 */
function isWithinSession(
  now: Date,
  sessions: SymbolExecutionRules['enabledSessions'],
  timezone: string
): boolean {
  if (sessions.length === 0) {
    return true; // No session restriction = always allowed
  }

  // Get current hour in the configured timezone
  // Using getNowInPXTimezone helper which handles timezone conversion
  // Note: getNowInPXTimezone uses America/New_York by default
  // If config.timezone differs, we need to adjust
  const tzNow = getNowInPXTimezone();
  const currentHour = tzNow.hour;

  // Check if current hour is within any session window
  for (const session of sessions) {
    if (session.startHour <= session.endHour) {
      // Normal session (e.g., 8 AM - 4 PM)
      if (currentHour >= session.startHour && currentHour < session.endHour) {
        return true;
      }
    } else {
      // Overnight session (e.g., 10 PM - 2 AM)
      if (currentHour >= session.startHour || currentHour < session.endHour) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if HTF trend aligns with signal direction
 */
function isHtfAligned(
  direction: RawSignal['direction'],
  htfTrend: TimeframeContext['htfTrend'],
  rules: SymbolExecutionRules
): boolean {
  if (!rules.allowedHtfTrends.includes(htfTrend)) {
    return false;
  }

  // For BUY: require bullish or range (if range is allowed)
  if (direction === 'buy') {
    return htfTrend === 'bullish' || (htfTrend === 'range' && rules.allowedHtfTrends.includes('range'));
  }

  // For SELL: require bearish or range (if range is allowed)
  if (direction === 'sell') {
    return htfTrend === 'bearish' || (htfTrend === 'range' && rules.allowedHtfTrends.includes('range'));
  }

  return false;
}

/**
 * Check if BOS/CHOCH confirms signal direction
 */
function hasBosInDirection(direction: RawSignal['direction'], timeframeContext: TimeframeContext): boolean {
  // Prefer BOS direction if available
  if (timeframeContext.lastBosDirection) {
    if (direction === 'buy') {
      return timeframeContext.lastBosDirection === 'bullish';
    }
    if (direction === 'sell') {
      return timeframeContext.lastBosDirection === 'bearish';
    }
  }

  // Fallback to CHOCH direction if BOS not available
  if (timeframeContext.lastChochDirection) {
    if (direction === 'buy') {
      return timeframeContext.lastChochDirection === 'bullish';
    }
    if (direction === 'sell') {
      return timeframeContext.lastChochDirection === 'bearish';
    }
  }

  // If neither available, fail (conservative)
  return false;
}

