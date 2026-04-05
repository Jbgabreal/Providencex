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
import { PineBox } from './types';

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
      // Fetch OBs (cached)
      const obs = await this.getOBZones();

      if (obs.length === 0) {
        logger.warn(`[OBFilter] No OB zones found on chart for ${symbol}`);
        // If no OBs visible, let the trade through (don't block because of missing data)
        return { hasConfluence: true, nearestOB: null, obCount: 0, reason: 'No OBs on chart — passing through' };
      }

      // Find OBs near the price
      const maxDist = price * (this.config.maxDistancePct / 100);
      const nearbyOBs: { high: number; low: number; distance: number; type: 'demand' | 'supply' }[] = [];

      for (const ob of obs) {
        const mid = (ob.high + ob.low) / 2;

        // For BUY: look for demand zones (below or at price)
        // For SELL: look for supply zones (above or at price)
        if (direction === 'buy') {
          // Price should be at or near a demand zone (OB below price)
          if (ob.high >= price - maxDist && ob.low <= price + maxDist) {
            const dist = Math.abs(mid - price);
            nearbyOBs.push({ high: ob.high, low: ob.low, distance: dist, type: 'demand' });
          }
        } else {
          // Price should be at or near a supply zone (OB above price)
          if (ob.low <= price + maxDist && ob.high >= price - maxDist) {
            const dist = Math.abs(mid - price);
            nearbyOBs.push({ high: ob.high, low: ob.low, distance: dist, type: 'supply' });
          }
        }
      }

      if (nearbyOBs.length === 0) {
        const reason = `No OB within ${this.config.maxDistancePct}% of ${price.toFixed(2)} for ${direction} (checked ${obs.length} zones)`;
        logger.info(`[OBFilter] ${symbol}: ${reason}`);
        return { hasConfluence: false, nearestOB: null, obCount: obs.length, reason };
      }

      // Sort by distance, take closest
      nearbyOBs.sort((a, b) => a.distance - b.distance);
      const nearest = nearbyOBs[0];

      const reason = `OB confluence: ${nearest.type} zone ${nearest.low.toFixed(0)}-${nearest.high.toFixed(0)} (dist: ${(nearest.distance / price * 100).toFixed(3)}%)`;
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

  /** Fetch OB zones from TradingView (cached). Only keeps zones near current price. */
  private async getOBZones(): Promise<PineBox[]> {
    const now = Date.now();
    if (now - this.lastFetchTime < this.cacheTTL && this.lastOBs.length > 0) {
      return this.lastOBs;
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
    this.lastFetchTime = now;

    logger.debug(`[OBFilter] Fetched ${allBoxes.length} nearby OB zones (filtered from ${studies.reduce((a, s) => a + s.boxes.length, 0)} total)`);
    return allBoxes;
  }

  /** Clear cache (call when symbol changes) */
  clearCache(): void {
    this.lastOBs = [];
    this.lastFetchTime = 0;
  }
}
