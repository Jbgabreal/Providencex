/**
 * TradingView CDP Bridge
 *
 * Connects to TradingView Desktop via Chrome DevTools Protocol (port 9222)
 * and reads Pine indicator data (boxes, labels, lines, quotes, OHLCV).
 *
 * This mirrors the technique used by the tradingview-mcp-jackson server
 * but runs inside the trading engine for automated signal polling.
 */

import WebSocket from 'ws';
import { Logger } from '@providencex/shared-utils';
import {
  CDPTarget,
  CDPEvalResult,
  TradingViewBridgeConfig,
  DEFAULT_TV_BRIDGE_CONFIG,
  PineBox,
  PineLabel,
  PineLine,
  PineStudyData,
  TVQuote,
  TVBar,
  TVChartState,
} from './types';

const logger = new Logger('TradingViewBridge');

// JS expressions to evaluate in TradingView's browser context
const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';
const BARS_PATH = `${CHART_API}._chartWidget.model().mainSeries().bars()`;

/**
 * Builds a JS expression that traverses all Pine studies on the chart
 * and extracts graphics primitives (boxes, labels, or lines).
 */
function buildGraphicsJS(collectionName: string, mapKey: string, filter: string): string {
  return `
    (function() {
      var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
      var model = chart.model();
      var sources = model.model().dataSources();
      var results = [];
      var filter = '${filter}';
      for (var si = 0; si < sources.length; si++) {
        var s = sources[si];
        if (!s.metaInfo) continue;
        try {
          var meta = s.metaInfo();
          var name = meta.description || meta.shortDescription || '';
          if (!name) continue;
          if (filter && name.indexOf(filter) === -1) continue;
          var g = s._graphics;
          if (!g || !g._primitivesCollection) continue;
          var pc = g._primitivesCollection;
          var items = [];
          try {
            var outer = pc.${collectionName};
            if (outer) {
              var inner = outer.get('${mapKey}');
              if (inner) {
                var coll = inner.get(false);
                if (coll && coll._primitivesDataById && coll._primitivesDataById.size > 0) {
                  coll._primitivesDataById.forEach(function(v, id) { items.push({id: id, raw: v}); });
                }
              }
            }
          } catch(e) {}
          if (items.length > 0) results.push({name: name, count: items.length, items: items});
        } catch(e) {}
      }
      return results;
    })()
  `;
}

export class TradingViewBridge {
  private config: TradingViewBridgeConfig;
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pendingRequests = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private connected = false;
  private targetInfo: CDPTarget | null = null;

  constructor(config?: Partial<TradingViewBridgeConfig>) {
    this.config = { ...DEFAULT_TV_BRIDGE_CONFIG, ...config };
  }

  // --- Connection Management ---

  async connect(): Promise<void> {
    const target = await this.findChartTarget();
    if (!target) {
      throw new Error('No TradingView chart target found. Is TradingView Desktop open with a chart?');
    }
    this.targetInfo = target;

    return new Promise((resolve, reject) => {
      const wsUrl = target.webSocketDebuggerUrl;
      logger.info(`Connecting to TradingView CDP: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', async () => {
        this.connected = true;
        // Enable Runtime domain
        try {
          await this.sendCDP('Runtime.enable', {});
          logger.info('TradingView CDP connected');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
            const pending = this.pendingRequests.get(msg.id)!;
            this.pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error.message || 'CDP error'));
            } else {
              pending.resolve(msg.result);
            }
          }
        } catch {
          // ignore non-JSON messages
        }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.ws = null;
        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(new Error('WebSocket closed'));
        }
        this.pendingRequests.clear();
        logger.warn('TradingView CDP connection closed');
      });

      this.ws.on('error', (err) => {
        logger.error('TradingView CDP WebSocket error:', err.message);
        if (!this.connected) {
          reject(err);
        }
      });

      // Timeout after 10s
      setTimeout(() => {
        if (!this.connected) {
          this.ws?.close();
          reject(new Error('TradingView CDP connection timeout'));
        }
      }, 10000);
    });
  }

  async ensureConnected(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      // Quick liveness check
      try {
        await this.evaluate('1');
        return;
      } catch {
        this.connected = false;
      }
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.config.maxReconnectAttempts; attempt++) {
      try {
        await this.connect();
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const delay = Math.min(this.config.reconnectIntervalMs * Math.pow(2, attempt), 30000);
        logger.warn(`CDP connect attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error(`CDP connection failed after ${this.config.maxReconnectAttempts} attempts: ${lastError?.message}`);
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  // --- CDP Protocol ---

  private sendCDP(method: string, params: Record<string, any>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }
      const id = ++this.msgId;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));

      // Timeout individual requests after 15s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`CDP request timeout: ${method}`));
        }
      }, 15000);
    });
  }

  private async evaluate(expression: string): Promise<any> {
    const result: CDPEvalResult = await this.sendCDP('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });

    if (result.exceptionDetails) {
      const msg = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Unknown evaluation error';
      throw new Error(`JS eval error: ${msg}`);
    }
    return result.result?.value;
  }

  private async findChartTarget(): Promise<CDPTarget | null> {
    const { cdpHost, cdpPort } = this.config;
    const url = `http://${cdpHost}:${cdpPort}/json/list`;

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`CDP target list request failed: ${resp.status}`);
    }
    const targets = (await resp.json()) as CDPTarget[];

    return targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
      || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url))
      || null;
  }

  // --- Chart Control ---

  async getChartState(): Promise<TVChartState> {
    await this.ensureConnected();
    const data = await this.evaluate(`
      (function() {
        var api = ${CHART_API};
        var sym = '', res = '', chartType = 0, studies = [];
        try { sym = api.symbol(); } catch(e) {}
        try { res = api.resolution(); } catch(e) {}
        try { chartType = api.chartType(); } catch(e) {}
        try {
          var all = api.getAllStudies();
          for (var i = 0; i < all.length; i++) studies.push({id: all[i].id, name: all[i].name});
        } catch(e) {}
        return {symbol: sym, resolution: res, chartType: chartType, studies: studies};
      })()
    `);
    return data;
  }

  async setSymbol(symbol: string): Promise<void> {
    await this.ensureConnected();
    await this.evaluate(`${CHART_API}.setSymbol('${symbol}', {})`);
    // Wait for chart to load
    await new Promise(r => setTimeout(r, 3000));
  }

  async setTimeframe(timeframe: string): Promise<void> {
    await this.ensureConnected();
    await this.evaluate(`${CHART_API}.setResolution('${timeframe}', {})`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // --- Data Retrieval ---

  async getQuote(): Promise<TVQuote> {
    await this.ensureConnected();
    const data = await this.evaluate(`
      (function() {
        var api = ${CHART_API};
        var sym = '';
        try { sym = api.symbol(); } catch(e) {}
        if (!sym) { try { sym = api.symbolExt().symbol; } catch(e) {} }
        var bars = ${BARS_PATH};
        var quote = { symbol: sym };
        if (bars && typeof bars.lastIndex === 'function') {
          var last = bars.valueAt(bars.lastIndex());
          if (last) { quote.time = last[0]; quote.open = last[1]; quote.high = last[2]; quote.low = last[3]; quote.close = last[4]; quote.last = last[4]; quote.volume = last[5] || 0; }
        }
        return quote;
      })()
    `);
    if (!data || (!data.close && !data.last)) {
      throw new Error('Could not retrieve quote — chart may still be loading');
    }
    return data;
  }

  async getOHLCV(count: number = 100): Promise<TVBar[]> {
    await this.ensureConnected();
    const limit = Math.min(count, 500);
    const data = await this.evaluate(`
      (function() {
        var bars = ${BARS_PATH};
        if (!bars || typeof bars.lastIndex !== 'function') return null;
        var result = [];
        var end = bars.lastIndex();
        var start = Math.max(bars.firstIndex(), end - ${limit} + 1);
        for (var i = start; i <= end; i++) {
          var v = bars.valueAt(i);
          if (v) result.push({time: v[0], open: v[1], high: v[2], low: v[3], close: v[4], volume: v[5] || 0});
        }
        return result;
      })()
    `);
    if (!data || data.length === 0) {
      throw new Error('Could not extract OHLCV data — chart may still be loading');
    }
    return data;
  }

  async getPineBoxes(studyFilter?: string): Promise<PineStudyData[]> {
    await this.ensureConnected();
    const filter = studyFilter || '';
    const raw = await this.evaluate(buildGraphicsJS('dwgboxes', 'boxes', filter));
    if (!raw || raw.length === 0) return [];

    return raw.map((s: any) => {
      const boxes: PineBox[] = [];
      const seen = new Set<string>();
      for (const item of s.items) {
        const v = item.raw;
        const high = v.y1 != null && v.y2 != null ? Math.round(Math.max(v.y1, v.y2) * 100) / 100 : null;
        const low = v.y1 != null && v.y2 != null ? Math.round(Math.min(v.y1, v.y2) * 100) / 100 : null;
        if (high != null && low != null) {
          const key = `${high}:${low}`;
          if (!seen.has(key)) {
            boxes.push({ high, low, x1: v.x1, x2: v.x2, borderColor: v.c, bgColor: v.bc });
            seen.add(key);
          }
        }
      }
      boxes.sort((a, b) => b.high - a.high);
      return { name: s.name, boxes, labels: [], lines: [] };
    });
  }

  async getPineLabels(studyFilter?: string, maxLabels: number = 50): Promise<PineStudyData[]> {
    await this.ensureConnected();
    const filter = studyFilter || '';
    const raw = await this.evaluate(buildGraphicsJS('dwglabels', 'labels', filter));
    if (!raw || raw.length === 0) return [];

    return raw.map((s: any) => {
      let labels: PineLabel[] = s.items.map((item: any) => {
        const v = item.raw;
        return {
          text: v.t || '',
          price: v.y != null ? Math.round(v.y * 100) / 100 : null,
          x: v.x,
        };
      }).filter((l: PineLabel) => l.text || l.price != null);
      if (labels.length > maxLabels) labels = labels.slice(-maxLabels);
      return { name: s.name, boxes: [], labels, lines: [] };
    });
  }

  async getPineLines(studyFilter?: string): Promise<PineStudyData[]> {
    await this.ensureConnected();
    const filter = studyFilter || '';
    const raw = await this.evaluate(buildGraphicsJS('dwglines', 'lines', filter));
    if (!raw || raw.length === 0) return [];

    return raw.map((s: any) => {
      const lines: PineLine[] = [];
      for (const item of s.items) {
        const v = item.raw;
        const y1 = v.y1 != null ? Math.round(v.y1 * 100) / 100 : null;
        const y2 = v.y2 != null ? Math.round(v.y2 * 100) / 100 : null;
        if (y1 != null && y2 != null) {
          lines.push({ y1, y2, x1: v.x1, x2: v.x2, horizontal: v.y1 === v.y2 });
        }
      }
      return { name: s.name, boxes: [], labels: [], lines };
    });
  }

  async getStudyValues(): Promise<{ name: string; values: Record<string, string> }[]> {
    await this.ensureConnected();
    const data = await this.evaluate(`
      (function() {
        var chart = window.TradingViewApi._activeChartWidgetWV.value()._chartWidget;
        var model = chart.model();
        var sources = model.model().dataSources();
        var results = [];
        for (var si = 0; si < sources.length; si++) {
          var s = sources[si];
          if (!s.metaInfo) continue;
          try {
            var meta = s.metaInfo();
            var name = meta.description || meta.shortDescription || '';
            if (!name) continue;
            var values = {};
            try {
              var dwv = s.dataWindowView();
              if (dwv) {
                var items = dwv.items();
                if (items) {
                  for (var i = 0; i < items.length; i++) {
                    var item = items[i];
                    if (item._value && item._value !== '\\u2205' && item._title) values[item._title] = item._value;
                  }
                }
              }
            } catch(e) {}
            if (Object.keys(values).length > 0) results.push({ name: name, values: values });
          } catch(e) {}
        }
        return results;
      })()
    `);
    return data || [];
  }

  /** Collect all Pine indicator data from the current chart in one pass */
  async getFullSnapshot(): Promise<{
    quote: TVQuote;
    boxes: PineStudyData[];
    labels: PineStudyData[];
    lines: PineStudyData[];
    studyValues: { name: string; values: Record<string, string> }[];
  }> {
    await this.ensureConnected();

    // Run all reads in parallel for speed
    const [quote, boxes, labels, lines, studyValues] = await Promise.all([
      this.getQuote(),
      this.getPineBoxes(),
      this.getPineLabels(),
      this.getPineLines(),
      this.getStudyValues(),
    ]);

    return { quote, boxes, labels, lines, studyValues };
  }

  /** Health check — verifies CDP connection and TradingView chart is loaded */
  async healthCheck(): Promise<{ ok: boolean; symbol?: string; error?: string }> {
    try {
      await this.ensureConnected();
      const state = await this.getChartState();
      return { ok: true, symbol: state.symbol };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
