/**
 * CandleReplayEngine Unit Tests
 * 
 * Tests for the candle replay engine used in backtesting
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { CandleReplayEngine } from '../../src/backtesting/CandleReplayEngine';
import { SimulatedMT5Adapter } from '../../src/backtesting/SimulatedMT5Adapter';
import { SimulatedRiskService } from '../../src/backtesting/SimulatedRiskService';
import { ExecutionFilterState } from '../../src/strategy/v3/ExecutionFilterState';
import { OpenTradesService } from '../../src/services/OpenTradesService';
import { HistoricalCandle } from '../../src/backtesting/types';
import { GuardrailDecision } from '../../src/types';

describe('CandleReplayEngine', () => {
  let replayEngine: CandleReplayEngine;
  let simulatedMT5: SimulatedMT5Adapter;
  let simulatedRisk: SimulatedRiskService;
  let executionFilterState: ExecutionFilterState;
  let openTradesService: OpenTradesService;

  beforeEach(() => {
    simulatedMT5 = new SimulatedMT5Adapter({
      initialBalance: 10000,
      spreadPips: 2,
    });

    simulatedRisk = new SimulatedRiskService({
      initialBalance: 10000,
    });

    executionFilterState = new ExecutionFilterState();

    openTradesService = new OpenTradesService({
      mt5BaseUrl: 'http://localhost:3030',
      pollIntervalSec: 10,
      defaultRiskPerTrade: 75.0,
    });

    replayEngine = new CandleReplayEngine({
      strategy: 'low',
      executionFilterState,
      openTradesService,
      simulatedMT5,
      simulatedRisk,
      guardrailMode: 'normal',
    });
  });

  describe('processCandle', () => {
    it('should process a candle and potentially generate trades', async () => {
      const candle: HistoricalCandle = {
        symbol: 'XAUUSD',
        timestamp: Date.now(),
        open: 2650.0,
        high: 2655.0,
        low: 2648.0,
        close: 2652.0,
        volume: 100,
      };

      const guardrailDecision: GuardrailDecision = {
        can_trade: true,
        mode: 'normal',
        active_windows: [],
        reason_summary: 'Normal mode',
      };

      // Process candle (may or may not generate a trade depending on strategy)
      await replayEngine.processCandle(candle, guardrailDecision);

      // Check if any trades were generated
      const trades = replayEngine.getTrades();
      // Note: Trades are only created when positions are closed
      // For a full test, we'd need to set up a complete scenario
      expect(Array.isArray(trades)).toBe(true);
    });
  });

  describe('getTrades', () => {
    it('should return empty array initially', () => {
      const trades = replayEngine.getTrades();
      expect(trades).toEqual([]);
    });
  });
});


