import express from 'express';
import cron from 'node-cron';
import { getNewsGuardrailConfig } from '@providencex/shared-config';
import { Logger } from '@providencex/shared-utils';
import { initializeDatabase } from './db/client';
import { performDailyNewsScan } from './services/newsScanService';
import routes from './routes';

const logger = new Logger('NewsGuardrail');
const app = express();
const config = getNewsGuardrailConfig();

app.use(express.json());
app.use('/', routes);

// Cron job: Run daily at 08:00 NY time (Monday-Friday)
const cronSchedule = config.cronSchedule || '0 8 * * 1-5'; // 08:00 Mon-Fri

// Schedule cron job
// Note: node-cron v3 uses server timezone by default
// If server timezone != NY, adjust cronSchedule or use UTC offset
const cronTask = cron.schedule(
  cronSchedule,
  async () => {
    logger.info('Cron job triggered: Starting daily news scan');
    try {
      await performDailyNewsScan();
      logger.info('Daily news scan completed successfully');
    } catch (error) {
      logger.error('Daily news scan failed in cron job', error);
    }
  },
  {
    scheduled: true, // Enable the job
    timezone: config.timezone || 'America/New_York', // Run at 08:00 NY time
  }
);

logger.info(`Cron job scheduled: ${cronSchedule} (${config.timezone || 'America/New_York'} timezone)`);

async function start() {
  try {
    // Initialize database
    await initializeDatabase();
    logger.info('Database initialized');

    // Start server
    app.listen(config.port, () => {
      logger.info(`News Guardrail service started on port ${config.port}`);
      logger.info(`Cron schedule: ${cronSchedule}`);
    });
  } catch (error) {
    logger.error('Failed to start service', error);
    process.exit(1);
  }
}

start();

