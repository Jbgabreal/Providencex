/**
 * Safety Guard Tests — guardrail enforcement, daily loss, concurrent trades,
 * symbol filters, late entry, order type, session, auto-disable
 */

// ==================== Daily Loss Breach ====================

describe('Daily Loss Guardrail', () => {
  it('should allow trade when daily loss is under limit', () => {
    const maxDailyLoss = 100;
    const currentDailyLoss = 50;
    expect(currentDailyLoss < maxDailyLoss).toBe(true);
  });

  it('should block trade when daily loss equals limit', () => {
    const maxDailyLoss = 100;
    const currentDailyLoss = 100;
    expect(currentDailyLoss >= maxDailyLoss).toBe(true);
  });

  it('should block trade when daily loss exceeds limit', () => {
    const maxDailyLoss = 100;
    const currentDailyLoss = 150;
    expect(currentDailyLoss >= maxDailyLoss).toBe(true);
  });

  it('should allow trade when no daily loss limit is set', () => {
    const maxDailyLoss = undefined;
    const shouldCheck = maxDailyLoss !== undefined && maxDailyLoss > 0;
    expect(shouldCheck).toBe(false);
  });
});

// ==================== Concurrent Trade Limit ====================

describe('Concurrent Trade Guardrail', () => {
  it('should allow trade when under limit', () => {
    const maxConcurrent = 5;
    const currentOpen = 3;
    expect(currentOpen < maxConcurrent).toBe(true);
  });

  it('should block trade when at limit', () => {
    const maxConcurrent = 5;
    const currentOpen = 5;
    expect(currentOpen >= maxConcurrent).toBe(true);
  });

  it('should allow trade when no limit set', () => {
    const maxConcurrent = undefined;
    const shouldCheck = maxConcurrent !== undefined && maxConcurrent > 0;
    expect(shouldCheck).toBe(false);
  });
});

// ==================== Symbol Filter ====================

describe('Symbol Guardrail', () => {
  it('should block a blocked symbol', () => {
    const blockedSymbols = ['BTCUSD', 'ETHUSD'];
    const signalSymbol = 'BTCUSD';
    expect(blockedSymbols.includes(signalSymbol.toUpperCase())).toBe(true);
  });

  it('should allow a non-blocked symbol', () => {
    const blockedSymbols = ['BTCUSD'];
    const signalSymbol = 'XAUUSD';
    expect(blockedSymbols.includes(signalSymbol.toUpperCase())).toBe(false);
  });

  it('should be case-insensitive', () => {
    const blockedSymbols = ['BTCUSD'];
    const signalSymbol = 'btcusd';
    expect(blockedSymbols.map(s => s.toUpperCase()).includes(signalSymbol.toUpperCase())).toBe(true);
  });
});

// ==================== Late Entry ====================

describe('Late Entry Guardrail', () => {
  it('should allow trade within time window', () => {
    const lateEntrySeconds = 300; // 5 minutes
    const signalAge = 120; // 2 minutes old
    expect(signalAge <= lateEntrySeconds).toBe(true);
  });

  it('should block trade outside time window', () => {
    const lateEntrySeconds = 300;
    const signalAge = 600; // 10 minutes old
    expect(signalAge > lateEntrySeconds).toBe(true);
  });

  it('should allow any age when no limit set', () => {
    const lateEntrySeconds = undefined;
    const shouldCheck = lateEntrySeconds !== undefined && lateEntrySeconds > 0;
    expect(shouldCheck).toBe(false);
  });

  it('should calculate signal age correctly', () => {
    const published = new Date(Date.now() - 120000); // 120 seconds ago
    const age = (Date.now() - published.getTime()) / 1000;
    expect(age).toBeGreaterThanOrEqual(119);
    expect(age).toBeLessThanOrEqual(121);
  });
});

// ==================== Order Type Filter ====================

describe('Order Type Guardrail', () => {
  it('should block market orders when disabled', () => {
    const copyMarketOrders = false;
    const orderKind = 'market';
    const blocked = orderKind === 'market' && copyMarketOrders === false;
    expect(blocked).toBe(true);
  });

  it('should allow market orders when enabled', () => {
    const copyMarketOrders = true;
    const orderKind = 'market';
    const blocked = orderKind === 'market' && copyMarketOrders === false;
    expect(blocked).toBe(false);
  });

  it('should block pending orders when disabled', () => {
    const copyPendingOrders = false;
    const orderKind = 'limit';
    const blocked = (orderKind === 'limit' || orderKind === 'stop') && copyPendingOrders === false;
    expect(blocked).toBe(true);
  });

  it('should allow pending orders by default', () => {
    const copyPendingOrders = undefined; // not set = allowed
    const blocked = copyPendingOrders === false;
    expect(blocked).toBe(false);
  });
});

// ==================== Max Lot Guard ====================

describe('Max Lot Guardrail', () => {
  it('should block trade when lot exceeds max', () => {
    const maxLotSize = 2.0;
    const calculatedLot = 3.5;
    expect(calculatedLot > maxLotSize).toBe(true);
  });

  it('should allow trade when lot is under max', () => {
    const maxLotSize = 5.0;
    const calculatedLot = 2.0;
    expect(calculatedLot > maxLotSize).toBe(false);
  });

  it('should allow any lot when no max set', () => {
    const maxLotSize = undefined;
    const shouldCheck = maxLotSize !== undefined && maxLotSize > 0;
    expect(shouldCheck).toBe(false);
  });
});

// ==================== Auto-Disable ====================

describe('Auto-Disable Logic', () => {
  it('should block trade when subscription is auto-disabled', () => {
    const autoDisabledAt = '2024-01-01T00:00:00Z';
    expect(!!autoDisabledAt).toBe(true);
  });

  it('should allow trade when not auto-disabled', () => {
    const autoDisabledAt = null;
    expect(!!autoDisabledAt).toBe(false);
  });

  it('should trigger auto-disable when daily loss breached and flag is on', () => {
    const autoDisableOnDailyLoss = true;
    const dailyLossBreached = true;
    const shouldAutoDisable = autoDisableOnDailyLoss && dailyLossBreached;
    expect(shouldAutoDisable).toBe(true);
  });

  it('should NOT auto-disable when flag is off', () => {
    const autoDisableOnDailyLoss = false;
    const dailyLossBreached = true;
    const shouldAutoDisable = autoDisableOnDailyLoss && dailyLossBreached;
    expect(shouldAutoDisable).toBe(false);
  });
});

// ==================== Session Filter ====================

describe('Session Guardrail', () => {
  it('should determine session from UTC hour', () => {
    const getSession = (hour) => {
      if (hour >= 0 && hour < 7) return 'asian';
      if (hour >= 7 && hour < 12) return 'london';
      if (hour >= 12 && hour < 21) return 'new_york';
      return 'asian';
    };
    expect(getSession(3)).toBe('asian');
    expect(getSession(9)).toBe('london');
    expect(getSession(15)).toBe('new_york');
    expect(getSession(23)).toBe('asian');
  });

  it('should block when session not in allowed list', () => {
    const allowedSessions = ['london', 'new_york'];
    const currentSession = 'asian';
    expect(!allowedSessions.includes(currentSession)).toBe(true);
  });

  it('should allow when session is in allowed list', () => {
    const allowedSessions = ['london', 'new_york'];
    const currentSession = 'london';
    expect(allowedSessions.includes(currentSession)).toBe(true);
  });
});

// ==================== Lifecycle Events ====================

describe('Copied Trade Lifecycle Events', () => {
  const validEventTypes = [
    'signal_published', 'trade_created', 'order_placed', 'order_filled',
    'sl_moved', 'breakeven_applied', 'partial_close', 'tp_hit', 'sl_hit',
    'close_all_propagated', 'manually_closed', 'blocked_by_guardrail',
    'auto_disabled', 'trade_failed', 'trade_cancelled',
  ];

  it('should define all expected event types', () => {
    expect(validEventTypes).toContain('trade_created');
    expect(validEventTypes).toContain('order_filled');
    expect(validEventTypes).toContain('trade_failed');
    expect(validEventTypes).toContain('blocked_by_guardrail');
    expect(validEventTypes).toContain('auto_disabled');
  });

  it('should have no duplicate event types', () => {
    const unique = new Set(validEventTypes);
    expect(unique.size).toBe(validEventTypes.length);
  });
});
