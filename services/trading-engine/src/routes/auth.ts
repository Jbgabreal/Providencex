import express, { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';

export default function createAuthRouter(config: TradingEngineConfig): Router {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const dbUrl = process.env.DATABASE_URL;
  const pool = dbUrl
    ? new Pool({
        connectionString: dbUrl,
        ssl: dbUrl.includes('localhost') ? false : { rejectUnauthorized: false },
      })
    : null;

  router.get('/me', authMiddleware, requireUser, async (req: Request, res: Response) => {
    const auth = req.auth!;

    let mentorProfile: { id: string; is_approved: boolean; display_name: string } | null = null;
    if (pool) {
      try {
        const result = await pool.query(
          'SELECT id, is_approved, display_name FROM mentor_profiles WHERE user_id = $1',
          [auth.userId]
        );
        if (result.rows.length > 0) {
          mentorProfile = result.rows[0];
        }
      } catch {
        // Non-fatal — mentor profile lookup failed, continue without it
      }
    }

    return res.json({
      success: true,
      user: {
        id: auth.userId,
        role: auth.role,
        privyUserId: auth.privyUserId ?? null,
        email: auth.identity?.email ?? null,
        mentorProfile,
      },
    });
  });

  return router;
}

