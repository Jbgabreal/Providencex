/**
 * SMCStrategyV2 - Main orchestrator for SMC v2 strategy (Trading Engine v10)
 * 
 * Combines all SMC v2 components:
 * - Multi-timeframe structure analysis
 * - FVG detection
 * - Premium/Discount zones
 * - SMT Divergence
 * - Order Block v2 (multi-TF)
 * - Liquidity Sweep (EQH/EQL)
 * - Entry Refinement (M1)
 * - Volume Imbalance
 * - Session Filters
 * 
 * Generates EnhancedRawSignalV2 when all confluences align.
 */

import { Logger } from '@providencex/shared-utils';
import { MarketDataService } from '../../services/MarketDataService';
import { Candle as MarketDataCandle } from '../../marketData/types';
import { EnhancedRawSignalV2 } from '@providencex/shared-types';
import { MarketStructureHTF } from './MarketStructureHTF';
import { MarketStructureITF } from './MarketStructureITF';
import { MarketStructureLTF } from './MarketStructureLTF';
import { FairValueGapService } from './FairValueGapService';
import { PremiumDiscountService } from './PremiumDiscountService';
import { SMTDivergenceService } from './SMTDivergenceService';
import { OrderBlockServiceV2 } from './OrderBlockServiceV2';
import { LiquiditySweepService } from './LiquiditySweepService';
import { EntryRefinementService, EntryRefinementResult } from './EntryRefinementService';
import { VolumeImbalanceService } from './VolumeImbalanceService';
import { SessionFilterService } from './SessionFilterService';
import { getAllowedSessions } from '../../config/smcSessionConfig';
import { TrendlineLiquidityService } from './TrendlineLiquidityService';
import { ADRFilterService } from './ADRFilterService';
import { DisplacementCheckService, DisplacementCheckResult } from './DisplacementCheckService';
import { SetupGateService } from './SetupGateService';
import { SMCV2Result, SMCV2Context, OrderBlockV2 } from './types';
import { HTFBiasService, HTFBiasResult } from './HTFBiasService';
import { ITFBiasService, ITFBiasResult } from './ITFBiasService';
import { ITFSetupZoneService, ITFSetupZone } from './ITFSetupZoneService';
import { M1ExecutionService, M1ExecutionResult } from './M1ExecutionService';
import { ICTEntryService, ICTEntryResult } from './ICTEntryService';

const logger = new Logger('SMCStrategyV2');

export interface SMCV2Config {
  enabled: boolean;
  htfTimeframe: string; // e.g., 'H1', 'H4'
  itfTimeframe: string; // e.g., 'M15', 'M5'
  ltfTimeframe: string; // e.g., 'M1', 'M5'
  timezone: string;
  // v11 Parameter overrides for optimization
  paramOverrides?: import('../../optimization/OptimizationTypes').SMC_V2_ParamSet;
}

export class SMCStrategyV2 {
  private marketDataService: MarketDataService;
  private config: SMCV2Config;
  
  // Component services
  private htfStructure: MarketStructureHTF;
  private itfStructure: MarketStructureITF;
  private ltfStructure: MarketStructureLTF;
  private fvgService: FairValueGapService;
  private pdService: PremiumDiscountService;
  private smtService: SMTDivergenceService;
  private obService: OrderBlockServiceV2;
  private sweepService: LiquiditySweepService;
  private entryRefinement: EntryRefinementService;
  private viService: VolumeImbalanceService;
  private sessionFilter: SessionFilterService;
  private trendlineService: TrendlineLiquidityService;
  private adrFilterService: ADRFilterService;
  private displacementCheckService: DisplacementCheckService;
  private setupGateService: SetupGateService; // v15d: Strict setup qualification gate
  private htfBiasService: HTFBiasService; // New: H4 bias service
  private itfBiasService: ITFBiasService; // New: M15 bias service (derived from ChoCHService)
  private itfSetupZoneService: ITFSetupZoneService; // New: M15 setup zone service
  private m1ExecutionService: M1ExecutionService; // New: M1 execution service
  private ictEntryService: ICTEntryService; // New: ICT entry service (strict ICT model)
  private paramOverrides?: import('../../optimization/OptimizationTypes').SMC_V2_ParamSet;
  private tpRMult: number; // R:R multiplier for take profit calculation
  
  // Metrics counters for strategy evaluation
  private metrics = {
    totalEvaluations: 0,
    passedHTFFilter: 0,
    passedITFAlignment: 0,
    passedITFAlignmentSkipped: 0,
    validLTFChoCH: 0,
    actualTrades: 0,
  };
  
  // Config: Allow skipping ITF alignment check
  private readonly SKIP_ITF_ALIGNMENT: boolean;
  
  // Config: Minimal entry debug mode (force-relaxed conditions)
  private readonly DEBUG_FORCE_MINIMAL_ENTRY: boolean;
  private defaultFvgMinSize: number;
  private defaultSweepTolerance: number;
  private defaultTrendlineTolerance: number;
  
  // Minimum candle requirements (Updated for M15/M1 timeframes)
  private readonly MIN_HTF_CANDLES: number; // M15: need fewer candles than H4 (15m is faster)
  private readonly MIN_ITF_CANDLES: number;    // M15 setup: configurable via env
  private readonly MIN_LTF_CANDLES = 10;    // M1 entry: keep as-is

  // BOS requirements (v15e: Configurable BOS requirements for backtesting/debugging)
  private readonly REQUIRE_LTF_BOS: boolean; // If true, LTF BOS is a hard requirement
  private readonly MIN_ITF_BOS_COUNT: number; // Minimum ITF BOS events required (0 = not required)

  // Rejection statistics (v15e: Track rejection reasons for analysis)
  private rejectedNoLtfBos = 0;
  private rejectedItfFlowNeutral = 0;
  private rejectedNoItfBos = 0;
  private rejectedOther = 0;

  constructor(
    marketDataService: MarketDataService,
    config: Partial<SMCV2Config> = {}
  ) {
    this.marketDataService = marketDataService;
    this.config = {
      enabled: config.enabled !== false,
      htfTimeframe: config.htfTimeframe || 'H4', // ICT Model: H4 is Bias TF
      itfTimeframe: config.itfTimeframe || 'M15', // ICT Model: M15 is Setup TF
      ltfTimeframe: config.ltfTimeframe || 'M1', // ICT Model: M1 is Entry TF
      timezone: config.timezone || 'America/New_York',
    };
    
    // Initialize minimum candle requirements
    // HTF (H4) minimum is configurable via env var, defaulting to 10 (relaxed for backtesting)
    this.MIN_HTF_CANDLES = parseInt(process.env.SMC_MIN_HTF_CANDLES || '10', 10);
    this.MIN_ITF_CANDLES = parseInt(process.env.SMC_MIN_ITF_CANDLES || '20', 10);

    // Initialize BOS requirements (v15e: Configurable for backtesting/debugging)
    // Default: relaxed mode (do not require LTF BOS and no ITF BOS requirement)
    this.REQUIRE_LTF_BOS = (process.env.SMC_REQUIRE_LTF_BOS || 'false').toLowerCase() === 'true';
    // 0 = do not require ITF BOS, 1 = at least 1 BOS event, etc.
    this.MIN_ITF_BOS_COUNT = parseInt(process.env.SMC_MIN_ITF_BOS_COUNT || '0', 10);
    
    // Config: Allow skipping ITF alignment check (for debugging/backtesting)
    this.SKIP_ITF_ALIGNMENT = (process.env.SMC_SKIP_ITF_ALIGNMENT || 'false').toLowerCase() === 'true';
    
    // Config: Minimal entry debug mode (default to true for backtesting)
    // This mode only requires HTF bias + LTF ChoCH, ignoring ITF/POI filters
    this.DEBUG_FORCE_MINIMAL_ENTRY = (process.env.SMC_DEBUG_FORCE_MINIMAL_ENTRY || 'true').toLowerCase() === 'true';
    
    // Log config
    logger.info('[Strategy-low] ITF alignment config', {
      SMC_SKIP_ITF_ALIGNMENT: this.SKIP_ITF_ALIGNMENT,
      SMC_DEBUG_FORCE_MINIMAL_ENTRY: this.DEBUG_FORCE_MINIMAL_ENTRY,
    });

    // Log BOS configuration at startup
    logger.info(
      `[SMCStrategyV2] BOS requirements: REQUIRE_LTF_BOS=${this.REQUIRE_LTF_BOS}, ` +
      `MIN_ITF_BOS_COUNT=${this.MIN_ITF_BOS_COUNT}`
    );

    // Initialize component services with parameter overrides (v11)
    // Note: Thresholds should be symbol-aware (XAUUSD needs larger values than FX pairs)
    const params = config.paramOverrides || {};
    
    // Symbol-aware thresholds: XAUUSD and US30 need larger values (price ~2600-2700 and ~39000-40000)
    // FX pairs (EURUSD, GBPUSD) use smaller values (price ~1.0-1.3)
    // Default thresholds are optimized for FX; will be adjusted per-symbol at runtime
    const defaultFvgMinSize = params.fvgMinSize || 0.0001;
    const defaultSweepTolerance = params.itfLiquiditySweepTolerance || 0.0001;
    const defaultTrendlineTolerance = 0.0001;
    
    this.htfStructure = new MarketStructureHTF(params.htfSwingLookback || 50);
    this.itfStructure = new MarketStructureITF(params.itfBosSensitivity ? Math.floor(params.itfBosSensitivity * 30) : 30);
    this.ltfStructure = new MarketStructureLTF(params.ltfRefinementDepth || 20);
    this.fvgService = new FairValueGapService(defaultFvgMinSize, 50);
    this.pdService = new PremiumDiscountService(params.htfSwingLookback || 100);
    this.smtService = new SMTDivergenceService();
    this.obService = new OrderBlockServiceV2(
      params.obWickBodyRatioMin || 0.5,
      params.obMinVolumeFactor ? Math.floor(params.obMinVolumeFactor * 17) : 50
    );
    this.sweepService = new LiquiditySweepService(
      defaultSweepTolerance,
      50
    );
    this.entryRefinement = new EntryRefinementService();
    this.viService = new VolumeImbalanceService(
      params.obMinVolumeFactor || 1.5,
      20
    );
    
    // Apply session overrides if provided
    const sessionMap: Record<string, any> = {};
    if (params.allowedSessions) {
      sessionMap[Array.isArray(config.paramOverrides) ? '*' : '*'] = params.allowedSessions;
    }
    this.sessionFilter = new SessionFilterService(sessionMap, this.config.timezone);
    
    this.trendlineService = new TrendlineLiquidityService(
      params.ltfRefinementDepth || 2,
      defaultTrendlineTolerance
    );
    
    // Initialize ADR Filter Service with symbol-specific configs
    // XAUUSD: min 250 pips ADR, relaxed thresholds for trend-following trades
    // US30: min 150 points ADR, max 1.5x ADR multiplier
    this.adrFilterService = new ADRFilterService([
      {
        symbol: 'XAUUSD',
        adrLookbackDays: 14, // v15b: Increased lookback for more stable ADR
        minAdrPips: 250, // Below this: too choppy/dead
        maxAdrMultiplier: 1.5, // Legacy: kept for backward compatibility
        // v15b: Relaxed thresholds for XAUUSD trend-following trades
        adrHardLimitMultiple: 2.5, // Hard limit: only reject if > 2.5x ADR
        adrSoftMultiple: 1.2, // Below this is ideal (no penalty)
        adrPenaltyMultiple: 2.0, // Between 1.2x and 2.0x: small penalty, 2.0x-2.5x: heavy penalty
      },
      {
        symbol: 'US30',
        adrLookbackDays: 5,
        minAdrPips: 150, // Below this: too choppy/dead
        maxAdrMultiplier: 1.5, // Above this: too volatile
      },
    ]);
    
    // Initialize Setup Gate Service (v15d: Strict setup qualification gate)
    this.setupGateService = new SetupGateService();
    
    // Initialize Displacement Check Service with symbol-specific configs
    // v15c: XAUUSD uses soft mode (score-based) for trend-following, others can use hard filter
    this.displacementCheckService = new DisplacementCheckService([
      {
        symbol: 'XAUUSD',
        minATRMultiplier: 2.0, // Legacy threshold for isValid (body >= 60%, TR >= 2x ATR)
        atrLookbackPeriod: 20, // Use last 20 candles for ATR calculation
        // v15c: Soft mode for XAUUSD (trend-following trades won't be blocked by displacement)
        useAsHardFilter: false, // Soft mode: contributes to confluence score, doesn't hard-block
        strongBodyMinPct: 45, // Body% >= 45%: +10 score
        neutralBodyMinPct: 30, // Body% 30-45%: neutral, < 30%: -5 penalty
        strongAtrMinMultiple: 1.3, // TR >= 1.3x ATR: +10 score
        neutralAtrMinMultiple: 0.8, // TR 0.8-1.3x: neutral, < 0.8x: -5 penalty
        directionPenalty: -10, // Direction mismatch: -10 penalty
        weakPenalty: -5, // Weak body/ATR: -5 penalty
        strongBonus: 10, // Strong body/ATR: +10 bonus
      },
      {
        symbol: 'US30',
        minATRMultiplier: 2.0, // Legacy threshold for isValid
        atrLookbackPeriod: 20,
        // v15c: US30 can use hard filter (default behavior) or soft mode
        useAsHardFilter: true, // Hard filter: can SKIP if isValid === false
        strongBodyMinPct: 45,
        neutralBodyMinPct: 30,
        strongAtrMinMultiple: 1.3,
        neutralAtrMinMultiple: 0.8,
        directionPenalty: -10,
        weakPenalty: -5,
        strongBonus: 10,
      },
      {
        symbol: 'EURUSD',
        minATRMultiplier: 2.0,
        atrLookbackPeriod: 20,
      },
      {
        symbol: 'GBPUSD',
        minATRMultiplier: 2.0,
        atrLookbackPeriod: 20,
      },
    ]);
    
    // Initialize new services for bias → setup → entry flow
    this.htfBiasService = new HTFBiasService(20); // Look back 20 M15 candles (equivalent to ~5 hours, similar to 12 H4 candles)
    this.itfBiasService = new ITFBiasService(true); // Use structural swings
    this.itfSetupZoneService = new ITFSetupZoneService();

    // Read R:R ratio from environment (default 3.0 for 1:3 risk:reward)
    this.tpRMult = parseFloat(process.env.TP_R_MULT || '3.0');
    this.m1ExecutionService = new M1ExecutionService(this.tpRMult);
    logger.info(`[SMCStrategyV2] ✅ Risk:Reward Configuration - Using R:R = 1:${this.tpRMult} (TP_R_MULT=${this.tpRMult})`);
    
    // Initialize ICT Entry Service (strict ICT model)
    this.ictEntryService = new ICTEntryService();
    const useICTModel = (process.env.USE_ICT_MODEL || 'false').toLowerCase() === 'true';
    if (useICTModel) {
      logger.info(`[SMCStrategyV2] ✅ ICT Model ENABLED - Using strict H4→M15→M1 ICT pipeline`);
    } else {
      logger.info(`[SMCStrategyV2] ℹ️  ICT Model available but not enabled (set USE_ICT_MODEL=true to enable)`);
    }

    
    // Store default thresholds for symbol-aware adjustment
    this.defaultFvgMinSize = defaultFvgMinSize;
    this.defaultSweepTolerance = defaultSweepTolerance;
    this.defaultTrendlineTolerance = defaultTrendlineTolerance;
    
    // Store parameter overrides for later use
    this.paramOverrides = params;

    // Log session configuration
    const lowSessions = getAllowedSessions('low');
    const highSessions = getAllowedSessions('high');
    const lowEnv = process.env.SMC_LOW_ALLOWED_SESSIONS;
    const highEnv = process.env.SMC_HIGH_ALLOWED_SESSIONS;
    
    logger.info(
      `[SMCStrategyV2] Initialized: enabled=${this.config.enabled}, ` +
      `HTF=${this.config.htfTimeframe}, ITF=${this.config.itfTimeframe}, LTF=${this.config.ltfTimeframe}, ` +
      `MinCandles: HTF=${this.MIN_HTF_CANDLES}, ITF=${this.MIN_ITF_CANDLES}, LTF=${this.MIN_LTF_CANDLES}, ` +
      `SkipITFAlignment=${this.SKIP_ITF_ALIGNMENT}`
    );
    logger.info('[Strategy-low] Using SMCStrategyV2 implementation');
    logger.info(
      `[SMCStrategyV2] Session config - Low: [${lowSessions.join(', ')}] ${lowEnv ? `(env: ${lowEnv})` : '(default)'}, ` +
      `High: [${highSessions.join(', ')}] ${highEnv ? `(env: ${highEnv})` : '(default)'}`
    );
  }

  /**
   * Generate enhanced signal using SMC v2 logic
   * Overload 1: Returns signal or null (backward compatible)
   * Overload 2: Returns {signal, reason, debugReasons} when includeReasons is true
   */
  async generateEnhancedSignal(symbol: string): Promise<EnhancedRawSignalV2 | null>;
  async generateEnhancedSignal(symbol: string, includeReasons: true): Promise<{ signal: EnhancedRawSignalV2 | null; reason?: string; debugReasons?: string[] }>;
  async generateEnhancedSignal(symbol: string, includeReasons?: boolean): Promise<EnhancedRawSignalV2 | null | { signal: EnhancedRawSignalV2 | null; reason?: string; debugReasons?: string[] }> {
    const smcDebug = process.env.SMC_DEBUG === 'true';
    const returnReasons = includeReasons === true;
    const debugReasons: string[] = [];
    const debugMinimal = process.env.SMC_DEBUG_MINIMAL_ENTRY === 'true';
    
    // Increment total evaluations counter
    this.metrics.totalEvaluations++;
    
    // SENIOR DEV FIX: Always log ICT check for first 100 evaluations to debug execution flow
    const evalNum = this.metrics.totalEvaluations;
    const shouldLogICT = evalNum <= 100;
    
    // DEBUG: Log entry point (first 100 evaluations or when debug enabled)
    const shouldLogDebug = smcDebug || debugMinimal || evalNum <= 100;
    if (shouldLogDebug && evalNum % 50 === 0) {
      logger.info(`[SMC_DEBUG] ${symbol}: Evaluation #${evalNum} - generateEnhancedSignal called`);
    }
    
    // Helper to create rejection result
    const createRejection = (reason: string, additionalReasons?: string[]): EnhancedRawSignalV2 | null | { signal: null; reason: string; debugReasons: string[] } => {
      const allReasons = [reason, ...(additionalReasons || [])];
      if (returnReasons) {
        return { signal: null, reason, debugReasons: allReasons };
      }
      return null;
    };
    
    if (!this.config.enabled) {
      if (smcDebug) {
        logger.debug(`[SMCStrategyV2] Disabled for ${symbol}`);
      }
      return createRejection('SMC v2 disabled');
    }

    // Check if ICT Model is enabled - ALWAYS log for first 100 evaluations
    const useICTModel = (process.env.USE_ICT_MODEL || 'false').toLowerCase() === 'true';
    
    // SENIOR DEV FIX: Always log ICT check for first 100 evaluations - remove conditional
    if (shouldLogICT) {
      logger.info(`[SMCStrategyV2] [ICT-CHECK] ${symbol}: USE_ICT_MODEL='${process.env.USE_ICT_MODEL || 'not set'}', useICTModel=${useICTModel}, eval #${evalNum}`);
    }
    
    if (useICTModel) {
      // Always log for first 100 evaluations to debug ICT pipeline
      if (shouldLogICT) {
        logger.info(`[SMCStrategyV2] [ICT] ${symbol}: ✅ ICT Model enabled, calling generateICTSignal (eval #${evalNum})`);
      }
      try {
        return await this.generateICTSignal(symbol, returnReasons);
      } catch (error) {
        logger.error(`[SMCStrategyV2] [ICT] ${symbol}: ERROR in generateICTSignal:`, error);
        throw error;
      }
    } else {
      // Log why ICT is not enabled for first 100 evaluations
      if (shouldLogICT) {
        logger.info(`[SMCStrategyV2] ${symbol}: ⚠️  ICT Model NOT enabled, using old SMC v2 logic (USE_ICT_MODEL='${process.env.USE_ICT_MODEL || 'not set'}') [eval #${evalNum}]`);
      }
    }

    try {
      // Step 1: Get multi-timeframe candles
      // v15d: For H4, request 50 candles (enough for swing detection)
      const htfLimit = this.config.htfTimeframe === 'H4' ? 50 : 100;
      const htfCandles = await this.getCandles(symbol, this.config.htfTimeframe, htfLimit);
      const itfCandles = await this.getCandles(symbol, this.config.itfTimeframe, 100);
      const ltfCandles = await this.getCandles(symbol, this.config.ltfTimeframe, 50);

      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(`[SMC_DEBUG] ${symbol} candles: HTF=${htfCandles.length} (${this.config.htfTimeframe}), ITF=${itfCandles.length} (${this.config.itfTimeframe}), LTF=${ltfCandles.length} (${this.config.ltfTimeframe})`);
        if (htfCandles.length > 0) {
          logger.info(`[SMC_DEBUG] ${symbol} HTF range: ${htfCandles[0].startTime.toISOString()} to ${htfCandles[htfCandles.length - 1].startTime.toISOString()}, price range: ${Math.min(...htfCandles.map(c => c.low))} - ${Math.max(...htfCandles.map(c => c.high))}`);
        }
        if (itfCandles.length > 0) {
          logger.info(`[SMC_DEBUG] ${symbol} ITF range: ${itfCandles[0].startTime.toISOString()} to ${itfCandles[itfCandles.length - 1].startTime.toISOString()}, price range: ${Math.min(...itfCandles.map(c => c.low))} - ${Math.max(...itfCandles.map(c => c.high))}`);
        }
      }

      // Check minimum candle requirements (v15d: Adjusted for H4/M15/M1 timeframes)
      if (htfCandles.length < this.MIN_HTF_CANDLES || itfCandles.length < this.MIN_ITF_CANDLES || ltfCandles.length < this.MIN_LTF_CANDLES) {
        const reason = `Insufficient candles - HTF=${htfCandles.length} (need ${this.MIN_HTF_CANDLES}), ITF=${itfCandles.length} (need ${this.MIN_ITF_CANDLES}), LTF=${ltfCandles.length} (need ${this.MIN_LTF_CANDLES})`;
        // Always log candle requirement failures (first 50 evals)
        if (this.metrics.totalEvaluations <= 50) {
          logger.info(`[SMC_DEBUG] ${symbol}: ❌ INSUFFICIENT CANDLES - ${reason}`);
        }
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: ${reason}`);
        }
        return createRejection(reason);
      }

      // Step 2: Get current price (use latest candle close if available, fallback to service)
      let currentPrice = await this.marketDataService.getCurrentPrice(symbol);
      if (!currentPrice || currentPrice <= 0) {
        // Fallback: use latest candle close
        const latestCandles = [...htfCandles, ...itfCandles, ...ltfCandles];
        if (latestCandles.length > 0) {
          latestCandles.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
          currentPrice = latestCandles[0].close;
          if (smcDebug) {
            logger.debug(`[SMC_DEBUG] ${symbol}: Using latest candle close as current price: ${currentPrice}`);
          }
        }
      }
      
      if (!currentPrice || currentPrice <= 0) {
        const reason = `Invalid price (${currentPrice})`;
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: ${reason}`);
        }
        return createRejection(reason);
      }
      
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(`[SMC_DEBUG] ${symbol}: Current price = ${currentPrice}`);
      }

      // Step 3: Compute M15 bias (HTF is now M15, not H4)
      const htfBias = this.htfBiasService.computeHTFBias(htfCandles);

      // Step 3b: Analyze HTF structure to get formal trend (for sideways detection)
      const htfStructureEarly = this.htfStructure.analyzeStructure(htfCandles);

      // BALANCED: Check 15m trend strength - only trade in moderate+ trends
      // Require 35% trend strength - balanced between quality and opportunity
      const trendStrength = this.calculateTrendStrength(htfCandles, htfStructureEarly, htfBias);
      if (trendStrength < 0.35) { // BALANCED: Minimum 35% trend strength
        const reason = `15m trend too weak: ${(trendStrength * 100).toFixed(1)}% (minimum 35% required)`;
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: Skipping - weak trend strength`);
        }
        return createRejection(reason); // Skip this symbol
      }
      
      // BALANCED: Check volatility - avoid very low volatility periods (chop)
      // Low volatility = small candles, no clear direction
      const volatility = this.calculateVolatility(htfCandles);
      if (volatility < 0.25) { // BALANCED: Minimum 25% volatility - avoid only very choppy markets
        const reason = `15m volatility too low: ${(volatility * 100).toFixed(1)}% (minimum 25% required) - market is choppy`;
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: Skipping - low volatility (chop)`);
        }
        return createRejection(reason); // Skip this symbol
      }

      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(
          `[SMC_DEBUG] ${symbol}: HTF bias = ${htfBias.bias} (method: ${htfBias.method}), ` +
          `formal trend = ${htfStructureEarly.trend}, ` +
          `BOS count: bullish=${htfBias.bullishBosCount}, bearish=${htfBias.bearishBosCount}, ` +
          `anchor: ${htfBias.anchorSwing}@${htfBias.anchorPrice?.toFixed(2) || 'N/A'}`
        );
      }

      // NEW: Check if we should avoid sideways HTF conditions (FIXED: use formal trend, not bias)
      // CRITICAL: Always reject sideways HTF (15m) - only trade in clear trends
      const avoidSideways = true; // Hard-coded: always reject sideways (per screenshot workflow)
      if (avoidSideways && htfStructureEarly.trend === 'sideways') {
        const reason = `HTF is sideways/ranging - avoiding trade (formal trend=${htfStructureEarly.trend}, bias=${htfBias.bias})`;
        logger.info(`[Trend] HTF sideways detected - SKIP trade for ${symbol} (HTF trend filter active)`);
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
        }
        return createRejection(reason);
      }

      // Check HTF filter: HTF bias must be bullish/bearish (not neutral), or ICT PD fallback available
      // In minimal entry mode, allow neutral HTF bias (will infer direction from price)
      if (htfBias.bias === 'neutral') {
        // In minimal mode, allow neutral HTF bias (will infer direction later)
        if (this.DEBUG_FORCE_MINIMAL_ENTRY) {
          if (shouldLogDebug && this.metrics.totalEvaluations <= 100) {
            logger.info(`[SMC_DEBUG] ${symbol}: ✅ HTF FILTER PASSED (minimal mode - neutral bias allowed) - bias: ${htfBias.bias}`);
          }
        } else {
          // Check for ICT PD fallback (displacement-based bias)
          const pdCandles = symbol === 'XAUUSD' || symbol === 'US30' ? itfCandles : htfCandles;
          const premiumDiscount = this.pdService.determineZone(pdCandles, currentPrice, symbol);
          const pdBoundaries = this.pdService.getBoundaries(pdCandles);

          // If we have PD boundaries, we can use displacement fallback
          if (!pdBoundaries) {
            const reason = `HTF bias is neutral (no clear directional bias) and no ICT PD fallback available`;
            // Always log HTF filter rejections (first 100 evals or debug mode)
            if (shouldLogDebug && this.metrics.totalEvaluations <= 100) {
              logger.info(`[SMC_DEBUG] ${symbol}: ❌ HTF FILTER REJECTED - ${reason}`);
            }
            if (smcDebug) {
              logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
            }
            return createRejection(reason);
          }
          // If we have PD fallback, continue (will use PD-based direction)
          if (shouldLogDebug && this.metrics.totalEvaluations <= 100) {
            logger.info(`[SMC_DEBUG] ${symbol}: ✅ HTF FILTER PASSED (PD fallback) - bias: ${htfBias.bias}, PD: ${premiumDiscount}`);
          }
        }
      } else {
        // HTF bias is valid (bullish/bearish)
        this.metrics.passedHTFFilter++;
        if (shouldLogDebug && this.metrics.totalEvaluations <= 100) {
          logger.info(`[SMC_DEBUG] ${symbol}: ✅ HTF FILTER PASSED - bias: ${htfBias.bias}`);
        }
      }

      // DEBUG MODE: Minimal entry check (bypasses ITF/POI filters)
      if (this.DEBUG_FORCE_MINIMAL_ENTRY) {
        // Always log when entering minimal mode (first 200 evals or every 100th)
        if (this.metrics.totalEvaluations <= 200 || this.metrics.totalEvaluations % 100 === 0) {
          logger.info(`[SMC_DEBUG] ${symbol}: Entering minimal entry mode (DEBUG_FORCE_MINIMAL_ENTRY=true) - eval #${this.metrics.totalEvaluations}`);
        }
        
        // ULTRA-LENIENT MINIMAL MODE: Accept trades with minimal requirements
        // 1. Try to get HTF bias direction (or use PD fallback, or infer from price)
        let htfBiasDirection: 'bullish' | 'bearish' | null = null;
        
        if (htfBias.bias === 'bullish' || htfBias.bias === 'bearish') {
          htfBiasDirection = htfBias.bias;
        } else {
          // HTF bias is neutral - try PD fallback
          const pdCandles = symbol === 'XAUUSD' || symbol === 'US30' ? itfCandles : htfCandles;
          const premiumDiscount = this.pdService.determineZone(pdCandles, currentPrice, symbol);
          const pdBoundaries = this.pdService.getBoundaries(pdCandles);
          
          if (pdBoundaries) {
            // Use PD-based direction: discount = bullish, premium = bearish
            htfBiasDirection = premiumDiscount === 'discount' ? 'bullish' : 'bearish';
          } else {
            // Last resort: infer direction from recent price movement
            if (htfCandles.length >= 5) {
              const recentHtf = htfCandles.slice(-5);
              const priceTrend = recentHtf[recentHtf.length - 1].close > recentHtf[0].close ? 'bullish' : 'bearish';
              htfBiasDirection = priceTrend;
            } else if (itfCandles.length >= 5) {
              const recentItf = itfCandles.slice(-5);
              const priceTrend = recentItf[recentItf.length - 1].close > recentItf[0].close ? 'bullish' : 'bearish';
              htfBiasDirection = priceTrend;
            } else {
              // Very few candles - default to bullish (will be overridden by LTF if available)
              htfBiasDirection = 'bullish';
            }
          }
        }
        
        // 2. Get LTF structure and check for BOS/CHoCH/MSB (optional - not required in ultra-lenient mode)
        const ltfStructure = this.ltfStructure.analyzeStructure(ltfCandles, htfBiasDirection || 'bullish');
        const itfStructure = this.itfStructure.analyzeStructure(itfCandles, htfBiasDirection || 'bullish');
        
        // Check for any BOS/CHoCH/MSB event
        let finalLtfDirection: 'bullish' | 'bearish' | null = null;
        let hasAnyBos = false;
        
        // Check LTF BOS
        if (ltfStructure.lastBOS && ltfStructure.lastBOS.index < ltfCandles.length) {
          hasAnyBos = true;
          const bosCandle = ltfCandles[ltfStructure.lastBOS.index];
          
          // Infer direction from price movement
          if (ltfStructure.lastBOS.index > 0) {
            const prevCandle = ltfCandles[ltfStructure.lastBOS.index - 1];
            if (prevCandle) {
              finalLtfDirection = bosCandle.close > prevCandle.close ? 'bullish' : 'bearish';
            }
          }
        }
        
        // Check ITF BOS
        if (itfStructure.lastBOS && itfStructure.lastBOS.index < itfCandles.length) {
          hasAnyBos = true;
          if (!finalLtfDirection) {
            const itfBosCandle = itfCandles[itfStructure.lastBOS.index];
            if (itfStructure.lastBOS.index > 0) {
              const prevCandle = itfCandles[itfStructure.lastBOS.index - 1];
              if (prevCandle) {
                finalLtfDirection = itfBosCandle.close > prevCandle.close ? 'bullish' : 'bearish';
              }
            }
          }
        }
        
        // ULTRA-LENIENT: Accept trade if we have ANY direction (HTF bias, PD, or price trend)
        // BOS is nice-to-have but not required in minimal mode
        const entryDirection = finalLtfDirection || htfBiasDirection || 'bullish';
        
        // Log direction determination (first 200 evals)
        if (this.metrics.totalEvaluations <= 200) {
          logger.info(`[SMC_DEBUG] ${symbol}: Minimal mode direction check - finalLtfDirection=${finalLtfDirection}, htfBiasDirection=${htfBiasDirection}, entryDirection=${entryDirection}`);
        }
        
        // Always enter in minimal mode if we have any direction (ultra-lenient)
        // This should ALWAYS be true due to fallback to 'bullish'
        if (entryDirection === 'bullish' || entryDirection === 'bearish') {
          this.metrics.validLTFChoCH++;
          this.metrics.actualTrades++;
          
          // Always log minimal entry triggers (critical for debugging)
          logger.info(`[SMC_DEBUG] ${symbol}: ✅ MINIMAL ENTRY TRIGGERED - Direction: ${entryDirection}, HTF: ${htfBias.bias}, LTF: ${finalLtfDirection || 'none'}, hasBOS: ${hasAnyBos}, price: ${currentPrice.toFixed(2)}`);
          
          // Create a minimal signal
          const direction = entryDirection === 'bullish' ? 'buy' : 'sell';
          const entry = currentPrice;
          const risk = currentPrice * 0.01; // 1% risk
          const stopLoss = direction === 'buy' ? entry - risk : entry + risk;
          // Use configured R:R ratio (not hardcoded 2.0)
          const takeProfit = direction === 'buy' ? entry + (risk * this.tpRMult) : entry - (risk * this.tpRMult);
          
          const signal: EnhancedRawSignalV2 = {
            symbol,
            direction,
            entry,
            stopLoss,
            takeProfit,
            htfTrend: htfBiasDirection === 'bullish' ? 'bullish' : htfBiasDirection === 'bearish' ? 'bearish' : 'sideways',
            itfFlow: 'neutral',
            ltfBOS: !!ltfStructure.lastBOS,
            premiumDiscount: 'neutral',
            obLevels: {},
            fvgLevels: {},
            smt: { bullish: false, bearish: false },
            liquiditySweep: undefined,
            volumeImbalance: { zones: [], aligned: false },
            ltfEntryRefinedOB: undefined,
            ltfFVGResolved: false,
            ltfSweepConfirmed: false,
            sessionValid: true,
            session: 'london' as any,
            trendlineLiquidity: undefined,
            confluenceReasons: [`[DEBUG] Minimal entry: HTF=${htfBiasDirection || 'neutral'}, LTF=${finalLtfDirection || 'none'}, hasBOS=${hasAnyBos}`],
            confluenceScore: 50,
            timestamp: new Date().toISOString(),
            meta: { debug: true, minimalEntry: true },
          };
          
          // Log signal generation
          logger.info(`[SMC_DEBUG] ${symbol}: 🎯 SIGNAL GENERATED (minimal mode) - ${signal.direction.toUpperCase()} @ ${signal.entry.toFixed(2)}, SL: ${signal.stopLoss.toFixed(2)}, TP: ${signal.takeProfit.toFixed(2)}`);
          
          if (returnReasons) {
            return { signal, reason: undefined, debugReasons: signal.confluenceReasons };
          }
          
          return signal;
        } else {
          // This should never happen, but log it if it does
          if (shouldLogDebug && this.metrics.totalEvaluations <= 100) {
            logger.warn(`[SMC_DEBUG] ${symbol}: ❌ MINIMAL ENTRY FAILED - Could not determine direction (HTF: ${htfBias.bias}, LTF: ${finalLtfDirection || 'none'})`);
          }
        }
      }

      // Step 4: Derive ITF bias from ChoCHService (NEW: instead of MarketStructureITF.trend)
      const itfBias = this.itfBiasService.deriveITFBias(itfCandles);
      
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(
          `[SMC_DEBUG] ${symbol}: ITF bias = ${itfBias.bias} (method: ${itfBias.method}), ` +
          `BOS count: bullish=${itfBias.bosCount.bullish}, bearish=${itfBias.bosCount.bearish}, ` +
          `lastChoCH: ${itfBias.lastChoCh ? `${itfBias.lastChoCh.fromTrend}→${itfBias.lastChoCh.toTrend}` : 'none'}`
        );
      }
      
      // Step 5: Check ITF alignment with HTF bias (or skip if configured)
      // Determine HTF bias direction (for alignment check)
      const htfBiasForAlignment = htfBias.bias === 'bullish' ? 'bullish' : htfBias.bias === 'bearish' ? 'bearish' : null;
      let itfAligned = false;
      
      if (this.SKIP_ITF_ALIGNMENT) {
        // Skip ITF alignment check (for debugging/backtesting)
        itfAligned = true;
        this.metrics.passedITFAlignmentSkipped++;
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: ITF alignment check SKIPPED (SMC_SKIP_ITF_ALIGNMENT=true)`);
        }
      } else if (htfBiasForAlignment && itfBias.bias !== 'neutral' && itfBias.bias !== 'sideways') {
        // ITF bias must be aligned with HTF bias
        itfAligned = (htfBiasForAlignment === 'bullish' && itfBias.bias === 'bullish') ||
                     (htfBiasForAlignment === 'bearish' && itfBias.bias === 'bearish');
        
        if (itfAligned) {
          this.metrics.passedITFAlignment++;
        } else {
          const reason = `ITF bias (${itfBias.bias}) not aligned with HTF bias (${htfBiasForAlignment})`;
          if (smcDebug) {
            logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
          }
          return createRejection(reason);
        }
      } else {
        // HTF bias is neutral (using PD fallback) or ITF bias is neutral/sideways
        // Allow entry if ITF alignment is skipped or if we have PD fallback
        if (htfBiasForAlignment === null) {
          // Using PD fallback - allow entry
          itfAligned = true;
          this.metrics.passedITFAlignmentSkipped++;
        } else {
          const reason = `ITF bias is ${itfBias.bias} (cannot align with HTF bias ${htfBiasForAlignment})`;
          if (smcDebug) {
            logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
          }
          return createRejection(reason);
        }
      }
      
      // Step 6: Compute M15 setup zone (aligned with H4 bias, even if M15 is sideways)
      // In minimal entry mode, this check is more lenient - allow entry even without perfect zone
      const itfZone = this.itfSetupZoneService.computeITFSetupZone(itfCandles, htfBias, currentPrice);
      
      // If no ITF zone, create a synthetic zone from price range for minimal entry mode
      let effectiveZone: ITFSetupZone | null = itfZone;
      
      if (smcDebug && symbol === 'XAUUSD') {
        if (itfZone) {
          logger.info(
            `[SMC_DEBUG] ${symbol}: ITF setup zone: ${itfZone.direction}, ` +
            `zone=[${itfZone.priceMin.toFixed(2)}, ${itfZone.priceMax.toFixed(2)}], ` +
            `type=${itfZone.zoneType}, aligned=${itfZone.isAlignedWithHTF}`
          );
        } else {
          logger.info(`[SMC_DEBUG] ${symbol}: No ITF setup zone found (not aligned or no OB/FVG)`);
        }
      }
      
      if (!itfZone || !itfZone.isAlignedWithHTF) {
        if (this.DEBUG_FORCE_MINIMAL_ENTRY) {
          // In minimal entry mode, create a synthetic zone around current price
          // This allows entry even when no perfect OB/FVG is found
          const zoneSize = currentPrice * 0.01; // 1% price range as zone
          effectiveZone = {
            isAlignedWithHTF: true,
            direction: htfBias.bias === 'bullish' ? 'bullish' : 'bearish',
            zoneType: 'orderBlock' as any,
            priceMin: currentPrice - zoneSize,
            priceMax: currentPrice + zoneSize,
            sourceTime: new Date(),
          };
          
          if (smcDebug) {
            logger.info(`[SMC_DEBUG] ${symbol}: Using synthetic ITF zone for minimal entry: [${effectiveZone.priceMin.toFixed(2)}, ${effectiveZone.priceMax.toFixed(2)}]`);
          }
        } else {
          const reason = `No valid ITF setup zone aligned with H4 bias`;
          if (smcDebug) {
            logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
          }
          return createRejection(reason);
        }
      }

      // Step 7: Check M1 execution (NEW: micro CHoCH/MSB inside M15 zone)
      // Use effectiveZone (which may be synthetic in minimal entry mode)
      const m1Execution = this.m1ExecutionService.checkExecution(ltfCandles, htfBias, effectiveZone!, currentPrice);
      
      if (smcDebug && symbol === 'XAUUSD') {
        if (m1Execution.shouldEnter) {
          logger.info(
            `[SMC_DEBUG] ${symbol}: M1 execution: ${m1Execution.direction}, ` +
            `entry=${m1Execution.entryPrice?.toFixed(2)}, ` +
            `SL=${m1Execution.stopLoss?.toFixed(2)}, ` +
            `TP=${m1Execution.takeProfit?.toFixed(2)}, ` +
            `micro ${m1Execution.microChoch?.type} at ${m1Execution.microChoch?.price.toFixed(2)}`
          );
        } else {
          logger.info(`[SMC_DEBUG] ${symbol}: M1 execution: ${m1Execution.reason}`);
        }
      }
      
      if (!m1Execution.shouldEnter) {
        const reason = m1Execution.reason || 'M1 execution conditions not met';
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
        }
        return createRejection(reason);
      }
      
      // Valid LTF ChoCH detected
      if (m1Execution.microChoch) {
        this.metrics.validLTFChoCH++;
      }

      // Step 8: Analyze structure for confluence (reuse htfStructure from earlier)
      const htfStructure = htfStructureEarly; // Reuse the analysis from Step 3b
      const itfStructure = this.itfStructure.analyzeStructure(itfCandles, htfBias.bias === 'bullish' ? 'bullish' : 'bearish');
      const ltfStructure = this.ltfStructure.analyzeStructure(ltfCandles, htfBias.bias === 'bullish' ? 'bullish' : 'bearish');
      
      // Use bias direction for signal
      const direction = htfBias.bias === 'bullish' ? 'buy' : 'sell';

      // Step 9: Use M1 execution result for entry/stop/TP
      const entry = m1Execution.entryPrice!;
      const stopLoss = m1Execution.stopLoss!;
      const takeProfit = m1Execution.takeProfit!;
      
      // Increment actual trades counter
      this.metrics.actualTrades++;
      
      // Step 10: Calculate confluence (keep existing checks for scoring, but don't block)
      // For XAUUSD and US30: use ITF-based PD (M15, shorter window, more responsive)
      // For FX pairs: use HTF-based PD (H4, longer window, broader context)
      const useItfPd = symbol === 'XAUUSD' || symbol === 'US30';
      const pdCandles = useItfPd ? itfCandles : htfCandles;
      const premiumDiscount = this.pdService.determineZone(pdCandles, currentPrice, symbol);
      
      // Calculate PD score contribution (simplified: +10 if aligned, -5 if counter)
      let pdScoreContribution = 0;
      if ((direction === 'buy' && premiumDiscount === 'discount') || 
          (direction === 'sell' && premiumDiscount === 'premium')) {
        pdScoreContribution = 10; // Aligned
      } else if ((direction === 'buy' && premiumDiscount === 'premium') || 
                 (direction === 'sell' && premiumDiscount === 'discount')) {
        pdScoreContribution = -5; // Counter
      }
      
      // Determine trade context
      const isTrendFollowing = (htfBias.bias === 'bullish' && direction === 'buy') || 
                               (htfBias.bias === 'bearish' && direction === 'sell');
      
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(`[SMC_DEBUG] ${symbol}: Using ${useItfPd ? 'ITF/M15' : 'HTF/H4'}-based Premium/Discount calculation`);
        const pdBoundaries = this.pdService.getBoundaries(pdCandles);
        if (pdBoundaries) {
          logger.info(
            `[SMC_DEBUG] ${symbol}: Premium/Discount - zone=${premiumDiscount}, ` +
            `swingHigh=${pdBoundaries.premium.toFixed(2)}, swingLow=${pdBoundaries.discount.toFixed(2)}`
          );
        }
      }

      // Step 9: Detect Order Blocks for confluence (not hard requirements in new flow)
      // Use direction from signal (already determined from HTF bias or PD fallback)
      const htfBiasDirection = direction === 'buy' ? 'bullish' : 'bearish';
      const htfOBs = this.obService.detectOrderBlocks(htfCandles, 'HTF', htfBiasDirection);
      const itfOBs = this.obService.detectOrderBlocks(itfCandles, 'ITF', htfBiasDirection);
      const ltfOBs = this.obService.detectOrderBlocks(ltfCandles, 'LTF', htfBiasDirection);
      
      const htfOB = this.obService.getMostRecentUnmitigatedOB(htfOBs, currentPrice);
      const itfOB = this.obService.getMostRecentUnmitigatedOB(itfOBs, currentPrice);
      const ltfOB = this.obService.getMostRecentUnmitigatedOB(ltfOBs, currentPrice);
      
      // Use ITF zone OB if available, otherwise use detected OB
      const itfZoneOB = effectiveZone?.orderBlock;
      const finalItfOB = itfZoneOB || itfOB;
      
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(`[SMC_DEBUG] ${symbol}: Order Blocks - HTF=${!!htfOB}, ITF=${!!finalItfOB} (from zone=${!!itfZoneOB}), LTF=${!!ltfOB}`);
      }

      // Step 8: Detect Fair Value Gaps
      // Adjust FVG threshold for symbol (XAUUSD needs larger threshold)
      const symbolFvgThreshold = this.getSymbolThreshold(symbol, this.defaultFvgMinSize);
      if (symbolFvgThreshold !== this.defaultFvgMinSize && smcDebug) {
        logger.info(`[SMC_DEBUG] ${symbol}: Using FVG threshold ${symbolFvgThreshold} (default: ${this.defaultFvgMinSize})`);
      }
      // Create temporary FVG service with symbol-specific threshold
      const symbolFvgService = new FairValueGapService(symbolFvgThreshold, 50);
      const htfFVGs = symbolFvgService.detectFVGs(htfCandles, 'HTF', premiumDiscount);
      const itfFVGs = symbolFvgService.detectFVGs(itfCandles, 'ITF', premiumDiscount);
      const ltfFVGs = symbolFvgService.detectFVGs(ltfCandles, 'LTF', premiumDiscount);
      
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(`[SMC_DEBUG] ${symbol}: FVGs detected - HTF=${htfFVGs.length}, ITF=${itfFVGs.length}, LTF=${ltfFVGs.length}`);
      }
      
      const itfFVG = symbolFvgService.getMostRecentUnfilledFVG(itfFVGs, currentPrice, direction);
      const ltfFVG = symbolFvgService.getMostRecentUnfilledFVG(ltfFVGs, currentPrice, direction);
      const ltfFVGResolved = ltfFVG ? symbolFvgService.isFVGAnswered(ltfFVG, currentPrice) : false;


      // Step 9: Detect Liquidity Sweeps
      // Adjust sweep tolerance for symbol
      const symbolSweepTolerance = this.getSymbolThreshold(symbol, this.defaultSweepTolerance);
      const symbolSweepService = new LiquiditySweepService(symbolSweepTolerance, 50);
      const htfSweeps = symbolSweepService.detectSweeps(htfCandles, 'HTF');
      const ltfSweeps = symbolSweepService.detectSweeps(ltfCandles, 'LTF');
      
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(`[SMC_DEBUG] ${symbol}: Liquidity sweeps detected - HTF=${htfSweeps.length}, LTF=${ltfSweeps.length}`);
      }
      
      const htfSweep = symbolSweepService.getMostRecentSweep(htfSweeps);
      const ltfSweep = symbolSweepService.getMostRecentSweep(ltfSweeps);
      const ltfSweepConfirmed = !!ltfSweep;

      // Sweeps are for confluence only (not hard requirement in new flow)
      const hasSweep = !!htfSweep || !!ltfSweep;

      // Entry refinement is handled by M1 execution service (micro CHoCH/MSB detection)
      // Keep entry refinement for confluence scoring only
      const entryRefinementResult = this.entryRefinement.refineEntry(
        ltfCandles,
        htfBiasDirection,
        ltfOB,
        ltfFVGResolved,
        hasSweep
      );

      // Step 11: Volume Imbalance
      const htfVI = this.viService.detectImbalanceZones(htfCandles, 'HTF');
      const itfVI = this.viService.detectImbalanceZones(itfCandles, 'ITF');
      
      // Volume Imbalance alignment requires ITF OB (which is always present at this point)
      const viAligned = finalItfOB ? this.viService.isAligned(
        [...htfVI, ...itfVI],
        finalItfOB.high,
        finalItfOB.low,
        itfFVG?.high,
        itfFVG?.low
      ) : false;

      // Step 12: SMT Divergence (optional but increases score)
      const recentHighs = this.getRecentHighs(itfCandles, 10);
      const recentLows = this.getRecentLows(itfCandles, 10);
      const smt = this.smtService.detectDivergence(symbol, recentHighs, recentLows);

      // Step 12.5: ADR & Volatility Filter (for XAUUSD, US30)
      // v15b: ADR now contributes to confluence score instead of hard blocking (except hard limit)
      let adrScoreContribution = 0;
      if (this.adrFilterService.hasConfig(symbol)) {
        // Get daily candles for current day (use latest M1 candles from last 24 hours, or LTF if M1 not available)
        // For ADR calculation, use HTF candles as historical reference (5 days of H1 = ~120 candles)
        const adrResult = this.adrFilterService.checkADR(symbol, ltfCandles, htfCandles);
        
        // Hard limit: still reject if exceeded
        if (!adrResult.passed) {
          const reason = `ADR filter failed: ${adrResult.reason || 'unknown'}`;
          if (smcDebug) {
            logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
            if (adrResult.adr !== undefined && adrResult.currentDayRange !== undefined) {
              logger.info(
                `[SMC_DEBUG] ${symbol}: ADR=${adrResult.adr.toFixed(2)} pips, ` +
                `Current range=${adrResult.currentDayRange.toFixed(2)} pips, ` +
                `ADR multiple=${adrResult.adrMultiple?.toFixed(2) || 'N/A'}x`
              );
            }
          }
          return createRejection(reason);
        }
        
        // Store ADR score contribution for confluence calculation
        adrScoreContribution = adrResult.adrScore ?? 0;
        
        if (smcDebug && adrResult.adr !== undefined) {
          logger.info(
            `[SMC_DEBUG] ${symbol}: ADR filter - ADR=${adrResult.adr.toFixed(2)} pips, ` +
            `Current range=${adrResult.currentDayRange?.toFixed(2)} pips, ` +
            `ADR multiple=${adrResult.adrMultiple?.toFixed(2) || 'N/A'}x, ` +
            `ADR score=${adrScoreContribution}`
          );
        }
      }

      // Step 12.6: Displacement Candle Check (symbol-aware ATR-based)
      // v15c: Displacement now contributes to confluence score instead of hard blocking
      // v15d: Displacement qualification is now part of Setup Gate (hard gate before soft scoring)
      let displacementScoreContribution = 0;
      let displacementResult: DisplacementCheckResult | undefined;
      let atrForGate = 0;
      
      if (this.displacementCheckService.hasConfig(symbol)) {
        // Use ITF candles for displacement detection (M15 for XAUUSD)
        displacementResult = this.displacementCheckService.checkDisplacement(symbol, itfCandles, direction);
        atrForGate = displacementResult.metrics.atr;
        
        // v15d: Displacement qualification is now part of Setup Gate, so we skip hard filter here
        // Store displacement score contribution for confluence calculation (will be used after gate passes)
        displacementScoreContribution = displacementResult.score;
        
        // Always log detailed displacement metrics
        if (smcDebug) {
          logger.info(
            `[SMC_DEBUG] ${symbol}: Displacement check - ` +
            `ATR=${displacementResult.metrics.atr.toFixed(2)}, ` +
            `Candle TR=${displacementResult.metrics.candleTrueRange.toFixed(2)}, ` +
            `Multiplier=${displacementResult.metrics.trMultiple.toFixed(2)}x, ` +
            `Body=${displacementResult.metrics.bodyPct.toFixed(1)}%, ` +
            `Score=${displacementResult.score}, ` +
            `Reasons=${displacementResult.reasons.join('; ') || 'none'}, ` +
            `isValid=${displacementResult.isValid}`
          );
        }
      } else {
        // Calculate ATR from ITF candles (fallback)
        atrForGate = this.calculateATRFromCandles(itfCandles, 20);
      }

      // Step 12.7: Setup Gate Check (v15d: Strict setup qualification gate BEFORE confluence scoring)
      // This gate runs BEFORE confluence scoring to filter out weak setups
      // Use displacement result if available, otherwise create a default one
      const gateDisplacementData: DisplacementCheckResult = displacementResult || {
        isValid: true,
        score: 0,
        reasons: [],
        metrics: {
          atr: atrForGate,
          candleTrueRange: 0,
          trMultiple: 0,
          bodyPct: 0,
        },
      };

      // Collect all data required for gate check
      const gateInput = {
        symbol,
        direction: direction as 'buy' | 'sell', // Ensure type is 'buy' | 'sell'
        currentPrice,
        candles: ltfCandles,
        atr: atrForGate,
        pdZone: premiumDiscount,
        bosData: {
          lastBOS: ltfStructure.lastBOS,
          swingHigh: htfStructure.swingHighs?.[htfStructure.swingHighs.length - 1],
          swingLow: htfStructure.swingLows?.[htfStructure.swingLows.length - 1],
        },
        fvgData: {
          itfFVGs,
          ltfFVGs,
        },
        sweepData: {
          htfSweep,
          ltfSweep,
        },
        displacementData: gateDisplacementData,
        orderBlockData: {
          htfOB,
          itfOB,
          ltfOB,
        },
      };

      // Check setup gate
      const gateResult = this.setupGateService.checkSetupGate(gateInput);

      if (!gateResult.isEligible) {
        const reason = `Setup gate failed: ${gateResult.reasons.join('; ')}`;
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
          if (gateResult.sweepCheck) {
            logger.info(
              `[SMC_DEBUG] ${symbol}: Sweep check - isValid=${gateResult.sweepCheck.isValid}, ` +
              `sweptSide=${gateResult.sweepCheck.sweptSide}, strength=${gateResult.sweepCheck.strength.toFixed(2)}x`
            );
          }
          if (gateResult.bosCheck) {
            logger.info(
              `[SMC_DEBUG] ${symbol}: BOS check - isValid=${gateResult.bosCheck.isValid}, ` +
              `strength=${gateResult.bosCheck.strength.toFixed(2)}x, breakDistance=${gateResult.bosCheck.breakDistance.toFixed(2)}`
            );
          }
          if (gateResult.fvgCheck) {
            logger.info(
              `[SMC_DEBUG] ${symbol}: FVG check - isValid=${gateResult.fvgCheck.isValid}, ` +
              `gapSize=${gateResult.fvgCheck.gapSize.toFixed(2)}x ATR`
            );
          }
        }
        return createRejection(reason, gateResult.reasons);
      }

      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(
          `[SMC_DEBUG] ${symbol}: Setup gate PASSED - ` +
          `Sweep: ${gateResult.sweepCheck?.isValid ? '✓' : '✗'}, ` +
          `BOS: ${gateResult.bosCheck?.isValid ? '✓' : '✗'}, ` +
          `FVG: ${gateResult.fvgCheck?.isValid ? '✓' : '✗'}, ` +
          `Displacement: ${gateDisplacementData.isValid ? '✓' : '✗'}`
        );
      }

      // Step 13: Session Filter
      // Use 'low' strategy as default (SMC v2 is currently used for low-risk strategy)
      // TODO: Make strategy configurable if SMC v2 is used for high-risk strategy in future
      const sessionValidation = this.sessionFilter.validateSession(symbol, undefined, 'low');
      if (!sessionValidation.ok) {
        const reason = sessionValidation.reason || `Session not valid (current session: ${sessionValidation.currentSession})`;
        if (smcDebug) {
          logger.info(`[SMC_DEBUG] ${symbol}: SKIP - ${reason}`);
        }
        return createRejection(reason);
      }

      // Use session from validation result (already computed above)
      const currentSession = sessionValidation.currentSession;
      const sessionValid = sessionValidation.ok; // Should be true at this point (we've passed the check)

      // Step 14: Trendline Liquidity (optional)
      const trendline = this.trendlineService.detectTrendlineLiquidity(
        itfCandles,
        htfBias.bias === 'bullish' ? 'bullish' : 'bearish'
      );

      // Entry, SL, TP are already calculated by M1 execution service
      // (entry, stopLoss, takeProfit are set above from m1Execution)
      
      // Calculate risk for logging
      const risk = Math.abs(entry - stopLoss);
      
      // Use M1 execution TP as base, but can enhance with structure targets
      let rrTargetPrice = takeProfit;
      
      // Find nearest structure target in trade direction (adaptive TP)
      // For buy: find nearest swing high above entry (HTF or ITF)
      // For sell: find nearest swing low below entry (HTF or ITF)
      let nearestStructureTarget: number | null = null;
      
      if (direction === 'buy') {
        // Find nearest swing high above entry
        const candidateHighs: number[] = [];
        if (htfStructure.swingHigh && htfStructure.swingHigh > entry) {
          candidateHighs.push(htfStructure.swingHigh);
        }
        if (itfStructure.swingHigh && itfStructure.swingHigh > entry) {
          candidateHighs.push(itfStructure.swingHigh);
        }
        // Include swing highs from arrays
        if (htfStructure.swingHighs && htfStructure.swingHighs.length > 0) {
          candidateHighs.push(...htfStructure.swingHighs.filter(h => h > entry));
        }
        if (itfStructure.swingHighs && itfStructure.swingHighs.length > 0) {
          candidateHighs.push(...itfStructure.swingHighs.filter(h => h > entry));
        }
        
        if (candidateHighs.length > 0) {
          nearestStructureTarget = Math.min(...candidateHighs); // Closest high above entry
        }
      } else {
        // Find nearest swing low below entry
        const candidateLows: number[] = [];
        if (htfStructure.swingLow && htfStructure.swingLow < entry) {
          candidateLows.push(htfStructure.swingLow);
        }
        if (itfStructure.swingLow && itfStructure.swingLow < entry) {
          candidateLows.push(itfStructure.swingLow);
        }
        // Include swing lows from arrays
        if (htfStructure.swingLows && htfStructure.swingLows.length > 0) {
          candidateLows.push(...htfStructure.swingLows.filter(l => l < entry));
        }
        if (itfStructure.swingLows && itfStructure.swingLows.length > 0) {
          candidateLows.push(...itfStructure.swingLows.filter(l => l < entry));
        }
        
        if (candidateLows.length > 0) {
          nearestStructureTarget = Math.max(...candidateLows); // Closest low below entry (highest of lows below)
        }
      }
      
      // TP is already set from M1 execution (2R based on risk)
      // Optional: Could enhance with structure targets here if needed
      if (smcDebug && symbol === 'XAUUSD') {
        logger.info(
          `[SMC_DEBUG] ${symbol}: TP from M1 execution: ${takeProfit.toFixed(2)} ` +
          `(risk=${risk.toFixed(2)}, RR=${(risk > 0 ? Math.abs(takeProfit - entry) / risk : 0).toFixed(2)})`
        );
      }

      // Step 16: Build confluence reasons
      const confluenceReasons: string[] = [];
      confluenceReasons.push(`HTF bias: ${htfBias.bias} (${htfBias.method})`);
      if (effectiveZone) {
        confluenceReasons.push(`ITF setup zone: ${effectiveZone.zoneType} [${effectiveZone.priceMin.toFixed(2)}, ${effectiveZone.priceMax.toFixed(2)}]`);
      }
      if (m1Execution.microChoch) {
        confluenceReasons.push(`M1 micro ${m1Execution.microChoch.type} confirmed`);
      }
      confluenceReasons.push(`Premium/Discount: ${premiumDiscount}`);
      if (ltfStructure.lastBOS) confluenceReasons.push(`LTF BOS confirmed`);
      if (htfOB) confluenceReasons.push(`HTF Order Block confirmed`);
      if (finalItfOB) confluenceReasons.push(`ITF Order Block confirmed`);
      if (ltfOB) confluenceReasons.push(`LTF Order Block confirmed`);
      if (htfSweep) confluenceReasons.push(`HTF liquidity sweep: ${htfSweep.type}`);
      if (ltfSweep) confluenceReasons.push(`LTF liquidity sweep: ${ltfSweep.type}`);
      if (itfFVG) confluenceReasons.push(`ITF FVG present`);
      if (ltfFVGResolved) confluenceReasons.push(`LTF FVG resolved`);
      if (viAligned) confluenceReasons.push(`Volume Imbalance aligned`);
      if (smt.bullish || smt.bearish) confluenceReasons.push(`SMT divergence: ${smt.bullish ? 'bullish' : 'bearish'}`);
      if (entryRefinementResult.refined) confluenceReasons.push(`Entry refined`);
      if (trendline?.confirmed) confluenceReasons.push(`Trendline liquidity confirmed`);
      confluenceReasons.push(`Session valid: ${currentSession}`);
      // v15c: Add displacement to confluence reasons
      if (this.displacementCheckService.hasConfig(symbol)) {
        if (displacementScoreContribution > 0) {
          confluenceReasons.push(`Displacement strong (body/ATR)`);
        } else if (displacementScoreContribution < 0) {
          confluenceReasons.push(`Displacement weak (body/ATR/direction penalty)`);
        }
      }

      // Step 17: Calculate confluence score (0-100)
      // v15b: PD and ADR now contribute as scores instead of booleans
      const confluenceScore = this.calculateConfluenceScore({
        htfTrend: htfBias.bias !== 'neutral', // HTF bias is non-neutral
        pdScore: pdScoreContribution, // v15b: PD score contribution (-10 to +15)
        adrScore: adrScoreContribution, // v15b: ADR score contribution (-15 to +10)
        displacementScore: displacementScoreContribution, // v15c: Displacement score contribution
        itfAligned: effectiveZone?.isAlignedWithHTF || false, // ITF zone is aligned
        ltfBOS: !!m1Execution.microChoch, // M1 micro CHoCH/MSB confirmed
        htfOB: !!htfOB,
        itfOB: !!finalItfOB,
        ltfOB: !!ltfOB,
        sweepConfirmed: hasSweep,
        fvgResolved: ltfFVGResolved,
        viAligned,
        smt: smt.bullish || smt.bearish,
        entryRefined: entryRefinementResult.refined,
        trendline: !!trendline?.confirmed,
        sessionValid,
      });
      
      // Log PD and ADR contribution and final score
      if (smcDebug && symbol === 'XAUUSD') {
        const pdBoundaries = this.pdService.getBoundaries(pdCandles);
        logger.info(
          `[SMC_DEBUG] ${symbol}: Confluence score details - ` +
          `PD zone=${premiumDiscount}, PD score=${pdScoreContribution}, ` +
          `ADR score=${adrScoreContribution}, ` +
          `direction=${direction}, HTF bias=${htfBias.bias} (${htfBias.method}), ` +
          `ITF zone=${effectiveZone?.zoneType || 'synthetic'}, M1 micro ${m1Execution.microChoch?.type}, ` +
          `currentPrice=${currentPrice.toFixed(2)}, ` +
          `fib50=${pdBoundaries?.fib50.toFixed(2) || 'N/A'}, ` +
          `final score=${confluenceScore}/100`
        );
      }

      // Step 18: Build EnhancedRawSignalV2
      const signal: EnhancedRawSignalV2 = {
        symbol,
        direction,
        entry,
        stopLoss,
        takeProfit,
        htfTrend: htfBias.bias === 'bullish' ? 'bullish' : htfBias.bias === 'bearish' ? 'bearish' : 'sideways',
        itfFlow: effectiveZone?.isAlignedWithHTF ? 'aligned' : 'neutral',
        ltfBOS: !!ltfStructure.lastBOS,
        premiumDiscount,
        obLevels: {
          htf: htfOB ? this.convertOBToOBLevel(htfOB, 'HTF') : undefined,
          itf: finalItfOB ? this.convertOBToOBLevel(finalItfOB, 'ITF') : undefined,
          ltf: ltfOB ? this.convertOBToOBLevel(ltfOB, 'LTF') : undefined,
        },
        fvgLevels: {
          htf: htfFVGs.length > 0 ? this.convertFVGToFVGLevel(htfFVGs[0], 'HTF') : undefined,
          itf: itfFVG ? this.convertFVGToFVGLevel(itfFVG, 'ITF') : undefined,
          ltf: ltfFVG ? this.convertFVGToFVGLevel(ltfFVG, 'LTF') : undefined,
        },
        smt,
        liquiditySweep: htfSweep || ltfSweep ? this.convertSweepToSweep(htfSweep || ltfSweep!) : undefined,
        volumeImbalance: {
          zones: [...htfVI, ...itfVI].map(v => ({
            high: v.high,
            low: v.low,
            timestamp: v.timestamp,
            intensity: v.intensity,
            timeframe: v.timeframe,
          })),
          aligned: viAligned,
        },
        ltfEntryRefinedOB: entryRefinementResult.refinedOB ? 
          this.convertOBToOBLevel(entryRefinementResult.refinedOB, 'LTF') : undefined,
        ltfFVGResolved: ltfFVGResolved,
        ltfSweepConfirmed: ltfSweepConfirmed,
        sessionValid,
        session: currentSession,
        trendlineLiquidity: trendline,
        confluenceReasons,
        confluenceScore,
        timestamp: new Date().toISOString(),
          meta: {
            // Store v2 context if needed
          },
      };

      // Return signal with optional reasons wrapper
      // Log signal generation (full mode)
      logger.info(`[SMC_DEBUG] ${symbol}: 🎯 SIGNAL GENERATED (full mode) - ${signal.direction.toUpperCase()} @ ${signal.entry.toFixed(2)}, SL: ${signal.stopLoss.toFixed(2)}, TP: ${signal.takeProfit.toFixed(2)}, score: ${signal.confluenceScore}`);
      
      if (returnReasons) {
        return { signal, reason: undefined, debugReasons: confluenceReasons };
      }
      
      // Log setup found with full details
      if (smcDebug || symbol === 'XAUUSD') {
        logger.info(
          `[SMCStrategyV2] ✅ SETUP FOUND for ${symbol}: ${direction.toUpperCase()} @ ${entry.toFixed(2)}, ` +
          `SL=${stopLoss.toFixed(2)}, TP=${takeProfit.toFixed(2)}, RR=${(risk > 0 ? Math.abs(takeProfit - entry) / risk : 0).toFixed(2)}, ` +
          `confluence score: ${confluenceScore}/100, reasons: ${confluenceReasons.length}`
        );
        logger.info(
          `[SMCStrategyV2] ${symbol} setup details: HTF bias=${htfBias.bias} (${htfBias.method}), ` +
          `ITF bias=${itfBias.bias} (${itfBias.method}), ` +
          `ITF zone=[${effectiveZone?.priceMin.toFixed(2) || 'N/A'}, ${effectiveZone?.priceMax.toFixed(2) || 'N/A'}] (${effectiveZone?.zoneType || 'synthetic'}), ` +
          `M1 micro ${m1Execution.microChoch?.type}@${m1Execution.microChoch?.price.toFixed(2)}, ` +
          `P/D=${premiumDiscount}, Session=${currentSession}`
        );
      } else {
        logger.info(
          `[SMCStrategyV2] Generated signal for ${symbol}: ${direction} @ ${entry}, ` +
          `confluence score: ${confluenceScore}, reasons: ${confluenceReasons.length}`
        );
      }

      return signal;
    } catch (error) {
      logger.error(`[SMCStrategyV2] Error generating signal for ${symbol}`, error);
      return null;
    }
  }

  /**
   * Calculate confluence score (0-100)
   */
  private calculateConfluenceScore(confluences: {
    htfTrend: boolean;
    pdScore: number; // v15b: PD score contribution (-10 to +15) instead of boolean
    adrScore: number; // v15b: ADR score contribution (-15 to +10)
    displacementScore: number; // v15c: Displacement score contribution
    itfAligned: boolean;
    ltfBOS: boolean;
    htfOB: boolean;
    itfOB: boolean;
    ltfOB: boolean;
    sweepConfirmed: boolean;
    fvgResolved: boolean;
    viAligned: boolean;
    smt: boolean;
    entryRefined: boolean;
    trendline: boolean;
    sessionValid: boolean;
  }): number {
    let score = 0;

    // Core confluences (required - 60 points base)
    if (confluences.htfTrend) score += 10;
    // v15b: PD contributes as a score (-10 to +15) instead of fixed +10
    // Base contribution: 10 points, then adjust based on PD score
    score += 10; // Base PD contribution
    score += confluences.pdScore; // Add/subtract based on PD alignment
    // v15b: ADR contributes as a score (-15 to +10)
    score += 10; // Base ADR contribution
    score += confluences.adrScore; // Add/subtract based on ADR volatility
    // v15c: Displacement contributes as a score (no base, just the score directly)
    score += confluences.displacementScore; // Add/subtract based on displacement quality
    if (confluences.itfAligned) score += 10;
    if (confluences.ltfBOS) score += 10;
    if (confluences.htfOB) score += 10;
    if (confluences.itfOB) score += 10;

    // Additional confluences (optional - 40 points)
    if (confluences.ltfOB) score += 5;
    if (confluences.sweepConfirmed) score += 10;
    if (confluences.fvgResolved) score += 5;
    if (confluences.viAligned) score += 5;
    if (confluences.smt) score += 5;
    if (confluences.entryRefined) score += 5;
    if (confluences.trendline) score += 5;
    if (confluences.sessionValid) score += 5;

    return Math.min(100, score);
  }

  /**
   * Helper: Get candles for a timeframe
   * Converts from MarketDataService Candle format (types/index.ts) to marketData Candle format
   */
  private async getCandles(symbol: string, timeframe: string, limit: number): Promise<MarketDataCandle[]> {
    try {
      // Map timeframe string to Timeframe type
      const tfMap: Record<string, 'M1' | 'M5' | 'M15' | 'H1' | 'H4'> = {
        'M1': 'M1',
        'M5': 'M5',
        'M15': 'M15',
        'H1': 'H1',
        'H4': 'H4',
      };

      const tf = tfMap[timeframe] || 'M5';
      const candlesFromService = await this.marketDataService.getRecentCandles(symbol, tf, limit);
      
      // Debug: Log candle count for first symbol to verify aggregation
      if (symbol === 'XAUUSD' && candlesFromService.length > 0) {
        logger.debug(`[SMCStrategyV2] Received ${candlesFromService.length} ${tf} candles for ${symbol} (first timestamp: ${candlesFromService[0].timestamp})`);
      }
      
      // Convert from types/index.ts Candle (has timestamp) to marketData/types.ts Candle (has startTime/endTime)
      return candlesFromService.map((c, index) => {
        const timestamp = new Date(c.timestamp);
        // Estimate endTime based on timeframe duration
        const timeframeMinutes: Record<string, number> = {
          'M1': 1,
          'M5': 5,
          'M15': 15,
          'H1': 60,
          'H4': 240,
        };
        const durationMs = (timeframeMinutes[timeframe] || 5) * 60 * 1000;
        const endTime = new Date(timestamp.getTime() + durationMs);
        
        return {
          symbol: symbol,
          timeframe: 'M1' as const, // MarketDataCandle requires M1, but we use the actual timeframe in logic
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          startTime: timestamp,
          endTime: endTime,
        };
      });
    } catch (error) {
      logger.error(`[SMCStrategyV2] Error getting candles for ${symbol} ${timeframe}`, error);
      return [];
    }
  }

  /**
   * Helper: Get recent highs
   */
  private getRecentHighs(candles: MarketDataCandle[], count: number): number[] {
    const recent = candles.slice(-count);
    const highs: number[] = [];
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i].high > recent[i - 1].high && recent[i].high > recent[i + 1].high) {
        highs.push(recent[i].high);
      }
    }
    return highs;
  }

  /**
   * Helper: Get recent lows
   */
  private getRecentLows(candles: MarketDataCandle[], count: number): number[] {
    const recent = candles.slice(-count);
    const lows: number[] = [];
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i].low < recent[i - 1].low && recent[i].low < recent[i + 1].low) {
        lows.push(recent[i].low);
      }
    }
    return lows;
  }

  /**
   * Helper: Convert OrderBlockV2 to OrderBlockLevel
   */
  private convertOBToOBLevel(
    ob: import('./types').OrderBlockV2,
    timeframe: 'HTF' | 'ITF' | 'LTF'
  ): any {
    return {
      type: ob.type,
      high: ob.high,
      low: ob.low,
      timestamp: ob.timestamp.toISOString(),
      timeframe,
      mitigated: ob.mitigated,
      wickToBodyRatio: ob.wickToBodyRatio,
      volumeImbalance: ob.volumeImbalance,
    };
  }

  /**
   * Helper: Convert FairValueGap to FVGLevel
   */
  private convertFVGToFVGLevel(
    fvg: import('./types').FairValueGap,
    timeframe: 'HTF' | 'ITF' | 'LTF'
  ): any {
    return {
      type: fvg.type,
      grade: fvg.grade,
      high: fvg.high,
      low: fvg.low,
      timestamp: fvg.timestamp.toISOString(),
      timeframe,
      premiumDiscount: fvg.premiumDiscount,
      filled: fvg.filled,
    };
  }

  /**
   * EXPERT: Calculate 15m trend strength (0-1 scale)
   * Higher = stronger trend, lower = weaker/ranging
   */
  private calculateTrendStrength(
    candles: import('../../marketData/types').Candle[],
    structure: any, // MarketStructureContext from MarketStructureHTF
    bias: HTFBiasResult
  ): number {
    if (candles.length < 5) return 0;

    let strength = 0;
    let factors = 0;

    // Factor 1: BOS count dominance (0-0.3 points)
    if (bias.bullishBosCount + bias.bearishBosCount > 0) {
      const totalBos = bias.bullishBosCount + bias.bearishBosCount;
      const dominantBos = Math.max(bias.bullishBosCount, bias.bearishBosCount);
      const dominanceRatio = dominantBos / totalBos;
      strength += dominanceRatio * 0.3;
      factors++;
    }

    // Factor 2: Formal trend alignment (0-0.3 points)
    if (structure.trend !== 'sideways') {
      const trendMatchesBias = (structure.trend === 'bullish' && bias.bias === 'bullish') ||
                               (structure.trend === 'bearish' && bias.bias === 'bearish');
      if (trendMatchesBias) {
        strength += 0.3;
      }
      factors++;
    }

    // Factor 3: Recent price momentum (0-0.2 points)
    if (candles.length >= 5) {
      const recentCandles = candles.slice(-5);
      const priceChange = (recentCandles[recentCandles.length - 1].close - recentCandles[0].close) / recentCandles[0].close;
      const momentumMatchesBias = (bias.bias === 'bullish' && priceChange > 0) ||
                                   (bias.bias === 'bearish' && priceChange < 0);
      if (momentumMatchesBias && Math.abs(priceChange) > 0.001) { // At least 0.1% move
        strength += 0.2;
      }
      factors++;
    }

    // Factor 4: Swing consistency (0-0.2 points)
    if (structure.swingHighs && structure.swingLows) {
      const swingCount = (structure.swingHighs.length || 0) + (structure.swingLows.length || 0);
      if (swingCount >= 3) { // At least 3 swings indicates structure
        strength += 0.2;
      }
      factors++;
    }

    // Normalize by number of factors evaluated
    return factors > 0 ? strength : 0;
  }

  /**
   * IMPROVED: Calculate volatility (0-1 scale)
   * Measures how much price is moving vs recent average
   * Low volatility = choppy market, high volatility = trending market
   */
  private calculateVolatility(htfCandles: import('../../marketData/types').Candle[]): number {
    if (htfCandles.length < 10) return 0.5; // Default if not enough data
    
    // Calculate average candle range over last 20 candles
    const recentCandles = htfCandles.slice(-20);
    const avgRange = recentCandles.reduce((sum, c) => sum + (c.high - c.low), 0) / recentCandles.length;
    
    if (avgRange === 0) return 0;
    
    // Calculate current volatility (last 5 candles average range vs overall average)
    const last5Candles = htfCandles.slice(-5);
    const currentRange = last5Candles.reduce((sum, c) => sum + (c.high - c.low), 0) / last5Candles.length;
    
    // Volatility ratio: current range / average range
    // > 1.0 = high volatility (good for trading)
    // < 0.5 = low volatility (chop, avoid)
    const volatilityRatio = currentRange / avgRange;
    
    // Normalize to 0-1 scale (0.5x multiplier to be conservative)
    return Math.min(1.0, Math.max(0, volatilityRatio * 0.5));
  }

  /**
   * Helper: Convert LiquiditySweepResult to LiquiditySweep
   */
  private convertSweepToSweep(sweep: import('./LiquiditySweepService').LiquiditySweepResult): any {
    return {
      type: sweep.type,
      level: sweep.level,
      timestamp: sweep.timestamp.toISOString(),
      confirmed: sweep.confirmed,
      timeframe: sweep.timeframe,
    };
  }

  /**
   * Calculate ATR from candles (helper for setup gate)
   */
  private calculateATRFromCandles(candles: MarketDataCandle[], lookbackPeriod: number): number {
    if (candles.length < lookbackPeriod + 1) return 0;

    const atrCandles = candles.slice(-lookbackPeriod - 1);
    const trueRanges: number[] = [];

    for (let i = 1; i < atrCandles.length; i++) {
      const current = atrCandles[i];
      const previous = atrCandles[i - 1];
      
      // True Range = max(high - low, abs(high - previous.close), abs(low - previous.close))
      const tr1 = current.high - current.low;
      const tr2 = Math.abs(current.high - previous.close);
      const tr3 = Math.abs(current.low - previous.close);
      const trueRange = Math.max(tr1, tr2, tr3);
      trueRanges.push(trueRange);
    }

    if (trueRanges.length === 0) return 0;

    // Calculate ATR as the average of true ranges
    const atr = trueRanges.reduce((sum, tr) => sum + tr, 0) / trueRanges.length;
    return atr;
  }

  /**
   * Get symbol-specific threshold (adjusts for symbol price scale)
   * XAUUSD (~2600-2700) and US30 (~39000-40000) need larger thresholds
   * FX pairs (~1.0-1.3) use smaller thresholds
   */
  private getSymbolThreshold(symbol: string, defaultThreshold: number): number {
    const symbolThresholds: Record<string, number> = {
      // Gold: threshold ~0.5-1.0 (about $0.50-$1.00)
      XAUUSD: 0.5,
      // Index: threshold ~5-10 (about 5-10 points)
      US30: 5.0,
      // FX pairs: use default (0.0001)
      EURUSD: defaultThreshold,
      GBPUSD: defaultThreshold,
      USDJPY: defaultThreshold,
    };
    
    return symbolThresholds[symbol] || defaultThreshold;
  }

  /**
   * Get rejection statistics (v15e: For backtesting analysis)
   * Returns counts of rejections by reason
   */
  public getRejectionStats() {
    return {
      rejectedNoLtfBos: this.rejectedNoLtfBos,
      rejectedItfFlowNeutral: this.rejectedItfFlowNeutral,
      rejectedNoItfBos: this.rejectedNoItfBos,
      rejectedOther: this.rejectedOther,
      total: this.rejectedNoLtfBos + this.rejectedItfFlowNeutral + this.rejectedNoItfBos + this.rejectedOther,
    };
  }

  /**
   * Reset rejection statistics (v15e: For backtesting - reset between runs)
   */
  public resetRejectionStats() {
    this.rejectedNoLtfBos = 0;
    this.rejectedItfFlowNeutral = 0;
    this.rejectedNoItfBos = 0;
    this.rejectedOther = 0;
  }

  /**
   * Get metrics summary (for backtesting/debugging)
   */
  public getMetricsSummary() {
    return {
      ...this.metrics,
      htfFilterPassRate: this.metrics.totalEvaluations > 0 
        ? (this.metrics.passedHTFFilter / this.metrics.totalEvaluations * 100).toFixed(2) + '%'
        : '0%',
      itfAlignmentPassRate: this.metrics.passedHTFFilter > 0
        ? ((this.metrics.passedITFAlignment + this.metrics.passedITFAlignmentSkipped) / this.metrics.passedHTFFilter * 100).toFixed(2) + '%'
        : '0%',
      ltfChoCHPassRate: (this.metrics.passedITFAlignment + this.metrics.passedITFAlignmentSkipped) > 0
        ? (this.metrics.validLTFChoCH / (this.metrics.passedITFAlignment + this.metrics.passedITFAlignmentSkipped) * 100).toFixed(2) + '%'
        : '0%',
      tradeRate: this.metrics.totalEvaluations > 0
        ? (this.metrics.actualTrades / this.metrics.totalEvaluations * 100).toFixed(2) + '%'
        : '0%',
    };
  }

  /**
   * Log metrics summary (for backtesting/debugging)
   */
  public logMetricsSummary() {
    const summary = this.getMetricsSummary();
    logger.info(
      `[SMCStrategyV2] Metrics Summary:\n` +
      `  Total Evaluations: ${summary.totalEvaluations}\n` +
      `  Passed HTF Filter: ${summary.passedHTFFilter} (${summary.htfFilterPassRate})\n` +
      `  Passed ITF Alignment: ${summary.passedITFAlignment} (skipped: ${summary.passedITFAlignmentSkipped}) (${summary.itfAlignmentPassRate})\n` +
      `  Valid LTF ChoCH: ${summary.validLTFChoCH} (${summary.ltfChoCHPassRate})\n` +
      `  Actual Trades: ${summary.actualTrades} (${summary.tradeRate})`
    );
  }

  /**
   * Generate signal using strict ICT model (H4 → M15 → M1)
   */
  private async generateICTSignal(
    symbol: string,
    returnReasons: boolean = false
  ): Promise<EnhancedRawSignalV2 | null | { signal: EnhancedRawSignalV2 | null; reason?: string; debugReasons?: string[] }> {
    const ictLog = process.env.ICT_DEBUG === 'true' || process.env.SMC_DEBUG === 'true';
    
    // Always log entry into ICT pipeline for first 50 evaluations to debug
    if (this.metrics.totalEvaluations <= 50) {
      logger.info(`[ICT] ${symbol}: ✅ Entering ICT pipeline (evaluation #${this.metrics.totalEvaluations}, ICT_DEBUG=${process.env.ICT_DEBUG || 'false'})`);
    } else if (ictLog) {
      logger.info(`[ICT] ${symbol}: Entering ICT pipeline (evaluation #${this.metrics.totalEvaluations})`);
    }
    
    const createRejection = (reason: string, additionalReasons?: string[]): EnhancedRawSignalV2 | null | { signal: null; reason: string; debugReasons: string[] } => {
      const allReasons = [reason, ...(additionalReasons || [])];
      if (returnReasons) {
        return { signal: null, reason, debugReasons: allReasons };
      }
      return null;
    };

    try {
      // Get multi-timeframe candles: H4 (bias), M15 (setup), M1 (entry)
      const h4Candles = await this.getCandles(symbol, 'H4', 50);
      const m15Candles = await this.getCandles(symbol, 'M15', 100);
      const m1Candles = await this.getCandles(symbol, 'M1', 50);

      if (h4Candles.length < 10 || m15Candles.length < 20 || m1Candles.length < 20) {
        return createRejection(
          `Insufficient candles - H4=${h4Candles.length}, M15=${m15Candles.length}, M1=${m1Candles.length}`
        );
      }

      // Analyze ICT entry using strict ICT model
      const ictResult = this.ictEntryService.analyzeICTEntry(h4Candles, m15Candles, m1Candles);

      // Check H4 bias
      if (ictResult.bias.direction === 'sideways') {
        if (ictLog) {
          logger.info(`[ICT] ${symbol}: No H4 bias - skipping entry`);
        }
        return createRejection('H4 bias is sideways');
      }

      // Check M15 setup zone
      if (!ictResult.setupZone || !ictResult.setupZone.isValid) {
        if (ictLog) {
          logger.info(`[ICT] ${symbol}: No valid M15 setup zone - reasons: ${ictResult.setupZone?.reasons.join(', ') || 'none'}`);
        }
        return createRejection(
          'No valid M15 setup zone',
          ictResult.setupZone?.reasons
        );
      }

      // Check M1 entry
      if (!ictResult.entry || !ictResult.entry.isValid) {
        if (ictLog) {
          logger.info(`[ICT] ${symbol}: No valid M1 entry - reasons: ${ictResult.entry?.reasons.join(', ') || 'none'}`);
        }
        return createRejection(
          'No valid M1 entry',
          ictResult.entry?.reasons
        );
      }

      // Convert ICT entry to EnhancedRawSignalV2
      const signal = this.convertICTEntryToSignal(symbol, ictResult);

      if (ictLog) {
        logger.info(
          `[ICT] ${symbol}: ✅ ENTRY GENERATED - ${signal.direction.toUpperCase()} @ ${signal.entry.toFixed(2)}, ` +
          `SL: ${signal.stopLoss.toFixed(2)}, TP: ${signal.takeProfit.toFixed(2)}, ` +
          `RR: ${ictResult.entry.riskRewardRatio.toFixed(2)}`
        );
      }

      if (returnReasons) {
        return { signal, reason: undefined, debugReasons: ictResult.entry.reasons };
      }

      return signal;
    } catch (error) {
      logger.error(`[ICT] Error generating signal for ${symbol}`, error);
      return createRejection(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert ICTEntryResult to EnhancedRawSignalV2 format
   */
  private convertICTEntryToSignal(symbol: string, ictResult: ICTEntryResult): EnhancedRawSignalV2 {
    const entry = ictResult.entry!;
    const setupZone = ictResult.setupZone!;
    
    // Convert direction
    const direction = entry.direction === 'bullish' ? 'buy' : 'sell';

    // Build signal with ICT-specific metadata
    const signal: EnhancedRawSignalV2 = {
      symbol,
      direction,
      entry: entry.entryPrice,
      stopLoss: entry.stopLoss,
      takeProfit: entry.takeProfit,
      
      // Multi-timeframe structure
      htfTrend: ictResult.bias.direction === 'sideways' ? 'sideways' : (ictResult.bias.direction === 'bullish' ? 'bullish' : 'bearish'),
      itfFlow: 'aligned', // ICT assumes alignment
      ltfBOS: entry.m1ChoChIndex !== undefined,
      
      // Premium/Discount (not used in strict ICT, but required field)
      premiumDiscount: 'neutral',
      
      // Order Blocks
      obLevels: {
        itf: setupZone.orderBlock ? {
          type: setupZone.orderBlock.type,
          high: setupZone.orderBlock.high,
          low: setupZone.orderBlock.low,
          timestamp: setupZone.orderBlock.timestamp.toISOString(),
          timeframe: 'ITF',
          mitigated: setupZone.orderBlock.mitigated,
          wickToBodyRatio: setupZone.orderBlock.wickToBodyRatio,
          volumeImbalance: setupZone.orderBlock.volumeImbalance,
        } : undefined,
        ltf: entry.refinedOB ? {
          type: entry.refinedOB.type,
          high: entry.refinedOB.high,
          low: entry.refinedOB.low,
          timestamp: entry.refinedOB.timestamp.toISOString(),
          timeframe: 'LTF',
          mitigated: entry.refinedOB.mitigated,
          wickToBodyRatio: entry.refinedOB.wickToBodyRatio,
          volumeImbalance: entry.refinedOB.volumeImbalance,
        } : undefined,
      },
      
      // Fair Value Gaps
      fvgLevels: {
        itf: setupZone.fvg ? {
          type: 'continuation',
          grade: 'wide',
          high: setupZone.fvg.high,
          low: setupZone.fvg.low,
          timestamp: new Date().toISOString(),
          timeframe: 'ITF',
          premiumDiscount: setupZone.direction === 'bullish' ? 'discount' : 'premium',
          filled: false,
        } : undefined,
      },
      
      // SMT Divergence (not used in strict ICT)
      smt: { bullish: false, bearish: false },
      
      // Volume Imbalance (not used in strict ICT)
      volumeImbalance: {
        zones: [],
        aligned: false,
      },
      
      // Entry Refinement
      ltfEntryRefinedOB: entry.refinedOB ? {
        type: entry.refinedOB.type,
        high: entry.refinedOB.high,
        low: entry.refinedOB.low,
        timestamp: entry.refinedOB.timestamp.toISOString(),
        timeframe: 'LTF',
        mitigated: entry.refinedOB.mitigated,
        wickToBodyRatio: entry.refinedOB.wickToBodyRatio,
        volumeImbalance: entry.refinedOB.volumeImbalance,
      } : undefined,
      ltfFVGResolved: false,
      ltfSweepConfirmed: false,
      
      // Session Filter
      sessionValid: true,
      
      // Confluence Reasons (ICT-specific)
      confluenceReasons: entry.reasons,
      
      // Scoring
      confluenceScore: entry.isValid ? 100 : 0,
      
      // Metadata
      timestamp: new Date().toISOString(),
      meta: {
        ictModel: true,
        h4Bias: ictResult.bias.direction,
        m15SetupZone: setupZone.isValid,
        m1Entry: entry.isValid,
        setupsDetected: ictResult.setupsDetected,
        entriesTaken: ictResult.entriesTaken,
      },
    };

    return signal;
  }

  /**
   * Reset metrics (for backtesting - reset between runs)
   */
  public resetMetrics() {
    this.metrics = {
      totalEvaluations: 0,
      passedHTFFilter: 0,
      passedITFAlignment: 0,
      passedITFAlignmentSkipped: 0,
      validLTFChoCH: 0,
      actualTrades: 0,
    };
  }
}


