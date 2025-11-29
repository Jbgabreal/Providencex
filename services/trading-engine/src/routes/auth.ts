import express, { Router, Request, Response } from 'express';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';

export default function createAuthRouter(config: TradingEngineConfig): Router {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  router.get('/me', authMiddleware, requireUser, async (req: Request, res: Response) => {
    const auth = req.auth!;
    return res.json({
      success: true,
      user: {
        id: auth.userId,
        role: auth.role,
        privyUserId: auth.privyUserId ?? null,
        email: auth.identity?.email ?? null,
      },
    });
  });

  return router;
}

