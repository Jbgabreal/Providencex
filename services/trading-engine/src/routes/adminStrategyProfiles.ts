import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TenantRepository } from '../db/TenantRepository';
import { buildRiskConfigFromProfileConfig } from '../risk/RiskConfigFromProfile';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';

const logger = new Logger('AdminStrategyProfiles');

export default function createAdminStrategyProfilesRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireAdmin } = buildAuthMiddleware(config);
  const tenantRepo = new TenantRepository();

  // Apply auth middleware to all routes
  router.use(authMiddleware, requireAdmin);

  // GET /api/admin/strategy-profiles
  router.get('/', async (_req: Request, res: Response) => {
  try {
    const profiles = await tenantRepo.getAllStrategyProfiles();
    res.json({ success: true, profiles });
  } catch (error) {
    logger.error('[AdminStrategyProfiles] Failed to list profiles', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // GET /api/admin/strategy-profiles/:id
  router.get('/:id', async (req: Request, res: Response) => {
  try {
    const profile = await tenantRepo.getStrategyProfileById(req.params.id);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Strategy profile not found' });
    }
    res.json({ success: true, profile });
  } catch (error) {
    logger.error('[AdminStrategyProfiles] Failed to get profile', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // POST /api/admin/strategy-profiles
  router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    const { key, name, risk_tier, implementation_key, config } = body;

    // Validate required fields
    if (!key || !name || !risk_tier || !implementation_key || !config) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: key, name, risk_tier, implementation_key, config',
      });
    }

    // Validate risk_tier
    if (!['low', 'medium', 'high'].includes(risk_tier)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid risk_tier. Must be one of: low, medium, high',
      });
    }

    // Validate config by attempting to build risk config
    try {
      buildRiskConfigFromProfileConfig(config);
    } catch (error) {
      logger.warn('[AdminStrategyProfiles] Invalid config in create request', error);
      return res.status(400).json({
        success: false,
        error: 'Invalid config: risk configuration validation failed',
      });
    }

    // Create profile
    try {
      const profile = await tenantRepo.createStrategyProfile({
        key,
        name,
        description: body.description,
        risk_tier,
        implementation_key,
        config,
        is_public: body.is_public !== false,
        is_frozen: body.is_frozen === true,
      });
      res.json({ success: true, profile });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (errorMsg.includes('already exists')) {
        return res.status(400).json({ success: false, error: errorMsg });
      }
      throw error;
    }
  } catch (error) {
    logger.error('[AdminStrategyProfiles] Failed to create profile', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // PATCH /api/admin/strategy-profiles/:id
  router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await tenantRepo.getStrategyProfileById(id);

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Strategy profile not found' });
    }

    const body = req.body;

    // Freeze rules: if profile is frozen, only allow limited updates
    if (existing.is_frozen) {
      const forbiddenFields = ['key', 'implementation_key', 'config', 'risk_tier', 'is_frozen'];
      const attemptedChanges = forbiddenFields.filter(field => body[field] !== undefined);

      if (attemptedChanges.length > 0) {
        return res.status(400).json({
          success: false,
          error: `Cannot modify frozen strategy profile. Attempted to change: ${attemptedChanges.join(', ')}`,
        });
      }

      // Only allow: name, description, is_public
      const allowedUpdates: any = {};
      if (body.name !== undefined) allowedUpdates.name = body.name;
      if (body.description !== undefined) allowedUpdates.description = body.description;
      if (body.is_public !== undefined) allowedUpdates.is_public = body.is_public;

      if (Object.keys(allowedUpdates).length === 0) {
        return res.json({ success: true, profile: existing });
      }

      const updated = await tenantRepo.updateStrategyProfile(id, allowedUpdates);
      return res.json({ success: true, profile: updated || existing });
    }

    // Not frozen: allow updates to most fields
    const updates: any = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.risk_tier !== undefined) {
      if (!['low', 'medium', 'high'].includes(body.risk_tier)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid risk_tier. Must be one of: low, medium, high',
        });
      }
      updates.risk_tier = body.risk_tier;
    }
    if (body.config !== undefined) {
      // Validate config
      try {
        buildRiskConfigFromProfileConfig(body.config);
      } catch (error) {
        logger.warn('[AdminStrategyProfiles] Invalid config in update request', error);
        return res.status(400).json({
          success: false,
          error: 'Invalid config: risk configuration validation failed',
        });
      }
      updates.config = body.config;
    }
    if (body.is_public !== undefined) updates.is_public = body.is_public;
    if (body.is_frozen !== undefined) {
      // Only allow setting is_frozen to true (one-way)
      if (body.is_frozen === true && !existing.is_frozen) {
        updates.is_frozen = true;
        logger.info(`[AdminStrategyProfiles] Profile ${existing.key} has been frozen`);
      } else if (body.is_frozen === false && existing.is_frozen) {
        return res.status(400).json({
          success: false,
          error: 'Cannot unfreeze a frozen strategy profile',
        });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ success: true, profile: existing });
    }

    const updated = await tenantRepo.updateStrategyProfile(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'Strategy profile not found' });
    }

    res.json({ success: true, profile: updated });
  } catch (error) {
    logger.error('[AdminStrategyProfiles] Failed to update profile', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  return router;
}



