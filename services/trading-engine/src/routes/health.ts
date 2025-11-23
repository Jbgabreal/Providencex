import { Router, Request, Response } from 'express';

const router: Router = Router();

// GET /health
router.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'trading-engine' });
});

export default router;

