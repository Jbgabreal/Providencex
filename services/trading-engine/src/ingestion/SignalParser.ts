/**
 * SignalParser — Extracts structured trade signals from raw message text.
 * Uses deterministic regex-based rules. Designed for extension with smarter parsing later.
 */

import { Logger } from '@providencex/shared-utils';
import type { ParsedSignalFields, CandidateType } from './types';

const logger = new Logger('SignalParser');

// Common forex/commodity symbols
const KNOWN_SYMBOLS = [
  'XAUUSD', 'GOLD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD',
  'USDCHF', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDCAD', 'AUDNZD', 'CADJPY', 'CHFJPY',
  'EURAUD', 'EURCAD', 'EURCHF', 'EURNZD', 'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD',
  'NZDCAD', 'NZDJPY', 'US30', 'US100', 'US500', 'BTCUSD', 'ETHUSD', 'XAGUSD', 'SILVER',
  'USOIL', 'UKOIL', 'NATGAS', 'DJ30', 'NAS100', 'SPX500', 'GER40', 'UK100',
];

// Update keywords
const UPDATE_PATTERNS = {
  breakeven: /\b(breakeven|break\s*even|move\s*sl\s*to\s*(be|entry|breakeven))\b/i,
  close_all: /\b(close\s*all|exit\s*all|close\s*trade|close\s*position)\b/i,
  cancel: /\b(cancel\w*|invalidat\w*|void\w*|scrap\w*)\b/i,
  move_sl: /\b(move\s*sl|new\s*sl|sl\s*(?:to|at|now|moved|adjust))\b/i,
  partial_close: /\b(partial\s*close|close\s*tp|tp\s*\d\s*hit|take\s*profit\s*\d?\s*(?:hit|reached|done))\b/i,
};

export class SignalParser {
  /**
   * Parse a raw message text into structured signal fields.
   * Returns null if the message doesn't look like a trading signal.
   */
  parse(rawText: string): ParsedSignalFields | null {
    const text = rawText.trim();
    if (!text || text.length < 5) return null;

    // 1. Check if this is a signal update
    const updateResult = this.tryParseUpdate(text);
    if (updateResult) return updateResult;

    // 2. Try to parse as a new signal
    return this.tryParseNewSignal(text);
  }

  private tryParseUpdate(text: string): ParsedSignalFields | null {
    for (const [type, pattern] of Object.entries(UPDATE_PATTERNS)) {
      if (pattern.test(text)) {
        const result: ParsedSignalFields = {
          candidateType: 'signal_update',
          updateType: type as any,
          confidence: 70,
        };

        // Extract SL value for move_sl
        if (type === 'move_sl') {
          const slMatch = text.match(/sl\s*(?:to|at|now|:)?\s*(\d+\.?\d*)/i);
          if (slMatch) result.newSl = parseFloat(slMatch[1]);
        }

        // Extract TP level for partial_close
        if (type === 'partial_close') {
          const tpMatch = text.match(/tp\s*(\d)/i);
          if (tpMatch) result.closeTpLevel = parseInt(tpMatch[1]);
        }

        result.notes = text;
        return result;
      }
    }
    return null;
  }

  private tryParseNewSignal(text: string): ParsedSignalFields | null {
    const upper = text.toUpperCase();

    // Find symbol
    const symbol = this.findSymbol(upper);
    if (!symbol) return null;

    // Find direction
    const direction = this.findDirection(upper);
    if (!direction) return null;

    // Extract prices
    const prices = this.extractPrices(text);
    if (prices.length === 0) return null;

    // Determine entry, SL, TPs based on direction and price ordering
    const { entryPrice, stopLoss, tps } = this.assignPrices(prices, direction);

    if (!entryPrice) return null;

    // Confidence scoring
    let confidence = 50;
    if (stopLoss) confidence += 15;
    if (tps.length > 0) confidence += 10;
    if (tps.length >= 2) confidence += 5;
    if (this.hasExplicitLabels(text)) confidence += 15;

    // Detect order type
    const orderKind = this.detectOrderKind(text);

    return {
      symbol,
      direction,
      orderKind,
      entryPrice,
      stopLoss,
      tp1: tps[0],
      tp2: tps[1],
      tp3: tps[2],
      tp4: tps[3],
      notes: text,
      candidateType: 'new_signal',
      confidence: Math.min(confidence, 95),
    };
  }

  private findSymbol(text: string): string | undefined {
    for (const sym of KNOWN_SYMBOLS) {
      // Match whole word or with slash (e.g. XAU/USD)
      const patterns = [
        new RegExp(`\\b${sym}\\b`, 'i'),
        new RegExp(`\\b${sym.slice(0, 3)}[/\\s]?${sym.slice(3)}\\b`, 'i'),
      ];
      for (const p of patterns) {
        if (p.test(text)) return sym;
      }
    }
    // Try GOLD → XAUUSD alias
    if (/\bGOLD\b/i.test(text)) return 'XAUUSD';
    if (/\bSILVER\b/i.test(text)) return 'XAGUSD';
    return undefined;
  }

  private findDirection(text: string): 'BUY' | 'SELL' | undefined {
    if (/\b(BUY|LONG|COMPRAR)\b/i.test(text)) return 'BUY';
    if (/\b(SELL|SHORT|VENDER)\b/i.test(text)) return 'SELL';
    return undefined;
  }

  private extractPrices(text: string): { label: string; value: number }[] {
    const prices: { label: string; value: number }[] = [];

    // Labeled prices: "SL: 1234", "TP1: 1234", "Entry: 1234"
    const labeledPattern = /\b(entry|sl|stop\s*loss|tp\s*\d?|take\s*profit\s*\d?|target\s*\d?)\s*[:=@]?\s*(\d+\.?\d*)/gi;
    let match;
    while ((match = labeledPattern.exec(text)) !== null) {
      const label = match[1].toLowerCase().replace(/\s+/g, '');
      const value = parseFloat(match[2]);
      if (value > 0) prices.push({ label, value });
    }

    // If no labeled prices, extract all bare numbers as potential prices
    if (prices.length === 0) {
      const numberPattern = /\b(\d{3,6}\.?\d{0,5})\b/g;
      while ((match = numberPattern.exec(text)) !== null) {
        const value = parseFloat(match[1]);
        if (value > 0) prices.push({ label: 'unknown', value });
      }
    }

    return prices;
  }

  private assignPrices(prices: { label: string; value: number }[], direction: 'BUY' | 'SELL'): {
    entryPrice?: number; stopLoss?: number; tps: (number | undefined)[];
  } {
    let entryPrice: number | undefined;
    let stopLoss: number | undefined;
    const tps: (number | undefined)[] = [];

    // First pass: use labeled prices
    for (const p of prices) {
      if (p.label === 'entry') entryPrice = p.value;
      else if (p.label === 'sl' || p.label === 'stoploss') stopLoss = p.value;
      else if (p.label.startsWith('tp') || p.label.startsWith('takeprofit') || p.label.startsWith('target')) {
        tps.push(p.value);
      }
    }

    // If no entry, try to infer from unlabeled prices
    if (!entryPrice && prices.length >= 2) {
      const values = prices.map(p => p.value).sort((a, b) => a - b);
      if (direction === 'BUY') {
        // BUY: entry near bottom, SL below, TPs above
        entryPrice = values[0];
        if (values.length >= 2 && !stopLoss) stopLoss = values[0] < entryPrice ? values[0] : undefined;
        for (let i = 1; i < values.length && tps.length < 4; i++) {
          if (values[i] > (entryPrice || 0)) tps.push(values[i]);
        }
      } else {
        // SELL: entry near top, SL above, TPs below
        entryPrice = values[values.length - 1];
        if (values.length >= 2 && !stopLoss) stopLoss = values[values.length - 1] > entryPrice ? values[values.length - 1] : undefined;
        for (let i = values.length - 2; i >= 0 && tps.length < 4; i--) {
          if (values[i] < (entryPrice || Infinity)) tps.push(values[i]);
        }
      }
    }

    return { entryPrice, stopLoss, tps };
  }

  private hasExplicitLabels(text: string): boolean {
    return /\b(entry|sl|stop\s*loss|tp\d?|take\s*profit)\s*[:=@]/i.test(text);
  }

  private detectOrderKind(text: string): 'market' | 'limit' | 'stop' {
    if (/\b(limit\s*order|buy\s*limit|sell\s*limit)\b/i.test(text)) return 'limit';
    if (/\b(stop\s*order|buy\s*stop|sell\s*stop)\b/i.test(text)) return 'stop';
    return 'market';
  }
}
