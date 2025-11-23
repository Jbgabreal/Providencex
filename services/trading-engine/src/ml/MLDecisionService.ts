/**
 * ML Decision Service (Trading Engine v13)
 * 
 * Merges ML predictions with SMC signals to make hybrid decisions
 */

import { Logger } from '@providencex/shared-utils';
import { RawSignal } from '../strategy/v3/types';
import { RegimeType, MLSignalScore, MLDecision, FeatureVector } from './types';
import { MLModelInterface } from './MLModelInterface';
import { getMLConfig } from './MLConfig';

const logger = new Logger('MLDecisionService');

/**
 * ML Decision Service - Combines ML predictions with SMC signals
 */
export class MLDecisionService {
  private mlModel: MLModelInterface | null = null;
  private config = getMLConfig();

  constructor(mlModel: MLModelInterface | null = null) {
    this.mlModel = mlModel;
  }

  /**
   * Set ML model
   */
  setModel(model: MLModelInterface | null): void {
    this.mlModel = model;
    if (model && model.isLoaded()) {
      logger.info('[MLDecisionService] ML model set and ready');
    }
  }

  /**
   * Evaluate ML decision for a signal
   */
  async evaluate(
    signal: RawSignal | null,
    regime: RegimeType,
    features: FeatureVector,
    mlScore: MLSignalScore | null
  ): Promise<MLDecision> {
    // If ML is disabled, always pass
    if (!this.config.enabled) {
      return {
        mlPass: true,
        mlReasons: ['ML layer disabled'],
        mlScore: null,
        regime,
        features: this.config.debug ? features : undefined,
      };
    }

    // If no model loaded, skip ML check but log warning
    if (!this.mlModel || !this.mlModel.isLoaded()) {
      logger.warn('[MLDecisionService] ML model not loaded - skipping ML check');
      return {
        mlPass: true,
        mlReasons: ['ML model not loaded - allowing trade'],
        mlScore: null,
        regime,
        features: this.config.debug ? features : undefined,
      };
    }

    // If no signal, skip (shouldn't happen, but defensive)
    if (!signal) {
      return {
        mlPass: false,
        mlReasons: ['No SMC signal provided'],
        mlScore,
        regime,
        features: this.config.debug ? features : undefined,
      };
    }

    // If ML score not provided, try to predict
    let score = mlScore;
    if (!score) {
      try {
        score = await this.mlModel.predict(features);
      } catch (error) {
        logger.error('[MLDecisionService] Failed to get ML prediction', error);
        return {
          mlPass: false,
          mlReasons: ['ML prediction failed'],
          mlScore: null,
          regime,
          features: this.config.debug ? features : undefined,
        };
      }
    }

    // Evaluate ML decision criteria
    const reasons: string[] = [];
    let pass = true;

    // Check 1: Confidence threshold
    if (score.confidence < this.config.minConfidence) {
      pass = false;
      reasons.push(`ML confidence too low: ${score.confidence.toFixed(3)} < ${this.config.minConfidence}`);
    } else {
      reasons.push(`ML confidence OK: ${score.confidence.toFixed(3)}`);
    }

    // Check 2: Win probability threshold
    if (score.probabilityWin < this.config.minWinProbability) {
      pass = false;
      reasons.push(`Win probability too low: ${score.probabilityWin.toFixed(3)} < ${this.config.minWinProbability}`);
    } else {
      reasons.push(`Win probability OK: ${score.probabilityWin.toFixed(3)}`);
    }

    // Check 3: Expected move distance
    if (score.expectedMove < this.config.minExpectedMove) {
      pass = false;
      reasons.push(`Expected move too small: ${score.expectedMove.toFixed(4)} < ${this.config.minExpectedMove}`);
    } else {
      reasons.push(`Expected move OK: ${score.expectedMove.toFixed(4)}`);
    }

    // Check 4: Regime compatibility with signal direction
    const regimeCompatible = this.isRegimeCompatible(signal.direction, regime);
    if (!regimeCompatible) {
      pass = false;
      reasons.push(`Regime ${regime} incompatible with ${signal.direction} signal`);
    } else {
      reasons.push(`Regime ${regime} compatible with ${signal.direction} signal`);
    }

    // Check 5: Avoid certain regimes unless explicitly allowed
    const dangerousRegimes: RegimeType[] = ['liquidity_grab', 'news_regime'];
    if (dangerousRegimes.includes(regime)) {
      // Only allow if explicitly whitelisted (for now, skip)
      pass = false;
      reasons.push(`Regime ${regime} is considered dangerous - skipping trade`);
    }

    // Check 6: SL/TP hit probabilities (risk management)
    if (score.probabilitySL > 0.7) {
      // High probability of SL hit - more cautious
      reasons.push(`Warning: High SL hit probability: ${score.probabilitySL.toFixed(3)}`);
      // Don't fail, but log warning
    }

    const decision: MLDecision = {
      mlPass: pass,
      mlReasons: reasons,
      mlScore: score,
      regime,
      features: this.config.debug ? features : undefined,
    };

    if (pass) {
      logger.debug(`[MLDecisionService] ML PASS for ${signal.symbol}: ${reasons.join('; ')}`);
    } else {
      logger.debug(`[MLDecisionService] ML SKIP for ${signal.symbol}: ${reasons.join('; ')}`);
    }

    return decision;
  }

  /**
   * Check if regime is compatible with signal direction
   */
  private isRegimeCompatible(direction: 'buy' | 'sell', regime: RegimeType): boolean {
    // Trending regimes align with direction
    if (regime === 'trending_up' && direction === 'buy') {
      return true;
    }
    if (regime === 'trending_down' && direction === 'sell') {
      return true;
    }

    // Ranging regimes can work for both directions (but less ideal)
    if (regime === 'ranging') {
      return true; // Allow but note it's less ideal
    }

    // Reversal zones might be good for counter-trend trades
    if (regime === 'trend_reversal_zone') {
      return true; // Could be good for reversals
    }

    // Volatile regimes are generally risky
    if (regime === 'volatile_expansion' || regime === 'volatile_contraction') {
      return true; // Allow but risky
    }

    // Dangerous regimes already handled above
    return false; // Default: incompatible
  }
}

