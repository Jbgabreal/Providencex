/**
 * TradingView Signal Service
 *
 * Reads Pine indicator data from TradingView Desktop via the CDP bridge
 * and translates it into TradeSignal objects for the execution pipeline.
 *
 * Expected Pine indicator setup on TradingView:
 * - An SMC/ICT indicator that draws:
 *   - box.new() for Order Block zones (bullish OB = green/blue, bearish OB = red)
 *   - label.new() containing "Bullish"/"Bearish"/"BUY"/"SELL" text for bias/signals
 *   - line.new() for swing highs/lows, FVG zones, key levels
 *
 * The service scans these drawings and produces signals when:
 * 1. A clear bias exists (from labels)
 * 2. Price is at/near an order block zone (from boxes)
 * 3. An entry signal label is present (from labels)
 */

import { Logger } from '@providencex/shared-utils';
import { TradingViewBridge } from './TradingViewBridge';
import { TradeSignal } from '../types';
import {
  TVOrderBlock,
  TVBias,
  TVKeyLevel,
  TVEntrySignal,
  TVChartSnapshot,
  PineStudyData,
  PineBox,
  PineLabel,
  TVQuote,
} from './types';

const logger = new Logger('TradingViewSignalService');

// Regex patterns for detecting bias/signal from Pine label text
const BULLISH_PATTERNS = /\b(bullish|bull|buy|long|bos.*up|choch.*up|↑)\b/i;
const BEARISH_PATTERNS = /\b(bearish|bear|sell|short|bos.*down|choch.*down|↓)\b/i;
const ENTRY_BUY_PATTERNS = /\b(buy|long|entry.*buy|buy.*entry|▲|🟢)\b/i;
const ENTRY_SELL_PATTERNS = /\b(sell|short|entry.*sell|sell.*entry|▼|🔴)\b/i;
const OB_BULLISH_PATTERNS = /\b(bull|demand|support|ob.*bull|buy.*zone)\b/i;
const OB_BEARISH_PATTERNS = /\b(bear|supply|resistance|ob.*bear|sell.*zone)\b/i;

// Structure labels from ICT/SMC indicators
const BOS_PATTERN = /^bos$/i;
const CHOCH_PATTERN = /^choch$/i;
const MSB_PATTERN = /^msb$/i;

/** How close price must be to an OB zone to be "in zone" (as fraction of zone height) */
const OB_PROXIMITY_FACTOR = 1.5;

/** Minimum R:R to accept a signal */
const MIN_RR = 1.5;

export interface TVSignalConfig {
  /** Pine indicator name filter for OB boxes (e.g., "Smart Money", "ICT", "LuxAlgo") */
  obIndicatorFilter?: string;
  /** Pine indicator name filter for bias labels */
  biasIndicatorFilter?: string;
  /** Pine indicator name filter for entry signal labels */
  entryIndicatorFilter?: string;
  /** Minimum R:R ratio */
  minRR: number;
  /** SL buffer beyond OB edge (in price units) */
  slBuffer: number;
  /** Default SL pips if no OB zone found */
  defaultSlPips: number;
  /** Symbol-specific pip values */
  pipValues: Record<string, number>;
}

const DEFAULT_CONFIG: TVSignalConfig = {
  minRR: MIN_RR,
  slBuffer: 0, // will be set per-symbol
  defaultSlPips: 30,
  pipValues: {
    XAUUSD: 0.1,
    EURUSD: 0.0001,
    GBPUSD: 0.0001,
    USDJPY: 0.01,
    GBPJPY: 0.01,
    EURJPY: 0.01,
    AUDUSD: 0.0001,
    NZDUSD: 0.0001,
    USDCAD: 0.0001,
    USDCHF: 0.0001,
  },
};

export class TradingViewSignalService {
  private bridge: TradingViewBridge;
  private config: TVSignalConfig;
  private lastReason: string | null = null;
  private lastSnapshot: TVChartSnapshot | null = null;

  constructor(bridge: TradingViewBridge, config?: Partial<TVSignalConfig>) {
    this.bridge = bridge;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // --- Public API (matches StrategyPipelineConfig.signalSource interface) ---

  async generateSignal(symbol: string): Promise<TradeSignal | null> {
    this.lastReason = null;

    try {
      // Ensure chart is showing the right symbol
      const chartState = await this.bridge.getChartState();
      if (chartState.symbol.toUpperCase() !== symbol.toUpperCase()) {
        // Switch chart to the requested symbol
        await this.bridge.setSymbol(symbol);
      }

      // Collect all indicator data
      const snapshot = await this.collectSnapshot(symbol);
      this.lastSnapshot = snapshot;

      // Step 1: Determine bias
      if (!snapshot.bias) {
        this.lastReason = 'No bias detected from TradingView indicators';
        return null;
      }

      // Step 2: Check for explicit entry signals
      const entrySignal = this.findEntrySignal(snapshot);
      if (!entrySignal) {
        this.lastReason = `Bias=${snapshot.bias.direction} but no entry signal from indicators`;
        return null;
      }

      // Step 3: Find nearest OB for SL placement
      const ob = this.findNearestOB(snapshot, entrySignal.direction);

      // Step 4: Calculate SL and TP
      const pipValue = this.getPipValue(symbol);
      const slBufferPrice = this.config.slBuffer || (pipValue * 5); // 5 pips default buffer

      let stopLoss: number;
      if (ob) {
        // SL beyond the OB edge + buffer
        stopLoss = entrySignal.direction === 'buy'
          ? ob.low - slBufferPrice
          : ob.high + slBufferPrice;
      } else {
        // Fallback: use default SL distance
        const defaultSlDistance = this.config.defaultSlPips * pipValue;
        stopLoss = entrySignal.direction === 'buy'
          ? entrySignal.price - defaultSlDistance
          : entrySignal.price + defaultSlDistance;
      }

      // Find TP from key levels (swing targets)
      const takeProfit = this.findTPTarget(snapshot, entrySignal.direction, entrySignal.price, stopLoss);

      if (!takeProfit) {
        this.lastReason = `No valid TP target found for ${entrySignal.direction} entry`;
        return null;
      }

      // Step 5: Validate R:R
      const slDistance = Math.abs(entrySignal.price - stopLoss);
      const tpDistance = Math.abs(takeProfit - entrySignal.price);
      const rr = slDistance > 0 ? tpDistance / slDistance : 0;

      if (rr < this.config.minRR) {
        this.lastReason = `R:R ${rr.toFixed(2)} below minimum ${this.config.minRR} (SL=${slDistance.toFixed(pipValue < 0.01 ? 1 : 5)}, TP=${tpDistance.toFixed(pipValue < 0.01 ? 1 : 5)})`;
        return null;
      }

      // Build the signal
      const signal: TradeSignal = {
        symbol,
        direction: entrySignal.direction,
        entry: entrySignal.price,
        stopLoss,
        takeProfit,
        orderKind: 'market',
        reason: `TV Signal: ${snapshot.bias.direction} bias, ${entrySignal.source}, R:R=${rr.toFixed(2)}${ob ? `, OB@${ob.low.toFixed(2)}-${ob.high.toFixed(2)}` : ''}`,
        meta: {
          source: 'tradingview',
          bias: snapshot.bias,
          orderBlock: ob,
          riskReward: Math.round(rr * 100) / 100,
          entrySource: entrySignal.source,
          indicatorCount: snapshot.rawStudies.length,
        },
      };

      logger.info(`[${symbol}] TV Signal: ${signal.direction} @ ${signal.entry}, SL=${signal.stopLoss}, TP=${signal.takeProfit}, R:R=${rr.toFixed(2)}`);
      return signal;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[${symbol}] TradingView signal error: ${msg}`);
      this.lastReason = `TV bridge error: ${msg}`;
      return null;
    }
  }

  getLastSmcReason(): string | null {
    return this.lastReason;
  }

  getLastSnapshot(): TVChartSnapshot | null {
    return this.lastSnapshot;
  }

  // --- Internal: Data Collection ---

  private async collectSnapshot(symbol: string): Promise<TVChartSnapshot> {
    const chartState = await this.bridge.getChartState();
    const { quote, boxes, labels, lines, studyValues } = await this.bridge.getFullSnapshot();

    // Merge all study data
    const allStudies = new Map<string, PineStudyData>();
    for (const source of [boxes, labels, lines]) {
      for (const study of source) {
        const existing = allStudies.get(study.name);
        if (existing) {
          existing.boxes.push(...study.boxes);
          existing.labels.push(...study.labels);
          existing.lines.push(...study.lines);
        } else {
          allStudies.set(study.name, { ...study });
        }
      }
    }

    // Parse semantic meaning from raw data
    const orderBlocks = this.parseOrderBlocks(boxes, quote);
    const bias = this.parseBias(labels);
    const keyLevels = this.parseKeyLevels(lines, boxes);
    const entrySignals = this.parseEntrySignals(labels);

    return {
      symbol,
      resolution: chartState.resolution,
      timestamp: Date.now(),
      quote,
      orderBlocks,
      bias,
      keyLevels,
      entrySignals,
      rawStudies: Array.from(allStudies.values()),
    };
  }

  // --- Internal: Parsing Pine Data ---

  private parseOrderBlocks(boxStudies: PineStudyData[], quote: TVQuote): TVOrderBlock[] {
    const obs: TVOrderBlock[] = [];
    const filter = this.config.obIndicatorFilter;

    for (const study of boxStudies) {
      if (filter && !study.name.toLowerCase().includes(filter.toLowerCase())) continue;
      // Skip session boxes (LuxAlgo Sessions draws huge session ranges)
      if (/session/i.test(study.name)) continue;

      for (const box of study.boxes) {
        const midpoint = (box.high + box.low) / 2;

        // Classify by: explicit name, then ARGB color analysis, then position
        let type: 'bullish' | 'bearish';
        const colorStr = String(box.bgColor || box.borderColor || '').toLowerCase();

        if (OB_BULLISH_PATTERNS.test(study.name)) {
          type = 'bullish';
        } else if (OB_BEARISH_PATTERNS.test(study.name)) {
          type = 'bearish';
        } else if (/green|blue|#0[0-9a-f]{5}/i.test(colorStr)) {
          type = 'bullish';
        } else if (/red|#ff|#f[0-9a-f]{5}/i.test(colorStr)) {
          type = 'bearish';
        } else if (typeof box.bgColor === 'number' && box.bgColor > 0) {
          // ARGB integer color: extract RGB components
          // Green-ish (bullish) vs Red-ish (bearish)
          const r = (box.bgColor >> 16) & 0xFF;
          const g = (box.bgColor >> 8) & 0xFF;
          const b = box.bgColor & 0xFF;
          if (g > r && g > b) type = 'bullish';
          else if (r > g && r > b) type = 'bearish';
          else type = midpoint < quote.close ? 'bullish' : 'bearish';
        } else {
          // Fallback: below price = demand/bullish OB, above = supply/bearish OB
          type = midpoint < quote.close ? 'bullish' : 'bearish';
        }

        obs.push({ high: box.high, low: box.low, midpoint, type });
      }
    }

    return obs;
  }

  private parseBias(labelStudies: PineStudyData[]): TVBias | null {
    const filter = this.config.biasIndicatorFilter;

    // Strategy 1: Look for explicit Bullish/Bearish labels
    for (const study of labelStudies) {
      if (filter && !study.name.toLowerCase().includes(filter.toLowerCase())) continue;

      for (let i = study.labels.length - 1; i >= 0; i--) {
        const label = study.labels[i];
        const text = label.text;

        if (BULLISH_PATTERNS.test(text) && !BEARISH_PATTERNS.test(text)) {
          return { direction: 'bullish', source: `${study.name}: "${text}"` };
        }
        if (BEARISH_PATTERNS.test(text) && !BULLISH_PATTERNS.test(text)) {
          return { direction: 'bearish', source: `${study.name}: "${text}"` };
        }
      }
    }

    // Strategy 2: Infer bias from BOS/ChoCH/MSB structure labels
    // In ICT: BOS = continuation, ChoCH = reversal, MSB = market structure break
    // We look at the last few structure labels and determine the trend direction
    // by checking if the break prices are making higher highs (bullish) or lower lows (bearish)
    return this.inferBiasFromStructure(labelStudies);
  }

  /**
   * Infer market bias from BOS/ChoCH/MSB structure labels.
   *
   * Logic:
   * - Collect the last N structure labels (bos, ChoCh, MSB) with prices
   * - If the most recent ChoCH/MSB is higher than the previous one → bullish
   * - If the most recent ChoCH/MSB is lower → bearish
   * - BOS confirms the current trend (continuation)
   * - Also look at overall trend of structure break prices
   */
  private inferBiasFromStructure(labelStudies: PineStudyData[]): TVBias | null {
    const structureLabels: { text: string; price: number; x: number; study: string }[] = [];

    for (const study of labelStudies) {
      // Skip session labels
      if (/session/i.test(study.name)) continue;

      for (const label of study.labels) {
        if (label.price == null) continue;
        const text = label.text.toLowerCase().trim();
        if (BOS_PATTERN.test(text) || CHOCH_PATTERN.test(text) || MSB_PATTERN.test(text)) {
          structureLabels.push({
            text,
            price: label.price,
            x: label.x || 0,
            study: study.name,
          });
        }
      }
    }

    if (structureLabels.length < 3) return null;

    // Sort by bar index (x position) — most recent last
    structureLabels.sort((a, b) => a.x - b.x);

    // Take the last 10 structure labels
    const recent = structureLabels.slice(-10);

    // Find the most recent ChoCH or MSB (these indicate direction change)
    let lastChoCH: typeof recent[0] | null = null;
    let prevChoCH: typeof recent[0] | null = null;

    for (let i = recent.length - 1; i >= 0; i--) {
      const l = recent[i];
      if (CHOCH_PATTERN.test(l.text) || MSB_PATTERN.test(l.text)) {
        if (!lastChoCH) {
          lastChoCH = l;
        } else if (!prevChoCH) {
          prevChoCH = l;
          break;
        }
      }
    }

    // Method A: Compare consecutive ChoCH/MSB prices
    if (lastChoCH && prevChoCH) {
      if (lastChoCH.price > prevChoCH.price) {
        return {
          direction: 'bullish',
          source: `${lastChoCH.study}: ${lastChoCH.text}@${lastChoCH.price.toFixed(2)} > prev@${prevChoCH.price.toFixed(2)} (higher structure break)`,
        };
      } else if (lastChoCH.price < prevChoCH.price) {
        return {
          direction: 'bearish',
          source: `${lastChoCH.study}: ${lastChoCH.text}@${lastChoCH.price.toFixed(2)} < prev@${prevChoCH.price.toFixed(2)} (lower structure break)`,
        };
      }
    }

    // Method B: Trend of last 5 structure break prices (regression-like)
    const lastFive = recent.slice(-5);
    if (lastFive.length >= 3) {
      let higherCount = 0;
      let lowerCount = 0;
      for (let i = 1; i < lastFive.length; i++) {
        if (lastFive[i].price > lastFive[i - 1].price) higherCount++;
        else if (lastFive[i].price < lastFive[i - 1].price) lowerCount++;
      }
      if (higherCount > lowerCount) {
        return {
          direction: 'bullish',
          source: `Structure trend: ${higherCount} higher vs ${lowerCount} lower breaks in last ${lastFive.length}`,
        };
      } else if (lowerCount > higherCount) {
        return {
          direction: 'bearish',
          source: `Structure trend: ${lowerCount} lower vs ${higherCount} higher breaks in last ${lastFive.length}`,
        };
      }
    }

    return null;
  }

  private parseKeyLevels(lineStudies: PineStudyData[], boxStudies: PineStudyData[]): TVKeyLevel[] {
    const levels: TVKeyLevel[] = [];

    // Horizontal lines = key levels
    for (const study of lineStudies) {
      for (const line of study.lines) {
        if (line.horizontal) {
          const nameL = study.name.toLowerCase();
          let type: TVKeyLevel['type'] = 'unknown';
          if (/swing.*high|sh\b/i.test(nameL)) type = 'swing_high';
          else if (/swing.*low|sl\b/i.test(nameL)) type = 'swing_low';
          else if (/fvg|fair.*value/i.test(nameL)) type = line.y1 > line.y2 ? 'fvg_top' : 'fvg_bottom';
          else if (/support/i.test(nameL)) type = 'support';
          else if (/resistance/i.test(nameL)) type = 'resistance';

          levels.push({ price: line.y1, type });
        }
      }
    }

    // OB edges also serve as key levels
    for (const study of boxStudies) {
      for (const box of study.boxes) {
        levels.push({ price: box.high, type: 'resistance' });
        levels.push({ price: box.low, type: 'support' });
      }
    }

    // Deduplicate (within 0.1% of each other)
    const deduped: TVKeyLevel[] = [];
    for (const level of levels) {
      const isDupe = deduped.some(d => Math.abs(d.price - level.price) / level.price < 0.001);
      if (!isDupe) deduped.push(level);
    }

    return deduped.sort((a, b) => b.price - a.price);
  }

  private parseEntrySignals(labelStudies: PineStudyData[]): TVEntrySignal[] {
    const signals: TVEntrySignal[] = [];
    const filter = this.config.entryIndicatorFilter;

    for (const study of labelStudies) {
      if (filter && !study.name.toLowerCase().includes(filter.toLowerCase())) continue;
      if (/session/i.test(study.name)) continue;

      for (const label of study.labels) {
        if (label.price == null) continue;

        // Explicit buy/sell labels
        if (ENTRY_BUY_PATTERNS.test(label.text)) {
          signals.push({ direction: 'buy', price: label.price, source: `${study.name}: "${label.text}"` });
        } else if (ENTRY_SELL_PATTERNS.test(label.text)) {
          signals.push({ direction: 'sell', price: label.price, source: `${study.name}: "${label.text}"` });
        }
      }
    }

    // Also treat recent BOS/MSB labels as potential entry confirmations
    // The direction depends on whether the break is up or down
    // (determined by the bias from parseBias, not here)

    return signals;
  }

  // --- Internal: Signal Construction ---

  private findEntrySignal(snapshot: TVChartSnapshot): TVEntrySignal | null {
    if (!snapshot.bias) return null;

    const biasDir = snapshot.bias.direction === 'bullish' ? 'buy' : 'sell';
    const price = snapshot.quote.close;

    // Priority 1: Explicit BUY/SELL entry signals matching bias
    const matching = snapshot.entrySignals.filter(s => s.direction === biasDir);
    if (matching.length > 0) {
      return matching[matching.length - 1]; // most recent
    }

    // Priority 2: Price is inside a bias-aligned OB zone
    // This is a strong entry — price is retracing to an OB and we have bias confirmation
    for (const ob of snapshot.orderBlocks) {
      const isInZone = price >= ob.low && price <= ob.high;
      const typeMatches = (biasDir === 'buy' && ob.type === 'bullish') ||
                          (biasDir === 'sell' && ob.type === 'bearish');

      if (isInZone && typeMatches) {
        return {
          direction: biasDir,
          price,
          source: `Price in ${ob.type} OB (${ob.low.toFixed(2)}-${ob.high.toFixed(2)})`,
        };
      }
    }

    // Priority 3: Recent BOS/ChoCH near current price confirms entry
    // Look for the most recent structure label within a small range of current price
    const pipValue = this.getPipValue(snapshot.symbol);
    const proximityPips = 20; // within 20 pips of current price
    const proximityPrice = proximityPips * pipValue;

    for (const study of snapshot.rawStudies) {
      if (/session/i.test(study.name)) continue;
      // Check labels in reverse (most recent first)
      for (let i = study.labels.length - 1; i >= 0; i--) {
        const label = study.labels[i];
        if (label.price == null) continue;
        const text = label.text.toLowerCase().trim();
        if (!BOS_PATTERN.test(text) && !CHOCH_PATTERN.test(text) && !MSB_PATTERN.test(text)) continue;

        const dist = Math.abs(label.price - price);
        if (dist > proximityPrice) continue;

        // BOS near price + bias = entry confirmation
        // Check that we also have a nearby OB for SL
        const nearbyOB = snapshot.orderBlocks.find(ob => {
          const typeMatches = (biasDir === 'buy' && ob.type === 'bullish') ||
                              (biasDir === 'sell' && ob.type === 'bearish');
          const obDist = biasDir === 'buy'
            ? price - ob.low
            : ob.high - price;
          return typeMatches && obDist >= 0 && obDist < proximityPrice * 3;
        });

        if (nearbyOB) {
          return {
            direction: biasDir,
            price,
            source: `${text.toUpperCase()} near price (${label.price.toFixed(2)}) + ${nearbyOB.type} OB (${nearbyOB.low.toFixed(2)}-${nearbyOB.high.toFixed(2)})`,
          };
        }
      }
    }

    return null;
  }

  private findNearestOB(snapshot: TVChartSnapshot, direction: 'buy' | 'sell'): TVOrderBlock | null {
    const price = snapshot.quote.close;
    const obType = direction === 'buy' ? 'bullish' : 'bearish';

    let nearest: TVOrderBlock | null = null;
    let nearestDist = Infinity;

    for (const ob of snapshot.orderBlocks) {
      if (ob.type !== obType) continue;
      const dist = direction === 'buy'
        ? price - ob.low // distance below price
        : ob.high - price; // distance above price
      if (dist >= 0 && dist < nearestDist) {
        nearest = ob;
        nearestDist = dist;
      }
    }

    return nearest;
  }

  private findTPTarget(
    snapshot: TVChartSnapshot,
    direction: 'buy' | 'sell',
    entry: number,
    stopLoss: number,
  ): number | null {
    const slDistance = Math.abs(entry - stopLoss);
    const minTPDistance = slDistance * this.config.minRR;

    // Collect candidate TP levels
    const candidates: number[] = [];

    // From key levels
    for (const level of snapshot.keyLevels) {
      if (direction === 'buy' && level.price > entry + minTPDistance) {
        candidates.push(level.price);
      } else if (direction === 'sell' && level.price < entry - minTPDistance) {
        candidates.push(level.price);
      }
    }

    // From opposing OB zones (target the opposite side)
    for (const ob of snapshot.orderBlocks) {
      if (direction === 'buy' && ob.type === 'bearish' && ob.low > entry + minTPDistance) {
        candidates.push(ob.low); // Target bottom of bearish OB (supply)
      } else if (direction === 'sell' && ob.type === 'bullish' && ob.high < entry - minTPDistance) {
        candidates.push(ob.high); // Target top of bullish OB (demand)
      }
    }

    if (candidates.length === 0) {
      // Fallback: use R:R multiplier
      const tpDistance = slDistance * (this.config.minRR + 0.5);
      return direction === 'buy' ? entry + tpDistance : entry - tpDistance;
    }

    // Pick nearest valid TP
    candidates.sort((a, b) => {
      const distA = Math.abs(a - entry);
      const distB = Math.abs(b - entry);
      return distA - distB;
    });

    return candidates[0];
  }

  private getPipValue(symbol: string): number {
    return this.config.pipValues[symbol.toUpperCase()] || 0.0001;
  }
}
