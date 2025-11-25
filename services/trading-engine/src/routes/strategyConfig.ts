import { Router, Request, Response } from 'express';
import { Logger } from '@providencex/shared-utils';

const router: Router = Router();
const logger = new Logger('StrategyConfig');

/**
 * GET /strategy-config
 * Returns the current strategy configuration to verify ICT model settings
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const useICTModel = (process.env.USE_ICT_MODEL || 'false').toLowerCase() === 'true';
    const ictDebug = (process.env.ICT_DEBUG || 'false').toLowerCase() === 'true';
    const smcRiskReward = process.env.SMC_RISK_REWARD || '3';
    const useSMCV2 = process.env.USE_SMC_V2 === 'true';

    const config = {
      strategy: {
        model: useICTModel ? 'ICT' : 'SMC v2',
        enabled: useICTModel,
        timeframes: useICTModel
          ? {
              bias: 'H4',
              setup: 'M15',
              entry: 'M1',
            }
          : {
              htf: 'M15',
              itf: 'M15',
              ltf: 'M1',
            },
      },
      risk: {
        riskReward: parseFloat(smcRiskReward),
        riskRewardRatio: `1:${smcRiskReward}`,
      },
      debug: {
        ictDebug,
        smcDebug: process.env.SMC_DEBUG === 'true',
      },
      environment: {
        useSMCV2,
        envFile: 'Root .env (shared by backtest and live)',
      },
    };

    res.json({
      success: true,
      message: useICTModel
        ? 'ICT Model is ENABLED - Using H4→M15→M1 pipeline'
        : 'ICT Model is NOT enabled - Using SMC v2',
      config,
      verification: {
        sameAsBacktest: useICTModel,
        note: useICTModel
          ? 'Live engine uses same ICT strategy as backtest'
          : 'Enable USE_ICT_MODEL=true in root .env to match backtest',
      },
    });
  } catch (error) {
    logger.error('Error getting strategy config', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export default router;

