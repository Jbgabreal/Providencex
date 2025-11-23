import { Router, Request, Response } from 'express';
import { Logger } from '@providencex/shared-utils';
import { MarketDataService } from '../services/MarketDataService';
import { StrategyService } from '../services/StrategyService';
import { GuardrailService } from '../services/GuardrailService';
import { RiskService } from '../services/RiskService';
import { ExecutionService } from '../services/ExecutionService';
import { getConfig } from '../config';
import { Strategy, RiskContext } from '../types';
import { getNowInPXTimezone } from '@providencex/shared-utils';

const router: Router = Router();
const logger = new Logger('SimulateSignal');

// Mock daily stats for simulation
const mockStats = {
  todayPnL: 0,
  tradesToday: 0,
};

function getAccountEquity(): number {
  return parseFloat(process.env.MOCK_ACCOUNT_EQUITY || '10000');
}

/**
 * Convert price distance to pips based on symbol type
 * This is a simplified conversion for demo purposes
 */
function convertPriceDistanceToPips(symbol: string, priceDistance: number): number {
  symbol = symbol.toUpperCase();
  
  // Forex pairs (EURUSD, GBPUSD): 1 pip = 0.0001 (4 decimal places)
  if (symbol === 'EURUSD' || symbol === 'GBPUSD') {
    return priceDistance / 0.0001; // Convert to pips
  }
  
  // XAUUSD (Gold): 1 pip = 0.1 (1 decimal place typically, but can be 2)
  if (symbol === 'XAUUSD' || symbol === 'GOLD') {
    return priceDistance / 0.1; // Convert to pips
  }
  
  // US30: 1 point = 1.0
  if (symbol === 'US30' || symbol === 'DOW') {
    return priceDistance; // Already in points
  }
  
  // Default: assume forex-like (0.0001 per pip)
  // This is a fallback for unknown symbols
  return priceDistance / 0.0001;
}

// POST /simulate-signal
router.post('/', async (req, res) => {
  try {
    const { symbol = 'XAUUSD', strategy = 'low' as Strategy } = req.body;

    logger.info(`Simulating signal for ${symbol} with ${strategy} strategy`);

    const config = getConfig();
    const accountEquity = getAccountEquity();

    // Initialize services
    const marketDataService = new MarketDataService();
    const strategyService = new StrategyService(marketDataService);
    const guardrailService = new GuardrailService();
    const riskService = new RiskService();
    const executionService = new ExecutionService();

    // Step 1: Check guardrail
    logger.debug('Checking guardrail...');
    const guardrailDecision = await guardrailService.getDecision(strategy);

    const result: any = {
      symbol,
      strategy,
      timestamp: getNowInPXTimezone().toISO()!,
      guardrail: {
        can_trade: guardrailDecision.can_trade,
        mode: guardrailDecision.mode,
        reason: guardrailDecision.reason_summary,
        active_windows: guardrailDecision.active_windows,
      },
    };

    if (!guardrailDecision.can_trade || guardrailDecision.mode === 'blocked') {
      result.decision = 'skip';
      result.reason = `Guardrail blocked: ${guardrailDecision.reason_summary}`;
      return res.json(result);
    }

    // Step 2: Generate signal
    logger.debug('Generating signal...');
    const signal = await strategyService.generateSignal(symbol);

    if (!signal) {
      result.decision = 'skip';
      result.reason = 'No valid SMC setup found';
      result.guardrail = guardrailDecision;
      return res.json(result);
    }

    result.signal = {
      direction: signal.direction,
      entry: signal.entry,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      reason: signal.reason,
      meta: signal.meta,
    };

    // Step 3: Check spread
    const spread = await marketDataService.getCurrentSpread(symbol);
    result.spread = spread;
    result.spread_acceptable = riskService.isSpreadAcceptable(symbol, spread);

    if (!result.spread_acceptable) {
      result.decision = 'skip';
      result.reason = `Spread too wide: ${spread} > ${config.maxSpread}`;
      return res.json(result);
    }

    // Step 4: Check risk
    const riskContext: RiskContext = {
      strategy,
      account_equity: accountEquity,
      today_realized_pnl: mockStats.todayPnL,
      trades_taken_today: mockStats.tradesToday,
      guardrail_mode: guardrailDecision.mode,
    };

    const riskCheck = riskService.canTakeNewTrade(riskContext);
    result.risk_check = {
      allowed: riskCheck.allowed,
      reason: riskCheck.reason,
      adjusted_risk_percent: riskCheck.adjusted_risk_percent,
    };

    if (!riskCheck.allowed) {
      result.decision = 'skip';
      result.reason = riskCheck.reason || 'Risk check failed';
      return res.json(result);
    }

    // Step 5: Calculate position size
    // Convert price difference to pips based on symbol
    const stopLossDistance = Math.abs(signal.entry - signal.stopLoss);
    const stopLossPips = convertPriceDistanceToPips(symbol, stopLossDistance);
    const lotSize = riskService.getPositionSize(riskContext, stopLossPips, signal.entry);

    result.position_size = {
      lot_size: lotSize,
      risk_percent: riskCheck.adjusted_risk_percent || (strategy === 'low' ? config.defaultLowRiskPerTrade : config.defaultHighRiskPerTrade),
      stop_loss_pips: stopLossPips,
    };

    // Step 6: Simulate execution (or actually execute if in dev mode)
    const executeTrade = req.body.execute === true; // Optional flag to actually execute
    let executionResult;

    if (executeTrade) {
      logger.info('Executing trade (execute=true)...');
      executionResult = await executionService.openTrade(signal, lotSize, strategy);
    } else {
      logger.info('Simulating execution (execute=false)...');
      executionResult = {
        success: true,
        ticket: 'SIM-' + Date.now(),
        note: 'Trade execution simulated - set execute=true in request body to actually execute',
      };
    }

    result.execution = executionResult;
    result.decision = executionResult.success ? 'trade' : 'skip';
    result.final_reason = executionResult.success
      ? 'Trade would be executed successfully'
      : `Execution failed: ${executionResult.error}`;

    res.json(result);
  } catch (error) {
    logger.error('Error in simulate-signal', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;

