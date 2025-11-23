/**
 * Unit Tests for Execution Filter v3
 * 
 * Tests multi-confirmation logic, session windows, frequency limits, etc.
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { evaluateExecution } from '../../src/strategy/v3/ExecutionFilter';
import { executionFilterConfig } from '../../src/config/executionFilterConfig';
import { RawSignal, ExecutionFilterContext } from '../../src/strategy/v3/types';

describe('ExecutionFilter v3', () => {
  const baseSignal: RawSignal = {
    symbol: 'XAUUSD',
    direction: 'buy',
    entryPrice: 2650.0,
    sl: 2640.0,
    tp: 2670.0,
    createdAt: new Date(),
    timeframeContext: {
      htfTimeframe: 'H1',
      ltfTimeframe: 'M5',
      htfTrend: 'bullish',
      ltfStructure: 'impulsive',
      lastBosDirection: 'bullish',
      lastChochDirection: 'bullish',
    },
    smcMetadata: {
      liquiditySwept: true,
      displacementCandle: true,
      orderBlockZone: {
        upper: 2655.0,
        lower: 2645.0,
        type: 'demand',
        timeframe: 'M5',
      },
      entryReason: 'SMC v1: bullish HTF trend, BOS on LTF',
    },
    strategyName: 'low',
  };

  const baseContext: ExecutionFilterContext = {
    guardrailMode: 'normal',
    spreadPips: 25,
    now: new Date('2025-11-20T10:00:00-05:00'), // 10 AM NY time (within London/NY session)
    openTradesForSymbol: 0,
    todayTradeCountForSymbolStrategy: 0,
    lastTradeAtForSymbolStrategy: null,
    currentPrice: 2650.0,
  };

  describe('HTF Trend Alignment', () => {
    it('should SKIP when HTF trend does not align with signal direction', () => {
      const signal: RawSignal = {
        ...baseSignal,
        direction: 'buy',
        timeframeContext: {
          ...baseSignal.timeframeContext,
          htfTrend: 'bearish', // Misaligned for BUY
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('HTF trend'));
    });

    it('should PASS when HTF trend aligns with signal direction', () => {
      const signal: RawSignal = {
        ...baseSignal,
        direction: 'buy',
        timeframeContext: {
          ...baseSignal.timeframeContext,
          htfTrend: 'bullish',
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      // Should pass HTF alignment check (other checks may still fail)
      expect(decision.reasons).not.toContain(expect.stringContaining('HTF trend not aligned'));
    });
  });

  describe('BOS/CHOCH Confirmation', () => {
    it('should SKIP when BOS direction does not match signal direction', () => {
      const signal: RawSignal = {
        ...baseSignal,
        direction: 'buy',
        timeframeContext: {
          ...baseSignal.timeframeContext,
          lastBosDirection: 'bearish', // Misaligned for BUY
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('BOS/CHOCH'));
    });

    it('should PASS when BOS direction matches signal direction', () => {
      const signal: RawSignal = {
        ...baseSignal,
        direction: 'buy',
        timeframeContext: {
          ...baseSignal.timeframeContext,
          lastBosDirection: 'bullish',
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.reasons).not.toContain(expect.stringContaining('BOS/CHOCH does not confirm'));
    });
  });

  describe('Liquidity Sweep Requirement', () => {
    it('should SKIP when liquidity sweep is missing', () => {
      const signal: RawSignal = {
        ...baseSignal,
        smcMetadata: {
          ...baseSignal.smcMetadata!,
          liquiditySwept: false,
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('liquidity sweep'));
    });

    it('should PASS when liquidity sweep is present', () => {
      const signal: RawSignal = {
        ...baseSignal,
        smcMetadata: {
          ...baseSignal.smcMetadata!,
          liquiditySwept: true,
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.reasons).not.toContain(expect.stringContaining('No liquidity sweep'));
    });
  });

  describe('Displacement Candle Requirement', () => {
    it('should SKIP when displacement candle is missing', () => {
      const signal: RawSignal = {
        ...baseSignal,
        smcMetadata: {
          ...baseSignal.smcMetadata!,
          displacementCandle: false,
        },
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('displacement candle'));
    });
  });

  describe('Session Windows', () => {
    it('should SKIP when outside allowed sessions', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        now: new Date('2025-11-20T02:00:00-05:00'), // 2 AM NY time (outside sessions)
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('Outside allowed trading sessions'));
    });

    it('should PASS when within allowed session', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        now: new Date('2025-11-20T10:00:00-05:00'), // 10 AM NY time (within London/NY)
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.reasons).not.toContain(expect.stringContaining('Outside allowed trading sessions'));
    });
  });

  describe('Trade Frequency Limits', () => {
    it('should SKIP when max trades per day reached', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        todayTradeCountForSymbolStrategy: 5, // XAUUSD max is 5
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('Max trades per day'));
    });

    it('should SKIP when cooldown not satisfied', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        lastTradeAtForSymbolStrategy: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago (cooldown is 15 min)
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('Cooldown not satisfied'));
    });

    it('should PASS when cooldown is satisfied', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        lastTradeAtForSymbolStrategy: new Date(Date.now() - 20 * 60 * 1000), // 20 minutes ago (cooldown is 15 min)
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.reasons).not.toContain(expect.stringContaining('Cooldown not satisfied'));
    });
  });

  describe('Max Concurrent Trades', () => {
    it('should SKIP when max concurrent trades reached', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        openTradesForSymbol: 2, // XAUUSD max is 2
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('Max open trades'));
    });
  });

  describe('News Guardrail Integration', () => {
    it('should SKIP when guardrail mode is in block list', () => {
      const context: ExecutionFilterContext = {
        ...baseContext,
        guardrailMode: 'avoid',
      };

      const decision = evaluateExecution(baseSignal, executionFilterConfig, context);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('Blocked by news guardrail'));
    });
  });

  describe('Multiple Reasons', () => {
    it('should accumulate all failing reasons', () => {
      const signal: RawSignal = {
        ...baseSignal,
        direction: 'buy',
        timeframeContext: {
          ...baseSignal.timeframeContext,
          htfTrend: 'bearish', // Misaligned
          lastBosDirection: 'bearish', // Misaligned
        },
        smcMetadata: {
          ...baseSignal.smcMetadata!,
          liquiditySwept: false,
          displacementCandle: false,
        },
      };

      const context: ExecutionFilterContext = {
        ...baseContext,
        todayTradeCountForSymbolStrategy: 5,
        guardrailMode: 'avoid',
        now: new Date('2025-11-20T02:00:00-05:00'), // Outside session
      };

      const decision = evaluateExecution(signal, executionFilterConfig, context);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons.length).toBeGreaterThan(3); // Multiple reasons
    });
  });

  describe('Happy Path', () => {
    it('should return TRADE when all criteria pass', () => {
      const signal: RawSignal = {
        ...baseSignal,
        direction: 'buy',
        timeframeContext: {
          ...baseSignal.timeframeContext,
          htfTrend: 'bullish',
          lastBosDirection: 'bullish',
        },
        smcMetadata: {
          ...baseSignal.smcMetadata!,
          liquiditySwept: true,
          displacementCandle: true,
        },
      };

      const context: ExecutionFilterContext = {
        ...baseContext,
        guardrailMode: 'normal',
        spreadPips: 25, // Within limit
        now: new Date('2025-11-20T10:00:00-05:00'), // Within session
        openTradesForSymbol: 0,
        todayTradeCountForSymbolStrategy: 2, // Below max
        lastTradeAtForSymbolStrategy: new Date(Date.now() - 20 * 60 * 1000), // Cooldown satisfied
      };

      const decision = evaluateExecution(signal, executionFilterConfig, context);

      expect(decision.action).toBe('TRADE');
      expect(decision.reasons).toHaveLength(0);
    });
  });

  describe('Missing Config', () => {
    it('should SKIP when symbol rules are not configured', () => {
      const signal: RawSignal = {
        ...baseSignal,
        symbol: 'UNKNOWN', // Not in config
      };

      const decision = evaluateExecution(signal, executionFilterConfig, baseContext);

      expect(decision.action).toBe('SKIP');
      expect(decision.reasons).toContain(expect.stringContaining('No execution rules configured'));
    });
  });
});


