import dotenv from 'dotenv';
import path from 'path';

// Load .env from root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export interface LivePnlConfig {
  equitySnapshotIntervalSec: number; // Default: 60
  timezone: string; // e.g. 'America/New_York'
  enabled: boolean; // Default: true
}

export function getLivePnlConfig(): LivePnlConfig {
  return {
    equitySnapshotIntervalSec: parseInt(
      process.env.LIVE_EQUITY_SNAPSHOT_INTERVAL_SEC || '60',
      10
    ),
    timezone: process.env.PX_TIMEZONE || 'America/New_York',
    enabled: process.env.LIVE_PNL_ENABLED !== 'false', // Default: true
  };
}


