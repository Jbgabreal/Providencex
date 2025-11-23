/**
 * EntryRefinementService - LTF Entry Refinement (M1) (SMC v2)
 * 
 * Refines entry using LTF (M1) analysis:
 * - Requires LTF BOS in direction of HTF trend
 * - Requires LTF sweep
 * - Requires LTF ref OB
 * - Requires FVG fill
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { MarketStructureLTF } from './MarketStructureLTF';
import { OrderBlockV2 } from './types';

const logger = new Logger('EntryRefinementService');

export interface EntryRefinementResult {
  refined: boolean;
  ltfBOSConfirmed: boolean;
  ltfSweepConfirmed: boolean;
  ltfOBConfirmed: boolean;
  fvgResolved: boolean;
  refinedOB?: OrderBlockV2;
  reasons: string[];
}

export class EntryRefinementService {
  private ltfStructure: MarketStructureLTF;

  constructor() {
    this.ltfStructure = new MarketStructureLTF(20);
  }

  /**
   * Refine entry using LTF analysis
   */
  refineEntry(
    ltfCandles: Candle[],
    htfTrend: 'bullish' | 'bearish' | 'sideways',
    ltfOB: OrderBlockV2 | undefined,
    ltfFVGResolved: boolean,
    ltfSweepConfirmed: boolean
  ): EntryRefinementResult {
    const reasons: string[] = [];

    // 1. Check LTF BOS in direction of HTF trend
    const ltfStructure = this.ltfStructure.analyzeStructure(ltfCandles, htfTrend);
    const ltfBOSConfirmed = !!ltfStructure.lastBOS;
    
    if (!ltfBOSConfirmed) {
      reasons.push('LTF BOS not confirmed');
    } else {
      reasons.push(`LTF BOS confirmed: ${ltfStructure.lastBOS?.type}`);
    }

    // 2. Check LTF sweep
    if (!ltfSweepConfirmed) {
      reasons.push('LTF liquidity sweep not confirmed');
    } else {
      reasons.push('LTF liquidity sweep confirmed');
    }

    // 3. Check LTF OB
    const ltfOBConfirmed = !!ltfOB && !ltfOB.mitigated;
    
    if (!ltfOBConfirmed) {
      reasons.push('LTF Order Block not found or mitigated');
    } else {
      reasons.push(`LTF Order Block confirmed: ${ltfOB.type}`);
    }

    // 4. Check FVG resolved (optional - contributes to confluence but not a hard blocker)
    // More lenient: FVG resolution is preferred but not strictly required if we have BOS, sweep, and OB
    if (!ltfFVGResolved) {
      reasons.push('LTF FVG not resolved (optional)');
    } else {
      reasons.push('LTF FVG resolved');
    }

    // STRICT Entry refinement: ALL three must be true (LTF Sweep + LTF OB + LTF BOS)
    // Required confluences: LTF Sweep + LTF OB + LTF BOS (ALL required)
    // Optional confluences: LTF FVG resolved (contributes to score but not required)
    // Allow refinement ONLY if: LTF Sweep AND LTF OB AND LTF BOS (all three)
    const refined = ltfSweepConfirmed && ltfOBConfirmed && ltfBOSConfirmed;
    
    // If refinement fails, add missing requirements to reasons
    if (!refined) {
      if (!ltfBOSConfirmed) reasons.push(`LTF BOS missing (required)`);
      if (!ltfSweepConfirmed) reasons.push(`LTF sweep missing (required)`);
      if (!ltfOBConfirmed) reasons.push(`LTF OB missing (required)`);
    }

    return {
      refined,
      ltfBOSConfirmed,
      ltfSweepConfirmed,
      ltfOBConfirmed,
      fvgResolved: ltfFVGResolved,
      refinedOB: ltfOB,
      reasons,
    };
  }
}