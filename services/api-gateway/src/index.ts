import express from 'express';
import { getAPIGatewayConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';
import routes from './routes';

const logger = new Logger('APIGateway');
const app = express();
const config = getAPIGatewayConfig();

app.use(express.json());
app.use('/', routes);

async function start() {
  try {
    app.listen(config.port, () => {
      logger.info(`API Gateway service started on port ${config.port}`);
      logger.info('API Gateway is scaffolded - auth and full routing pending');
    });
  } catch (error) {
    logger.error('Failed to start service', error);
    process.exit(1);
  }
}

start();

