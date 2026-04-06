/**
 * OB Confluence Filter
 *
 * Reads Order Block zones from Pine indicators running on TradingView
 * via the CDP bridge, and checks if a signal's entry price is at/near
 * an OB zone.
 *
 * This provides the "smart money" confluence that turns a mediocre
 * signal into a high-probability entry.
 */

import { Logger } from '@providencex/shared-utils';
import { TradingViewBridge } from './TradingViewBridge';
import { PineBox, PineLine } from './types';

const logger = new Logger('OBConfluenceFilter');

export interface OBConfluenceResult {
  hasConfluence: boolean;
  nearestOB: { high: number; low: number; distance: number; type: 'demand' | 'supply' } | null;
  obCount: number;
  reason: string;
}

export interface OBFilterConfig {
  /** Max distance from OB zone as % of price (default 0.5%) */
  maxDistancePct: number;
  /** Indicator name filter — only check OBs from these indicators */
  indicatorFilter?: string;
  /** Skip session boxes (LuxAlgo Sessions etc) */
  skipSessions: boolean;
  /** Enable/disable the filter */
  enabled: boolean;
}

const DEFAULT_CONFIG: OBFilterConfig = {
  maxDistancePct: parseFloat(process.env.OB_MAX_DISTANCE_PCT || '0.2'),
  indicatorFilter: process.env.OB_INDICATOR_FILTER || '',
  skipSessions: true,
  enabled: process.env.OB_CONFLUENCE_ENABLED !== 'false',
};

export class OBConfluenceFilter {
  private bridge: TradingViewBridge;
  private config: OBFilterConfig;
  private lastOBs: PineBox[] = [];
  private lastHTFLevels: number[] = [];
  private lastFetchTime = 0;
  private cacheTTL = 30000; // cache OBs for 30 seconds

  constructor(bridge: TradingViewBridge, config?: Partial<OBFilterConfig>) {
    this.bridge = bridge;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if a price level has OB confluence */
  async checkConfluence(
    price: number,
    direction: 'buy' | 'sell',
    symbol: string,
  ): Promise<OBConfluenceResult> {
    if (!this.config.enabled) {
      return { hasConfluence: true, nearestOB: null, obCount: 0, reason: 'OB filter disabled' };
    }

    try {
      // Fetch HTF levels and OB zones (cached)
      await this.fetchData();

      // PRIMARY: Check HTF OB levels (lines from MSB-OB v3 MTF)
      // These are the high-quality H1/H4/Daily OB zones — few and significant
      if (this.lastHTFLevels.length > 0) {
        const maxDist = price * (this.config.maxDistancePct / 100);
        let nearestLevel: { price: number; distance: number } | null = null;

        for (const level of this.lastHTFLevels) {
          const dist = Math.abs(level - price);
          if (dist <= maxDist) {
            if (!nearestLevel || dist < nearestLevel.distance) {
              nearestLevel = { price: level, distance: dist };
            }
          }
        }

        if (nearestLevel) {
          const type = nearestLevel.price < price ? 'demand' : 'supply';
          const reason = `HTF OB level: ${type} @ ${nearestLevel.price.toFixed(0)} (dist: ${(nearestLevel.distance / price * 100).toFixed(3)}%)`;
          logger.info(`[OBFilter] ${symbol}: ${reason}`);
          return {
            hasConfluence: true,
            nearestOB: { high: nearestLevel.price, low: nearestLevel.price, distance: nearestLevel.distance, type },
            obCount: this.lastHTFLevels.length,
            reason,
          };
        }

        // No HTF level nearby
        const reason = `No HTF OB level within ${this.config.maxDistancePct}% of ${price.toFixed(2)} (checked ${this.lastHTFLevels.length} levels)`;
        logger.info(`[OBFilter] ${symbol}: ${reason}`);
        return { hasConfluence: false, nearestOB: null, obCount: this.lastHTFLevels.length, reason };
      }

      // FALLBACK: If no HTF levels available, check box zones
      const obs = this.lastOBs;
      if (obs.length === 0) {
        logger.warn(`[OBFilter] No OB data found on chart for ${symbol}`);
        return { hasConfluence: true, nearestOB: null, obCount: 0, reason: 'No OBs on chart — passing through' };
      }

      const maxDist = price * (this.config.maxDistancePct / 100);
      const nearbyOBs: { high: number; low: number; distance: number; type: 'demand' | 'supply' }[] = [];

      for (const ob of obs) {
        const mid = (ob.high + ob.low) / 2;
        if (ob.high >= price - maxDist && ob.low <= price + maxDist) {
          const dist = Math.abs(mid - price);
          const type = mid < price ? 'demand' : 'supply';
          nearbyOBs.push({ high: ob.high, low: ob.low, distance: dist, type });
        }
      }

      if (nearbyOBs.length === 0) {
        const reason = `No OB within ${this.config.maxDistancePct}% of ${price.toFixed(2)} (checked ${obs.length} zones)`;
        logger.info(`[OBFilter] ${symbol}: ${reason}`);
        return { hasConfluence: false, nearestOB: null, obCount: obs.length, reason };
      }

      nearbyOBs.sort((a, b) => a.distance - b.distance);
      const nearest = nearbyOBs[0];
      const reason = `OB zone: ${nearest.type} ${nearest.low.toFixed(0)}-${nearest.high.toFixed(0)} (dist: ${(nearest.distance / price * 100).toFixed(3)}%)`;
      logger.info(`[OBFilter] ${symbol}: ${reason}`);

      return {
        hasConfluence: true,
        nearestOB: nearest,
        obCount: obs.length,
        reason,
      };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[OBFilter] Error checking OB confluence: ${msg}`);
      // On error, let the trade through (don't block because of CDP issues)
      return { hasConfluence: true, nearestOB: null, obCount: 0, reason: `OB filter error: ${msg}` };
    }
  }

  /** Fetch all OB data from TradingView (cached) */
  private async fetchData(): Promise<void> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.cacheTTL && (this.lastOBs.length > 0 || this.lastHTFLevels.length > 0)) {
      return;
    }

    await this.bridge.ensureConnected();
    const studies = await this.bridge.getPineBoxes(this.config.indicatorFilter);

    // Get current price for relevance filtering
    let currentPrice = 0;
    try {
      const quote = await this.bridge.getQuote();
      currentPrice = quote.close;
    } catch {}

    const allBoxes: PineBox[] = [];
    for (const study of studies) {
      if (this.config.skipSessions && /session/i.test(study.name)) continue;
      for (const box of study.boxes) {
        // Only keep OBs within 5% of current price (filter out distant historical zones)
        if (currentPrice > 0) {
          const mid = (box.high + box.low) / 2;
          if (Math.abs(mid - currentPrice) / currentPrice > 0.05) continue;
        }
        allBoxes.push(box);
      }
    }

    this.lastOBs = allBoxes;

    // Also fetch HTF lines (high quality OB levels from MSB-OB v3 MTF)
    try {
      const lineStudies = await this.bridge.getPineLines('MSB-OB');
      const htfLevels: number[] = [];
      const seen = new Set<number>();
      for (const study of lineStudies) {
        for (const line of study.lines) {
          if (!line.horizontal) continue;
          const rounded = Math.round(line.y1);
          if (seen.has(rounded)) continue;
          // Only keep levels within 3% of current price
          if (currentPrice > 0 && Math.abs(rounded - currentPrice) / currentPrice > 0.03) continue;
          htfLevels.push(line.y1);
          seen.add(rounded);
        }
      }
      this.lastHTFLevels = htfLevels;
      logger.debug(`[OBFilter] Fetched ${htfLevels.length} HTF OB levels from lines`);
    } catch {
      this.lastHTFLevels = [];
    }

    this.lastFetchTime = now;

    logger.debug(`[OBFilter] Fetched ${allBoxes.length} nearby OB zones + ${this.lastHTFLevels.length} HTF levels`);
  }

  /** Clear cache (call when symbol changes) */
  clearCache(): void {
    this.lastOBs = [];
    this.lastFetchTime = 0;
  }
}
