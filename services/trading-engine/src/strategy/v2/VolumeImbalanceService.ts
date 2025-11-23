/**
 * VolumeImbalanceService - Detects Volume Imbalance zones (SMC v2)
 * 
 * Detects thrust candles and imbalanced bodies
 * Should align with OB + FVG
 */

import { Logger } from '@providencex/shared-utils';
import { Candle } from '../../marketData/types';
import { VolumeImbalanceZone } from '@providencex/shared-types';

const logger = new Logger('VolumeImbalanceService');

export class VolumeImbalanceService {
  private volumeThreshold: number; // Volume multiplier threshold (e.g., 1.5x average)
  private lookbackPeriod: number;

  constructor(volumeThreshold: number = 1.5, lookbackPeriod: number = 20) {
    this.volumeThreshold = volumeThreshold;
    this.lookbackPeriod = lookbackPeriod;
  }

  /**
   * Detect Volume Imbalance zones on a timeframe
   */
  detectImbalanceZones(
    candles: Candle[],
    timeframe: 'HTF' | 'ITF' | 'LTF'
  ): VolumeImbalanceZone[] {
    if (candles.length < 10) return [];

    const zones: VolumeImbalanceZone[] = [];
    const recent = candles.slice(-this.lookbackPeriod);

    // Calculate average volume
    const avgVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;

    // Detect thrust candles (high volume candles with large body)
    for (let i = 0; i < recent.length; i++) {
      const candle = recent[i];

      // Check if volume is above threshold
      if (candle.volume > avgVolume * this.volumeThreshold) {
        // Check if body is significant
        const body = Math.abs(candle.close - candle.open);
        const range = candle.high - candle.low;
        const bodyRatio = range > 0 ? body / range : 0;

        // Thrust candle: high volume + large body (> 70% of range)
        if (bodyRatio > 0.7) {
          zones.push({
            high: candle.high,
            low: candle.low,
            timestamp: candle.endTime.toISOString(),
            intensity: this.calculateIntensity(candle.volume, avgVolume),
            timeframe,
          });
        }
      }
    }

    return zones;
  }

  /**
   * Calculate imbalance intensity
   */
  private calculateIntensity(volume: number, avgVolume: number): 'high' | 'medium' | 'low' {
    const ratio = volume / avgVolume;
    
    if (ratio >= 3.0) return 'high';
    if (ratio >= 2.0) return 'medium';
    return 'low';
  }

  /**
   * Check if Volume Imbalance aligns with OB + FVG
   */
  isAligned(
    zones: VolumeImbalanceZone[],
    obHigh: number,
    obLow: number,
    fvgHigh: number | undefined,
    fvgLow: number | undefined
  ): boolean {
    if (zones.length === 0) return false;

    // Get most recent zone
    const recentZone = zones[zones.length - 1];

    // Check if zone overlaps with OB
    const overlapsOB = !(recentZone.high < obLow || recentZone.low > obHigh);

    if (!overlapsOB) return false;

    // If FVG exists, check if zone aligns with FVG too
    if (fvgHigh && fvgLow) {
      const overlapsFVG = !(recentZone.high < fvgLow || recentZone.low > fvgHigh);
      return overlapsFVG;
    }

    return true; // Aligned with OB (FVG not required)
  }
}
