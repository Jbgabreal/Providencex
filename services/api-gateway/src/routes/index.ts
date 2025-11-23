import { Router } from 'express';
import axios from 'axios';
import { getAPIGatewayConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';

const router = Router();
const logger = new Logger('APIGatewayRoutes');
const config = getAPIGatewayConfig();

// GET /health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

// Proxy to news-guardrail
router.get('/news/can-i-trade-now', async (req, res) => {
  try {
    const response = await axios.get(`${config.newsGuardrailUrl}/can-i-trade-now`);
    res.json(response.data);
  } catch (error) {
    logger.error('Error proxying to news-guardrail', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/news/map/today', async (req, res) => {
  try {
    const response = await axios.get(`${config.newsGuardrailUrl}/news-map/today`);
    res.json(response.data);
  } catch (error) {
    logger.error('Error proxying to news-guardrail', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// TODO: Add auth middleware
// TODO: Add more proxy routes for other services

export default router;

