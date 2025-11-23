/**
 * SetupGateService - Strict Setup Qualification Gate (SMC v2)
 * 
 * Acts as a hard filter BEFORE confluence scoring to reduce over-trading.
 * Only allows trades that meet strict SMC structure requirements.
 * 
 * Goal: Reduce trades from 90 → 10-20 per month while improving win rate.
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { OrderBlockV2 } from './types';
import { FairValueGap } from './types';
import { LiquiditySweepResult } from './LiquiditySweepService';
import { DisplacementCheckResult } from './DisplacementCheckService';

const logger = new Logger('SetupGateService');

export interface SweepCheckResult {
  isValid: boolean;
  sweptSide: 'premium' | 'discount' | null;
  strength: number; // pips or ATR multiple
  reason?: string;
}

export interface BOSCheckResult {
  isValid: boolean;
  strength: number; // ATR multiple
  breakDistance: number; // pips/points
  reason?: string;
}

export interface FVGCheckResult {
  isValid: boolean;
  nearestFVG: FairValueGap | null;
  gapSize: number; // ATR multiple
  reason?: string;
}

export interface SetupGateResult {
  isEligible: boolean;
  reasons: string[];
  sweepCheck?: SweepCheckResult;
  bosCheck?: BOSCheckResult;
  fvgCheck?: FVGCheckResult;
  displacementData?: DisplacementCheckResult; // Include displacement data for logging
}

export interface SetupGateInput {
  symbol: string;
  direction: 'buy' | 'sell';
  currentPrice: number;
  candles: Candle[];
  atr: number;
  pdZone: 'premium' | 'discount' | 'neutral';
  bosData?: {
    lastBOS: { type: 'BOS' | 'CHoCH' | string; index: number; price: number; timestamp: Date } | undefined;
    swingHigh?: number;
    swingLow?: number;
  };
  fvgData: {
    itfFVGs: FairValueGap[];
    ltfFVGs: FairValueGap[];
  };
  sweepData: {
    htfSweep?: LiquiditySweepResult;
    ltfSweep?: LiquiditySweepResult;
  };
  displacementData: DisplacementCheckResult;
  orderBlockData: {
    htfOB?: OrderBlockV2;
    itfOB?: OrderBlockV2;
    ltfOB?: OrderBlockV2;
  };
}

export class SetupGateService {
  /**
   * Check if setup passes all gate requirements
   */
  checkSetupGate(input: SetupGateInput): SetupGateResult {
    const reasons: string[] = [];
    const results: SetupGateResult = {
      isEligible: true,
      reasons: [],
      displacementData: input.displacementData, // Include displacement data for logging
    };

    // Gate 1: Valid Liquidity Sweep (stricter definition)
    const sweepCheck = this.checkLiquiditySweep(input);
    results.sweepCheck = sweepCheck;
    if (!sweepCheck.isValid) {
      results.isEligible = false;
      reasons.push(sweepCheck.reason || 'Invalid liquidity sweep');
    }

    // Gate 2: Valid Displacement for Setup Qualification (hard gate)
    if (!this.checkDisplacementQualification(input.displacementData)) {
      results.isEligible = false;
      reasons.push('Displacement qualification failed: TR < 1.2x ATR AND body < 55%');
    }

    // Gate 3: Premium/Discount Enforcement (remove trend-following override)
    if (!this.checkPremiumDiscount(input.pdZone, input.direction)) {
      results.isEligible = false;
      reasons.push(`Invalid premium/discount zone (${input.pdZone}) for ${input.direction}`);
    }

    // Gate 4: BOS Strength Filter
    if (input.bosData?.lastBOS) {
      // Type guard: ensure lastBOS is not undefined before calling checkBOSStrength
      const bosCheck = this.checkBOSStrength(
        {
          lastBOS: input.bosData.lastBOS, // Safe: already checked above
          swingHigh: input.bosData.swingHigh,
          swingLow: input.bosData.swingLow,
        },
        input.direction,
        input.currentPrice,
        input.atr
      );
      results.bosCheck = bosCheck;
      if (!bosCheck.isValid) {
        results.isEligible = false;
        reasons.push(bosCheck.reason || 'BOS strength insufficient');
      }
    } else {
      results.isEligible = false;
      reasons.push('No BOS detected');
    }

    // Gate 5: FVG Narrow Selection (find nearest FVG inside Order Block)
    const fvgCheck = this.checkFVGNarrowSelection(input);
    results.fvgCheck = fvgCheck;
    if (!fvgCheck.isValid) {
      results.isEligible = false;
      reasons.push(fvgCheck.reason || 'No valid FVG inside Order Block');
    }

    results.reasons = reasons;
    return results;
  }

  /**
   * Gate 1: Check liquidity sweep with stricter definition
   * - Wick must violate previous swing high/low by at least 0.5 ATR
   * - Candle close must return back inside previous swing range
   */
  private checkLiquiditySweep(input: SetupGateInput): SweepCheckResult {
    const { sweepData, candles, direction, currentPrice, atr } = input;

    // Require LTF sweep (more immediate confirmation)
    const sweep = sweepData.ltfSweep || sweepData.htfSweep;
    if (!sweep) {
      return {
        isValid: false,
        sweptSide: null,
        strength: 0,
        reason: 'No liquidity sweep detected',
      };
    }

    // Find the swing level that was swept
    const recent = candles.slice(-20);
    let swingLevel: number | undefined;
    let sweptSide: 'premium' | 'discount' | null = null;

    if (sweep.type === 'EQH' || sweep.type === 'sweep') {
      // Swept above (premium side)
      sweptSide = 'premium';
      swingLevel = Math.max(...recent.slice(0, -5).map(c => c.high));
    } else {
      // Swept below (discount side)
      sweptSide = 'discount';
      swingLevel = Math.min(...recent.slice(0, -5).map(c => c.low));
    }

    if (!swingLevel) {
      return {
        isValid: false,
        sweptSide: null,
        strength: 0,
        reason: 'Could not determine swing level for sweep',
      };
    }

    // Find the candle that violated the swing level
    const sweepCandle = recent.find(c => {
      if (sweep.type === 'EQH' || sweep.type === 'sweep') {
        return c.high > swingLevel!;
      } else {
        return c.low < swingLevel!;
      }
    });

    if (!sweepCandle) {
      return {
        isValid: false,
        sweptSide,
        strength: 0,
        reason: 'Sweep candle not found',
      };
    }

    // Check 1: Wick must violate by at least 0.5 ATR
    const minViolation = atr * 0.5;
    let violationDistance = 0;
    
    if (sweep.type === 'EQH' || sweep.type === 'sweep') {
      violationDistance = sweepCandle.high - swingLevel;
    } else {
      violationDistance = swingLevel - sweepCandle.low;
    }

    if (violationDistance < minViolation) {
      return {
        isValid: false,
        sweptSide,
        strength: violationDistance / atr,
        reason: `Sweep violation too small: ${(violationDistance / atr).toFixed(2)}x < 0.5x ATR`,
      };
    }

    // Check 2: Close must return back inside swing range
    const lastCandle = candles[candles.length - 1];
    const returnedInside = sweep.type === 'EQH' || sweep.type === 'sweep'
      ? lastCandle.close < swingLevel
      : lastCandle.close > swingLevel;

    if (!returnedInside) {
      return {
        isValid: false,
        sweptSide,
        strength: violationDistance / atr,
        reason: 'Price did not return inside swing range after sweep',
      };
    }

    return {
      isValid: true,
      sweptSide,
      strength: violationDistance / atr,
    };
  }

  /**
   * Gate 2: Check displacement qualification (hard gate before soft scoring)
   * Pass if: TR >= 1.2x ATR OR bodyPct >= 55%
   */
  private checkDisplacementQualification(displacementData: DisplacementCheckResult): boolean {
    const { metrics } = displacementData;
    const trQualifies = metrics.trMultiple >= 1.2;
    const bodyQualifies = metrics.bodyPct >= 55;

    return trQualifies || bodyQualifies;
  }

  /**
   * Gate 3: Check Premium/Discount enforcement (strict, no trend-following override)
   * - Buy trades: must be in discount
   * - Sell trades: must be in premium
   */
  private checkPremiumDiscount(
    pdZone: 'premium' | 'discount' | 'neutral',
    direction: 'buy' | 'sell'
  ): boolean {
    if (pdZone === 'neutral') return false;

    // Buy in discount, sell in premium
    if (direction === 'buy' && pdZone === 'discount') return true;
    if (direction === 'sell' && pdZone === 'premium') return true;

    return false;
  }

  /**
   * Gate 4: Check BOS strength
   * BOS is valid only if break distance >= 0.3 ATR
   */
  private checkBOSStrength(
    bosData: {
      lastBOS: { type: 'BOS' | 'CHoCH' | string; index: number; price: number; timestamp: Date } | undefined;
      swingHigh?: number;
      swingLow?: number;
    },
    direction: 'buy' | 'sell',
    currentPrice: number,
    atr: number
  ): BOSCheckResult {
    const { lastBOS } = bosData;
    if (!lastBOS) {
      return {
        isValid: false,
        strength: 0,
        breakDistance: 0,
        reason: 'No BOS data available',
      };
    }

    // Calculate break distance from swing level
    let swingLevel: number | undefined;
    if (direction === 'buy' && bosData.swingHigh) {
      swingLevel = bosData.swingHigh;
    } else if (direction === 'sell' && bosData.swingLow) {
      swingLevel = bosData.swingLow;
    }

    if (!swingLevel) {
      // Fallback: use BOS price as swing level
      swingLevel = lastBOS.price;
    }

    // Calculate break distance
    const breakDistance = direction === 'buy'
      ? currentPrice - swingLevel
      : swingLevel - currentPrice;

    const strength = atr > 0 ? breakDistance / atr : 0;
    const minStrength = 0.3;

    if (strength < minStrength) {
      return {
        isValid: false,
        strength,
        breakDistance,
        reason: `BOS strength insufficient: ${strength.toFixed(2)}x < ${minStrength}x ATR`,
      };
    }

    return {
      isValid: true,
      strength,
      breakDistance,
    };
  }

  /**
   * Gate 5: FVG Narrow Selection
   * Find nearest FVG inside the chosen Order Block
   * Require gap >= 0.3 ATR minimum
   */
  private checkFVGNarrowSelection(input: SetupGateInput): FVGCheckResult {
    const { orderBlockData, fvgData, direction, currentPrice, atr } = input;

    // Use ITF OB as primary, fallback to LTF OB
    const ob = orderBlockData.itfOB || orderBlockData.ltfOB;
    if (!ob) {
      return {
        isValid: false,
        nearestFVG: null,
        gapSize: 0,
        reason: 'No Order Block available for FVG selection',
      };
    }

    // Get FVGs from ITF and LTF (prioritize ITF)
    const allFVGs = [...fvgData.itfFVGs, ...fvgData.ltfFVGs];

    // Filter FVGs that are inside the Order Block
    const fvgsInOB = allFVGs.filter(fvg => {
      const fvgMid = (fvg.high + fvg.low) / 2;
      return fvgMid >= ob.low && fvgMid <= ob.high;
    });

    if (fvgsInOB.length === 0) {
      return {
        isValid: false,
        nearestFVG: null,
        gapSize: 0,
        reason: 'No FVG found inside Order Block',
      };
    }

    // Find nearest FVG to current price
    let nearestFVG: FairValueGap | null = null;
    let minDistance = Infinity;

    for (const fvg of fvgsInOB) {
      const fvgMid = (fvg.high + fvg.low) / 2;
      const distance = Math.abs(currentPrice - fvgMid);
      if (distance < minDistance) {
        minDistance = distance;
        nearestFVG = fvg;
      }
    }

    if (!nearestFVG) {
      return {
        isValid: false,
        nearestFVG: null,
        gapSize: 0,
        reason: 'Could not determine nearest FVG',
      };
    }

    // Check gap size >= 0.3 ATR
    const gapSize = nearestFVG.high - nearestFVG.low;
    const gapSizeATR = atr > 0 ? gapSize / atr : 0;
    const minGapSize = 0.3;

    if (gapSizeATR < minGapSize) {
      return {
        isValid: false,
        nearestFVG,
        gapSize: gapSizeATR,
        reason: `FVG gap too small: ${gapSizeATR.toFixed(2)}x < ${minGapSize}x ATR`,
      };
    }

    return {
      isValid: true,
      nearestFVG,
      gapSize: gapSizeATR,
    };
  }
}

