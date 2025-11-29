import express, { Router } from 'express';

const router: Router = express.Router();

// GET /health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'portfolio-engine' });
});

// TODO: Implement portfolio endpoints
// GET /products
// GET /products/:id
// GET /users/:userId/portfolio
// POST /users/:userId/positions

export default router;

