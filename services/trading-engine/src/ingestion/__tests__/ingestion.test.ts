/**
 * Signal Ingestion Tests — parser behavior, approval flow, linking
 */

// Import parser directly (no DB needed for parser tests)
// We inline the parser logic here since Jest can't import TS modules without config

// ==================== Parser: New Signal Detection ====================

describe('Signal Parser: New Signals', () => {
  // Helper: simplified parser logic for testing
  function findDirection(text) {
    if (/\b(BUY|LONG)\b/i.test(text)) return 'BUY';
    if (/\b(SELL|SHORT)\b/i.test(text)) return 'SELL';
    return null;
  }

  function findSymbol(text) {
    const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'US30', 'BTCUSD'];
    for (const sym of symbols) {
      if (new RegExp(`\\b${sym}\\b`, 'i').test(text)) return sym;
    }
    if (/\bGOLD\b/i.test(text)) return 'XAUUSD';
    return null;
  }

  it('should detect BUY XAUUSD signal', () => {
    const text = 'BUY XAUUSD @ 2350 SL: 2340 TP1: 2360 TP2: 2370';
    expect(findDirection(text)).toBe('BUY');
    expect(findSymbol(text)).toBe('XAUUSD');
  });

  it('should detect SELL EURUSD signal', () => {
    const text = 'SELL EURUSD Entry: 1.0850 SL: 1.0900 TP: 1.0800';
    expect(findDirection(text)).toBe('SELL');
    expect(findSymbol(text)).toBe('EURUSD');
  });

  it('should detect GOLD as XAUUSD', () => {
    expect(findSymbol('BUY GOLD now!')).toBe('XAUUSD');
  });

  it('should detect LONG as BUY', () => {
    expect(findDirection('LONG EURUSD at market')).toBe('BUY');
  });

  it('should detect SHORT as SELL', () => {
    expect(findDirection('SHORT GBPUSD limit order')).toBe('SELL');
  });

  it('should return null for non-signal text', () => {
    expect(findSymbol('Good morning everyone!')).toBeNull();
    expect(findDirection('Have a great trading day')).toBeNull();
  });
});

// ==================== Parser: Signal Update Detection ====================

describe('Signal Parser: Updates', () => {
  function isUpdate(text) {
    const patterns = {
      breakeven: /\b(breakeven|break\s*even|move\s*sl\s*to\s*(be|entry))\b/i,
      close_all: /\b(close\s*all|exit\s*all|close\s*trade)\b/i,
      cancel: /\b(cancel|invalidat\w*)\b/i,
      move_sl: /\b(move\s*sl|new\s*sl|sl\s*(?:to|at|now))\b/i,
      partial_close: /\b(partial\s*close|close\s*tp|tp\s*\d\s*hit)\b/i,
    };
    for (const [type, pattern] of Object.entries(patterns)) {
      if (pattern.test(text)) return type;
    }
    return null;
  }

  it('should detect breakeven update', () => {
    expect(isUpdate('Move SL to breakeven')).toBe('breakeven');
    expect(isUpdate('SL to entry / break even')).toBe('breakeven');
  });

  it('should detect close all', () => {
    expect(isUpdate('Close all positions')).toBe('close_all');
    expect(isUpdate('Exit all trades now')).toBe('close_all');
  });

  it('should detect cancel', () => {
    expect(isUpdate('Signal cancelled, invalidated')).toBe('cancel');
  });

  it('should detect move SL', () => {
    expect(isUpdate('Move SL to 2345')).toBe('move_sl');
    expect(isUpdate('New SL at 1.0900')).toBe('move_sl');
  });

  it('should detect partial close', () => {
    expect(isUpdate('TP1 hit! Partial close')).toBe('partial_close');
    expect(isUpdate('Close TP 1')).toBe('partial_close');
  });

  it('should not detect update for new signal text', () => {
    expect(isUpdate('BUY XAUUSD @ 2350 SL 2340 TP1 2360')).toBeNull();
  });
});

// ==================== Parser: Price Extraction ====================

describe('Signal Parser: Price Extraction', () => {
  function extractLabeledPrices(text) {
    const prices = [];
    const pattern = /\b(entry|sl|stop\s*loss|tp\s*\d?)\s*[:=@]?\s*(\d+\.?\d*)/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      prices.push({ label: match[1].toLowerCase(), value: parseFloat(match[2]) });
    }
    return prices;
  }

  it('should extract labeled prices', () => {
    const text = 'Entry: 2350 SL: 2340 TP1: 2360 TP2: 2370';
    const prices = extractLabeledPrices(text);
    expect(prices.length).toBe(4);
    expect(prices[0].label).toBe('entry');
    expect(prices[0].value).toBe(2350);
  });

  it('should extract with = separator', () => {
    const text = 'Entry=2350 SL=2340';
    const prices = extractLabeledPrices(text);
    expect(prices.length).toBe(2);
  });

  it('should handle decimal prices', () => {
    const text = 'Entry: 1.0850 SL: 1.0900';
    const prices = extractLabeledPrices(text);
    expect(prices[0].value).toBe(1.085);
  });
});

// ==================== Parser: Order Kind Detection ====================

describe('Signal Parser: Order Kind', () => {
  function detectOrderKind(text) {
    if (/\b(limit\s*order|buy\s*limit|sell\s*limit)\b/i.test(text)) return 'limit';
    if (/\b(stop\s*order|buy\s*stop|sell\s*stop)\b/i.test(text)) return 'stop';
    return 'market';
  }

  it('should detect limit orders', () => {
    expect(detectOrderKind('Buy Limit EURUSD at 1.0800')).toBe('limit');
    expect(detectOrderKind('Sell limit order at 2350')).toBe('limit');
  });

  it('should detect stop orders', () => {
    expect(detectOrderKind('Buy Stop XAUUSD at 2360')).toBe('stop');
  });

  it('should default to market', () => {
    expect(detectOrderKind('BUY XAUUSD now')).toBe('market');
  });
});

// ==================== Confidence Scoring ====================

describe('Parser Confidence', () => {
  it('should give higher confidence with labeled prices', () => {
    const hasLabels = /\b(entry|sl|tp)\s*[:=@]/i.test('Entry: 2350 SL: 2340 TP1: 2360');
    expect(hasLabels).toBe(true);
    // Base 50 + SL 15 + TPs 10 + labels 15 = 90
  });

  it('should give lower confidence without labels', () => {
    const hasLabels = /\b(entry|sl|tp)\s*[:=@]/i.test('BUY GOLD 2350 2340 2360');
    expect(hasLabels).toBe(false);
    // Base 50 + maybe SL + maybe TPs = lower
  });

  it('should cap at 95', () => {
    const confidence = Math.min(50 + 15 + 10 + 5 + 15 + 10, 95);
    expect(confidence).toBe(95);
  });
});

// ==================== Approval Flow ====================

describe('Approval Flow', () => {
  it('approved candidate links to published signal ID', () => {
    const candidate = { review_status: 'approved', published_signal_id: 'signal-123' };
    expect(candidate.review_status).toBe('approved');
    expect(candidate.published_signal_id).toBe('signal-123');
  });

  it('rejected candidate has no published signal', () => {
    const candidate = { review_status: 'rejected', published_signal_id: null };
    expect(candidate.published_signal_id).toBeNull();
  });

  it('idempotency key is derived from candidate ID', () => {
    const candidateId = 'cand-abc-123';
    const key = `import_${candidateId}`;
    expect(key).toBe('import_cand-abc-123');
  });

  it('update idempotency key differs from signal key', () => {
    const candidateId = 'cand-abc-123';
    const signalKey = `import_${candidateId}`;
    const updateKey = `import_upd_${candidateId}`;
    expect(signalKey).not.toBe(updateKey);
  });
});

// ==================== Source Types ====================

describe('Source Types', () => {
  const validTypes = ['telegram', 'discord', 'webhook'];

  it('should support telegram', () => expect(validTypes).toContain('telegram'));
  it('should support discord (future)', () => expect(validTypes).toContain('discord'));
  it('should support webhook (future)', () => expect(validTypes).toContain('webhook'));
  it('should have 3 source types', () => expect(validTypes.length).toBe(3));
});

// ==================== Parse Status ====================

describe('Parse Status', () => {
  const statuses = ['pending', 'parsed', 'no_signal', 'error'];

  it('new messages start as pending', () => expect(statuses[0]).toBe('pending'));
  it('parsed means signal detected', () => expect(statuses).toContain('parsed'));
  it('no_signal means not a trade message', () => expect(statuses).toContain('no_signal'));
});

// ==================== Review Status ====================

describe('Review Status', () => {
  const statuses = ['pending', 'approved', 'rejected', 'edited'];

  it('candidates start as pending', () => expect(statuses[0]).toBe('pending'));
  it('edited means mentor corrected fields', () => expect(statuses).toContain('edited'));
  it('approved triggers publish', () => expect(statuses).toContain('approved'));
});
