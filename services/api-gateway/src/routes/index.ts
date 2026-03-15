import express, { Router, Request, Response, NextFunction } from 'express';
import axios, { AxiosError } from 'axios';
import { getAPIGatewayConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';

const router: Router = express.Router();
const logger = new Logger('APIGatewayRoutes');
const config = getAPIGatewayConfig();

// GET /health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

// ============================================================================
// PROXY ROUTES - Forward requests to backend services
// ============================================================================

/**
 * Generic proxy function to forward requests to backend services
 */
async function proxyRequest(
  targetUrl: string,
  req: Request,
  res: Response,
  serviceName: string
): Promise<void> {
  try {
    const method = req.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
    const url = `${targetUrl}${req.path}`;
    
    logger.info(`[API Gateway] Proxying ${req.method} ${req.path} → ${url}`);

    // Prepare headers - forward all except host
    const headers: Record<string, string> = {};
    Object.keys(req.headers).forEach((key) => {
      const value = req.headers[key];
      if (key.toLowerCase() !== 'host' && value) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
    });

    const axiosConfig = {
      method,
      url,
      headers,
      params: req.query,
      data: req.body,
      timeout: 30000,
      validateStatus: () => true, // Don't throw on any status code
    };

    const response = await axios(axiosConfig);
    
    // Log response for debugging
    if (response.status >= 400) {
      logger.error(
        `[API Gateway] ${serviceName} returned ${response.status} for ${req.path}`,
        {
          status: response.status,
          statusText: response.statusText,
          data: response.data,
          url,
        }
      );
    }
    
    // Forward the response
    res.status(response.status);
    
    // Forward response headers (except those that shouldn't be forwarded)
    Object.keys(response.headers).forEach((key) => {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey !== 'host' &&
        lowerKey !== 'connection' &&
        lowerKey !== 'transfer-encoding'
      ) {
        res.setHeader(key, response.headers[key] as string);
      }
    });
    
    res.json(response.data);
  } catch (error) {
    const axiosError = error as AxiosError;
    
    logger.error(`[API Gateway] Error proxying to ${serviceName}`, {
      path: req.path,
      method: req.method,
      error: axiosError.message,
      stack: axiosError.stack,
      response: axiosError.response?.data,
      status: axiosError.response?.status,
    });
    
    if (axiosError.response) {
      // Backend service responded with error - forward it
      res.status(axiosError.response.status);
      res.json(axiosError.response.data || { 
        error: 'Internal server error',
        message: axiosError.message,
      });
    } else if (axiosError.request) {
      // Request was made but no response received
      logger.error(`[API Gateway] No response from ${serviceName}`, { 
        path: req.path,
        url: `${targetUrl}${req.path}`,
      });
      res.status(503).json({ 
        error: `${serviceName} is unavailable`,
        message: 'The backend service did not respond',
      });
    } else {
      // Error setting up request
      res.status(500).json({ 
        error: 'Internal server error',
        message: axiosError.message,
      });
    }
  }
}

// ============================================================================
// TRADING ENGINE ROUTES
// ============================================================================

// Proxy all /api/* routes to trading-engine
router.all('/api/*', async (req: Request, res: Response) => {
  await proxyRequest(config.tradingEngineUrl, req, res, 'trading-engine');
});

// Proxy /health to trading-engine
router.get('/trading-engine/health', async (req: Request, res: Response) => {
  await proxyRequest(config.tradingEngineUrl, req, res, 'trading-engine');
});

// ============================================================================
// NEWS GUARDRAIL ROUTES
// ============================================================================

router.get('/news/can-i-trade-now', async (req: Request, res: Response) => {
  await proxyRequest(config.newsGuardrailUrl, req, res, 'news-guardrail');
});

router.get('/news/map/today', async (req: Request, res: Response) => {
  await proxyRequest(config.newsGuardrailUrl, req, res, 'news-guardrail');
});

// Proxy all /news/* routes to news-guardrail
router.all('/news/*', async (req: Request, res: Response) => {
  await proxyRequest(config.newsGuardrailUrl, req, res, 'news-guardrail');
});

// ============================================================================
// PORTFOLIO ENGINE ROUTES
// ============================================================================

router.all('/portfolio/*', async (req: Request, res: Response) => {
  await proxyRequest(config.portfolioEngineUrl, req, res, 'portfolio-engine');
});

// ============================================================================
// FARMING ENGINE ROUTES
// ============================================================================

router.all('/farming/*', async (req: Request, res: Response) => {
  await proxyRequest(config.farmingEngineUrl, req, res, 'farming-engine');
});

export default router;

