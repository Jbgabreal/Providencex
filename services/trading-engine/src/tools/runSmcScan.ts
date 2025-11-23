/**
 * SMC Scanner Tool - Offline diagnostic tool to detect SMC setups over historical data
 * 
 * Usage: pnpm --filter @providencex/trading-engine smc:scan -- --symbol XAUUSD --days 30
 * 
 * Scans historical candles for XAUUSD (or other symbols) and reports:
 * - Number of SMC setups found (long/short)
 * - Skip reason distribution
 * - Setup details (entry, SL, TP, RR, confluence reasons)
 */

import { Logger } from '@providencex/shared-utils';
import { CandleStore } from '../marketData/CandleStore';
import { MarketDataService } from '../services/MarketDataService';
import { HistoricalBackfillService } from '../services/HistoricalBackfillService';
import { SMCStrategyV2 } from '../strategy/v2/SMCStrategyV2';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';

const logger = new Logger('SMCScan');

interface ScanResult {
  symbol: string;
  totalTicks: number;
  setups: {
    long: EnhancedRawSignalV2[];
    short: EnhancedRawSignalV2[];
  };
  skipReasons: Record<string, number>;
  timeRange: {
    start: string;
    end: string;
  };
}

/**
 * Scan historical candles for SMC setups
 */
async function scanSmcSetups(
  symbol: string,
  days: number = 30
): Promise<ScanResult> {
  logger.info(`[SMCScan] Starting SMC scan for ${symbol} (${days} days)`);

  // Initialize services (minimal context - no full engine)
  const candleStore = new CandleStore(10000); // Large enough for 30+ days
  const marketDataService = new MarketDataService(candleStore);
  const smcV2 = new SMCStrategyV2(marketDataService, {
    enabled: true,
    htfTimeframe: 'H1',
    itfTimeframe: 'M15',
    ltfTimeframe: 'M5', // Use M5 for LTF (not M1) to match production
  });

  // Backfill historical data
  const backfillService = new HistoricalBackfillService({
    candleStore,
    symbols: [symbol],
    mt5BaseUrl: process.env.MT5_CONNECTOR_URL || 'http://localhost:3030',
    backfillEnabled: true,
    backfillDays: days,
  });

  logger.info(`[SMCScan] Loading historical data for ${symbol}...`);
  await backfillService.backfillAll();

  // Get all M1 candles for the symbol
  const allM1Candles = candleStore.getCandles(symbol, 100000); // Get all available
  if (allM1Candles.length === 0) {
    logger.error(`[SMCScan] No candles loaded for ${symbol}`);
    throw new Error(`No historical data for ${symbol}`);
  }

  logger.info(`[SMCScan] Loaded ${allM1Candles.length} M1 candles for ${symbol}`);

  // Determine time range
  const startTime = allM1Candles[0].startTime;
  const endTime = allM1Candles[allM1Candles.length - 1].startTime;

  logger.info(
    `[SMCScan] Time range: ${startTime.toISOString()} to ${endTime.toISOString()}`
  );

  // Scan for setups (evaluate every M5 close)
  // Get M5 candles and evaluate at each close
  const m5Candles = await marketDataService.getRecentCandles(symbol, 'M5', 10000);
  
  logger.info(`[SMCScan] Evaluating ${m5Candles.length} M5 candles for setups...`);

  const setups: ScanResult['setups'] = {
    long: [],
    short: [],
  };
  const skipReasons: Record<string, number> = {};

  // Track consecutive evaluations to sample skip reasons (avoid spam)
  let tickCount = 0;
  const sampleRate = 10; // Log skip reason every N ticks

  // Enable SMC_DEBUG for detailed logging
  const originalDebug = process.env.SMC_DEBUG;
  process.env.SMC_DEBUG = 'true';

  try {
    // Evaluate with current state (all historical data loaded)
    // Note: This evaluates the current market state, not historical replay
    // For proper historical replay, we'd need to modify SMC v2 to work with time-travel
    // For diagnostic purposes, this still shows if structure detection is working
    
    logger.info(`[SMCScan] Evaluating current state with ${m5Candles.length} M5 candles loaded...`);
    
    try {
      const signal = await smcV2.generateEnhancedSignal(symbol);
      
      if (signal) {
        if (signal.direction === 'buy') {
          setups.long.push(signal);
        } else {
          setups.short.push(signal);
        }
        
        const rr = signal.takeProfit && signal.stopLoss ? 
          (signal.direction === 'buy' ? 
            ((signal.takeProfit - signal.entry) / (signal.entry - signal.stopLoss)).toFixed(2) :
            ((signal.entry - signal.takeProfit) / (signal.stopLoss - signal.entry)).toFixed(2)) : 'N/A';
        
        logger.info(
          `[SMCScan] ✅ SETUP FOUND: ${signal.direction.toUpperCase()} ` +
          `@ ${signal.entry.toFixed(2)}, SL=${signal.stopLoss.toFixed(2)}, TP=${signal.takeProfit.toFixed(2)}, ` +
          `RR=${rr}, Confluence=${signal.confluenceScore}/100`
        );
        logger.info(`[SMCScan] Setup reasons: ${signal.confluenceReasons.join(', ')}`);
      } else {
        logger.warn(`[SMCScan] ❌ No setup found with ${m5Candles.length} M5 candles loaded`);
        logger.warn(`[SMCScan] Check SMC_DEBUG logs above to see which filter rejected the setup`);
        skipReasons['no_setup_with_loaded_data'] = 1;
      }
      
      tickCount = 1; // Single evaluation for now
      
      // TODO: Implement proper historical replay where we evaluate at each M5 close
      // This would require modifying SMC v2 to accept a "current time" parameter
      // and only use candles before that time
      
    } catch (error) {
      logger.error(`[SMCScan] Error evaluating signal:`, error);
      skipReasons['evaluation_error'] = 1;
    }
  } finally {
    // Restore original debug setting
    if (originalDebug !== undefined) {
      process.env.SMC_DEBUG = originalDebug;
    } else {
      delete process.env.SMC_DEBUG;
    }
  }

  return {
    symbol,
    totalTicks: tickCount,
    setups,
    skipReasons,
    timeRange: {
      start: startTime.toISOString(),
      end: endTime.toISOString(),
    },
  };
}

/**
 * Print scan summary
 */
function printSummary(result: ScanResult): void {
  console.log('\n' + '='.repeat(80));
  console.log(`SMC Scan Summary for ${result.symbol}`);
  console.log('='.repeat(80));
  console.log(`Time range: ${result.timeRange.start} to ${result.timeRange.end}`);
  console.log(`Total ticks evaluated: ${result.totalTicks}`);
  console.log('\n📊 Setups Found:');
  console.log(`  Long setups: ${result.setups.long.length}`);
  if (result.setups.long.length > 0) {
    const avgRR = result.setups.long.reduce((sum, s) => {
      if (s.takeProfit && s.stopLoss) {
        const risk = s.entry - s.stopLoss;
        const reward = s.takeProfit - s.entry;
        return sum + (risk > 0 ? reward / risk : 0);
      }
      return sum;
    }, 0) / result.setups.long.length;
    console.log(`    Average RR: ${avgRR.toFixed(2)}`);
  }
  
  console.log(`  Short setups: ${result.setups.short.length}`);
  if (result.setups.short.length > 0) {
    const avgRR = result.setups.short.reduce((sum, s) => {
      if (s.takeProfit && s.stopLoss) {
        const risk = s.stopLoss - s.entry;
        const reward = s.entry - s.takeProfit;
        return sum + (risk > 0 ? reward / risk : 0);
      }
      return sum;
    }, 0) / result.setups.short.length;
    console.log(`    Average RR: ${avgRR.toFixed(2)}`);
  }
  
  console.log('\n⏭️  Skip Reasons (sampled):');
  const totalSkips = Object.values(result.skipReasons).reduce((a, b) => a + b, 0);
  const sortedReasons = Object.entries(result.skipReasons).sort((a, b) => b[1] - a[1]);
  for (const [reason, count] of sortedReasons) {
    const pct = totalSkips > 0 ? ((count / totalSkips) * 100).toFixed(1) : '0';
    console.log(`  - "${reason}": ${count} (${pct}%)`);
  }
  
  if (result.setups.long.length > 0 || result.setups.short.length > 0) {
    console.log('\n✅ Recent Setups:');
    const recentSetups = [...result.setups.long, ...result.setups.short]
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 5);
    
    for (const setup of recentSetups) {
      const rr = setup.takeProfit && setup.stopLoss ? 
        (setup.direction === 'buy' ? 
          ((setup.takeProfit - setup.entry) / (setup.entry - setup.stopLoss)).toFixed(2) :
          ((setup.entry - setup.takeProfit) / (setup.stopLoss - setup.entry)).toFixed(2)) : 'N/A';
      console.log(
        `  [${setup.direction.toUpperCase()}] ${new Date(setup.timestamp).toISOString()}: ` +
        `Entry=${setup.entry.toFixed(2)}, SL=${setup.stopLoss.toFixed(2)}, TP=${setup.takeProfit.toFixed(2)}, ` +
        `RR=${rr}, Confluence=${setup.confluenceScore}/100`
      );
    }
  }
  
  console.log('='.repeat(80) + '\n');
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let symbol = 'XAUUSD';
  let days = 30;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--symbol' && i + 1 < args.length) {
      symbol = args[i + 1];
      i++;
    } else if (args[i] === '--days' && i + 1 < args.length) {
      days = parseInt(args[i + 1], 10);
      i++;
    }
  }

  logger.info(`[SMCScan] Starting scan: symbol=${symbol}, days=${days}`);

  try {
    const result = await scanSmcSetups(symbol, days);
    printSummary(result);
    
    process.exit(0);
  } catch (error) {
    logger.error('[SMCScan] Scan failed:', error);
    console.error('\n❌ Scan failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('[SMCScan] Fatal error:', error);
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  });
}

export { scanSmcSetups, printSummary };

