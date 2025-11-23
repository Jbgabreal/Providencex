/**
 * BacktestRunner Unit Tests
 * 
 * Tests for the main backtest runner orchestrator
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import { BacktestRunner } from '../../src/backtesting/BacktestRunner';
import { BacktestConfig } from '../../src/backtesting/types';

describe('BacktestRunner', () => {
  let config: BacktestConfig;

  beforeEach(() => {
    config = {
      symbol: 'XAUUSD',
      strategies: ['low'],
      startDate: '2024-01-01',
      endDate: '2024-01-02', // Short range for testing
      timeframe: 'M5',
      initialBalance: 10000,
      dataSource: 'mock',
    };
  });

  describe('constructor', () => {
    it('should create a BacktestRunner instance', () => {
      const dataLoaderConfig = {
        dataSource: 'mock' as const,
      };

      const runner = new BacktestRunner(config, dataLoaderConfig);
      expect(runner).toBeDefined();
    });
  });

  describe('run', () => {
    it('should run a backtest and return results', async () => {
      const dataLoaderConfig = {
        dataSource: 'mock' as const,
      };

      const runner = new BacktestRunner(config, dataLoaderConfig);
      const result = await runner.run();

      expect(result).toBeDefined();
      expect(result.runId).toBeDefined();
      expect(result.config).toEqual(config);
      expect(result.stats).toBeDefined();
      expect(result.trades).toBeDefined();
      expect(result.equityCurve).toBeDefined();
      expect(result.initialBalance).toBe(10000);
    }, 30000); // Allow 30 seconds for backtest to complete
  });
});


