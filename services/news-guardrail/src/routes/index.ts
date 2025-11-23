import { Router, Request, Response } from 'express';
import { getTodayNewsMap } from '../services/newsScanService';
import { canTradeNow } from '../services/tradingCheckService';
import { performDailyNewsScan } from '../services/newsScanService';
import { Logger } from '@providencex/shared-utils';

const router: Router = Router();
const logger = new Logger('Routes');

// GET /news-map/today
router.get('/news-map/today', async (req, res) => {
  try {
    const newsMap = await getTodayNewsMap();
    if (!newsMap) {
      return res.status(404).json({ error: 'No news map found for today' });
    }
    res.json(newsMap);
  } catch (error) {
    logger.error('Error fetching today news map', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /can-i-trade-now?strategy={low|high}
router.get('/can-i-trade-now', async (req, res) => {
  try {
    const strategy = req.query.strategy as 'low' | 'high' | undefined;
    const response = await canTradeNow(strategy);
    
    // Add metadata about how many windows were checked (for transparency)
    const todayMap = await getTodayNewsMap();
    const metadata = {
      total_windows: todayMap?.avoid_windows.length || 0,
      critical_windows: todayMap?.avoid_windows.filter(w => w.is_critical).length || 0,
      checked_at: new Date().toISOString(),
      strategy: strategy || null, // Include strategy in response for transparency
    };
    res.json({ 
      ...response, 
      metadata 
    });
  } catch (error) {
    logger.error('Error checking trading status', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /admin/trigger-scan (for development/testing)
router.post('/admin/trigger-scan', async (req, res) => {
  try {
    logger.info('Manual scan triggered via admin endpoint');
    const newsMap = await performDailyNewsScan();
    res.json({ success: true, newsMap });
  } catch (error) {
    logger.error('Error during manual scan', error);
    res.status(500).json({ 
      error: 'Scan failed', 
      message: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

// GET /health
router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'news-guardrail' });
});

export default router;

