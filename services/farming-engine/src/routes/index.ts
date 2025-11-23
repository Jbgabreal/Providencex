import { Router } from 'express';

const router = Router();

// GET /health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: "farming-engine" });
});

// TODO: Implement farming endpoints
// GET /cycles
// GET /cycles/:id
// POST /cycles/:id/close

export default router;

