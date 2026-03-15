import express, { Request, Response, NextFunction } from 'express';
import { getAPIGatewayConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';
import routes from './routes';

const logger = new Logger('APIGateway');
const app = express();
const config = getAPIGatewayConfig();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware - Allow all origins in development, configure for production
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  
  // Allow requests from client portal and admin dashboard
  const allowedOrigins = [
    'http://localhost:3002', // Client portal
    'http://localhost:3001', // Admin dashboard
    'http://localhost:3000', // API Gateway itself
  ];
  
  if (origin && (allowedOrigins.includes(origin) || process.env.NODE_ENV === 'development')) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-user-role, x-user-email, x-privy-token');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

// Routes
app.use('/', routes);

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error in API Gateway', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    app.listen(config.port, () => {
      logger.info(`API Gateway service started on port ${config.port}`);
      logger.info(`Proxying to services:`);
      logger.info(`  - Trading Engine: ${config.tradingEngineUrl}`);
      logger.info(`  - News Guardrail: ${config.newsGuardrailUrl}`);
      logger.info(`  - Portfolio Engine: ${config.portfolioEngineUrl}`);
      logger.info(`  - Farming Engine: ${config.farmingEngineUrl}`);
      logger.info('API Gateway is ready to route requests');
    });
  } catch (error) {
    logger.error('Failed to start service', error);
    process.exit(1);
  }
}

start();

