/**
 * SimulatedMT5Adapter Unit Tests
 * 
 * Tests for the simulated MT5 adapter used in backtesting
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { SimulatedMT5Adapter } from '../../src/backtesting/SimulatedMT5Adapter';
import { HistoricalCandle } from '../../src/backtesting/types';

describe('SimulatedMT5Adapter', () => {
  let adapter: SimulatedMT5Adapter;

  beforeEach(() => {
    adapter = new SimulatedMT5Adapter({
      initialBalance: 10000,
      spreadPips: 2,
      slippagePips: 0,
    });
  });

  describe('openTrade', () => {
    it('should open a buy trade at ask price', () => {
      const candle: HistoricalCandle = {
        symbol: 'XAUUSD',
        timestamp: Date.now(),
        open: 2650.0,
        high: 2655.0,
        low: 2648.0,
        close: 2652.0,
        volume: 100,
      };

      const position = adapter.openTrade({
        symbol: 'XAUUSD',
        direction: 'buy',
        volume: 0.1,
        entryPrice: 2650.0,
        stopLoss: 2645.0,
        takeProfit: 2660.0,
        currentCandle: candle,
      });

      expect(position.ticket).toBeGreaterThan(0);
      expect(position.symbol).toBe('XAUUSD');
      expect(position.direction).toBe('buy');
      expect(position.volume).toBe(0.1);
      expect(position.sl).toBe(2645.0);
      expect(position.tp).toBe(2660.0);
    });

    it('should open a sell trade at bid price', () => {
      const candle: HistoricalCandle = {
        symbol: 'XAUUSD',
        timestamp: Date.now(),
        open: 2650.0,
        high: 2655.0,
        low: 2648.0,
        close: 2652.0,
        volume: 100,
      };

      const position = adapter.openTrade({
        symbol: 'XAUUSD',
        direction: 'sell',
        volume: 0.1,
        entryPrice: 2650.0,
        stopLoss: 2655.0,
        takeProfit: 2640.0,
        currentCandle: candle,
      });

      expect(position.direction).toBe('sell');
      expect(position.sl).toBe(2655.0);
      expect(position.tp).toBe(2640.0);
    });
  });

  describe('closeTrade', () => {
    it('should close a position and calculate profit correctly', () => {
      const candle: HistoricalCandle = {
        symbol: 'XAUUSD',
        timestamp: Date.now(),
        open: 2650.0,
        high: 2655.0,
        low: 2648.0,
        close: 2652.0,
        volume: 100,
      };

      const position = adapter.openTrade({
        symbol: 'XAUUSD',
        direction: 'buy',
        volume: 0.1,
        entryPrice: 2650.0,
        currentCandle: candle,
      });

      const exitPrice = 2655.0;
      const result = adapter.closeTrade(position.ticket, exitPrice, Date.now() + 60000);

      expect(result.success).toBe(true);
      expect(result.profit).toBeDefined();
      expect(result.profit).toBeGreaterThan(0); // Should be profitable
    });
  });

  describe('checkStopLossTakeProfit', () => {
    it('should detect SL hit for buy position', () => {
      const candle: HistoricalCandle = {
        symbol: 'XAUUSD',
        timestamp: Date.now(),
        open: 2650.0,
        high: 2655.0,
        low: 2643.0, // Below SL
        close: 2652.0,
        volume: 100,
      };

      const position = adapter.openTrade({
        symbol: 'XAUUSD',
        direction: 'buy',
        volume: 0.1,
        entryPrice: 2650.0,
        stopLoss: 2645.0,
        currentCandle: candle,
      });

      const hits = adapter.checkStopLossTakeProfit(candle);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].ticket).toBe(position.ticket);
      expect(hits[0].reason).toBe('sl');
    });

    it('should detect TP hit for sell position', () => {
      const candle: HistoricalCandle = {
        symbol: 'XAUUSD',
        timestamp: Date.now(),
        open: 2650.0,
        high: 2655.0,
        low: 2635.0, // Below TP
        close: 2652.0,
        volume: 100,
      };

      const position = adapter.openTrade({
        symbol: 'XAUUSD',
        direction: 'sell',
        volume: 0.1,
        entryPrice: 2650.0,
        takeProfit: 2640.0,
        currentCandle: candle,
      });

      const hits = adapter.checkStopLossTakeProfit(candle);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].ticket).toBe(position.ticket);
      expect(hits[0].reason).toBe('tp');
    });
  });
});


