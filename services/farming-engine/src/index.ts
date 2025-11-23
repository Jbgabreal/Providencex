import express from 'express';
import { getFarmingEngineConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';
import routes from './routes';

const logger = new Logger('FarmingEngine');
const app = express();
const config = getFarmingEngineConfig();

app.use(express.json());
app.use('/', routes);

async function start() {
  try {
    app.listen(config.port, () => {
      logger.info(`Farming Engine service started on port ${config.port}`);
      logger.info('Farming Engine is scaffolded - implementation pending');
    });
  } catch (error) {
    logger.error('Failed to start service', error);
    process.exit(1);
  }
}

start();

