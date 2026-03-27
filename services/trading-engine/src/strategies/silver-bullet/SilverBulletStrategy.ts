/**
 * Silver Bullet Strategy - IStrategy Implementation
 *
 * ICT Silver Bullet: Liquidity sweep + displacement + FVG entry
 * during 3 precise 1-hour time windows.
 *
 * Implementation key: SILVER_BULLET_V1
 */

import { Logger } from '@providencex/shared-utils';
import { IStrategy, StrategyContext, StrategyResult } from '../types';
import { StrategyProfile } from '../profiles/types';
import { MarketDataService } from '../../services/MarketDataService';
import { LiquiditySweepService } from '../../strategy/v2/LiquiditySweepService';
import { FairValueGapService } from '../../strategy/v2/FairValueGapService';
import { DisplacementCheckService } from '../../strategy/v2/DisplacementCheckService';
import { SilverBulletTimeWindowService } from './SilverBulletTimeWindowService';
import { SilverBulletEntryService } from './SilverBulletEntryService';
import { TradeSignal } from '../../types';

const logger = new Logger('SilverBullet');

export class SilverBulletStrategy implements IStrategy {
  readonly key = 'SILVER_BULLET_V1';
  readonly displayName = 'ICT Silver Bullet';

  private profile: StrategyProfile;
  private marketDataService: MarketDataService;
  private _lastWindowLog: number = 0;
  private timeWindowService: SilverBulletTimeWindowService;
  private entryService: SilverBulletEntryService;

  constructor(profile: StrategyProfile) {
    this.profile = profile;
    this.marketDataService = new MarketDataService();

    const cfg = profile.config || {};

    this.timeWindowService = new SilverBulletTimeWindowService(
      cfg.windows || ['LDN_OPEN', 'NY_AM', 'NY_PM']
    );

    const liquidityService = new LiquiditySweepService(
      cfg.liquidityTolerance || 0.0001,
      cfg.liquidityLookback || 50
    );

    const fvgService = new FairValueGapService(50, true);

    const displacementService = new DisplacementCheckService([{
      symbol: '*',
      minATRMultiplier: cfg.minATRMultiplier || 1.5,
      atrLookbackPeriod: 20,
    }]);

    this.entryService = new SilverBulletEntryService(
      liquidityService,
      fvgService,
      displacementService,
      {
        minRiskReward: cfg.minRiskReward || 2.0,
        minATRMultiplier: cfg.minATRMultiplier || 1.5,
        liquidityLookback: cfg.liquidityLookback || 50,
        m15CandleCount: cfg.m15Candles || 100,
        m1CandleCount: cfg.m1Candles || 100,
        slBufferPips: cfg.slBufferPips || 2,
      }
    );

    logger.info(`[SilverBullet] Initialized with profile: ${profile.key}`);
  }

  async execute(context: StrategyContext): Promise<StrategyResult> {
    const { symbol } = context;

    // Step 1: Get candle data (need candle time for window check in backtesting)
    const marketData = context.marketDataService || this.marketDataService;
    const m15Count = this.profile.config?.m15Candles || 100;
    const m1Count = this.profile.config?.m1Candles || 100;

    let m15Candles, m1Candles;
    try {
      m15Candles = await marketData.getRecentCandles(symbol, 'M15', m15Count);
      m1Candles = await marketData.getRecentCandles(symbol, 'M1', m1Count);
    } catch (err) {
      logger.error(`[SilverBullet] Failed to get candles for ${symbol}`, err);
      return { orders: [], debug: { reason: 'Candle data unavailable' } };
    }

    if (!m15Candles || m15Candles.length < 20 || !m1Candles || m1Candles.length < 20) {
      return {
        orders: [],
        debug: { reason: `Insufficient candles: M15=${m15Candles?.length || 0}, M1=${m1Candles?.length || 0}` },
      };
    }

    // Step 2: Check time window (use last candle time for backtest compatibility)
    const lastCandle = m1Candles[m1Candles.length - 1];
    // Candle type has `timestamp` (ISO string) or `startTime` (Date)
    const rawTime = (lastCandle as any).timestamp || (lastCandle as any).startTime;
    const candleTime = rawTime instanceof Date ? rawTime : new Date(rawTime || Date.now());
    const windowCheck = this.timeWindowService.isInSilverBulletWindow(candleTime);

    if (!windowCheck.active || !windowCheck.window) {
      return {
        orders: [],
        debug: { reason: `Outside Silver Bullet window`, symbol },
      };
    }
    console.log(`[SB-DEBUG] IN WINDOW: ${symbol} at ${candleTime.toISOString()} → ${windowCheck.window.label}`);
    logger.info(`[SilverBullet] ${symbol}: In ${windowCheck.window.label} window at ${candleTime}`);

    // Step 3: Run Silver Bullet analysis
    const setup = this.entryService.analyzeSilverBullet(
      m15Candles, m1Candles, symbol, windowCheck.window
    );

    if (!setup || !setup.isValid) {
      return {
        orders: [],
        debug: { reason: 'No valid Silver Bullet setup', window: windowCheck.window.name, symbol },
      };
    }

    // Step 4: Build TradeSignal
    const signal: TradeSignal = {
      symbol,
      direction: setup.direction,
      entry: setup.entryPrice,
      stopLoss: setup.stopLoss,
      takeProfit: setup.takeProfit,
      orderKind: 'market',
      reason: `Silver Bullet: ${setup.reasons.join('; ')}`,
      meta: {
        strategyKey: this.key,
        profileKey: this.profile.key,
        silverBulletWindow: setup.window.name,
        sweepType: setup.sweepType,
        sweptLevel: setup.sweptLevel,
        fvgHigh: setup.fvgHigh,
        fvgLow: setup.fvgLow,
        riskRewardRatio: setup.riskRewardRatio,
        reasons: setup.reasons,
        setupContext: setup.setupContext,
      },
    };

    logger.info(
      `[SilverBullet] ${symbol}: ${setup.direction.toUpperCase()} @ ${setup.entryPrice.toFixed(2)} ` +
      `| SL: ${setup.stopLoss.toFixed(2)} | TP: ${setup.takeProfit.toFixed(2)} ` +
      `| R:R ${setup.riskRewardRatio} | ${setup.window.label}`
    );

    return {
      orders: [{ signal, metadata: { strategyKey: this.key, setup: setup.setupContext } }],
      debug: { window: setup.window.name, rr: setup.riskRewardRatio, symbol },
    };
  }
}
