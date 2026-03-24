/**
 * Ingestion Routes — import sources, messages, candidates, approve/reject.
 * All routes require auth + mentor profile.
 */

import express, { Request, Response, Router } from 'express';
import { Logger } from '@providencex/shared-utils';
import { TradingEngineConfig } from '../config';
import { buildAuthMiddleware } from '../middleware/auth';
import { IngestionRepository } from '../ingestion/IngestionRepository';
import { IngestionService } from '../ingestion/IngestionService';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import type { SourceType, ReviewStatus, ParseStatus } from '../ingestion/types';

const logger = new Logger('IngestionRoutes');

export default function createIngestionRouter(config: TradingEngineConfig) {
  const router: Router = express.Router();
  const { authMiddleware, requireUser } = buildAuthMiddleware(config);

  const ingestionRepo = new IngestionRepository();
  const ingestionService = new IngestionService(ingestionRepo);
  const copyRepo = new CopyTradingRepository();

  router.use(authMiddleware, requireUser);

  // Helper: get mentor profile or 403
  async function getMentorProfile(req: Request, res: Response) {
    const profile = await copyRepo.getMentorProfileByUserId(req.auth!.userId);
    if (!profile) { res.status(403).json({ error: 'You must be a mentor' }); return null; }
    return profile;
  }

  // ==================== Sources ====================

  router.get('/sources', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const sources = await ingestionRepo.getSources(profile.id);
      res.json({ success: true, sources });
    } catch (error) {
      logger.error('[Ingestion] List sources failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/sources', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const { source_type, source_name, source_identifier, config: sourceConfig } = req.body || {};
      if (!source_type || !source_name || !source_identifier) {
        return res.status(400).json({ error: 'source_type, source_name, and source_identifier are required' });
      }
      const validTypes: SourceType[] = ['telegram', 'discord', 'webhook'];
      if (!validTypes.includes(source_type)) {
        return res.status(400).json({ error: `source_type must be one of: ${validTypes.join(', ')}` });
      }
      const source = await ingestionRepo.createSource({
        mentorProfileId: profile.id,
        sourceType: source_type,
        sourceName: source_name,
        sourceIdentifier: source_identifier,
        config: sourceConfig,
      });
      res.status(201).json({ success: true, source });
    } catch (error: any) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Source already exists with this identifier' });
      }
      logger.error('[Ingestion] Create source failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/sources/:id/toggle', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const source = await ingestionRepo.getSourceById(req.params.id);
      if (!source || source.mentor_profile_id !== profile.id) {
        return res.status(404).json({ error: 'Source not found' });
      }
      await ingestionRepo.updateSourceActive(source.id, !source.is_active);
      res.json({ success: true, is_active: !source.is_active });
    } catch (error) {
      logger.error('[Ingestion] Toggle source failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Messages ====================

  router.get('/messages', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const messages = await ingestionRepo.getMessages(profile.id, {
        sourceId: req.query.source_id as string | undefined,
        parseStatus: req.query.parse_status as ParseStatus | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, messages });
    } catch (error) {
      logger.error('[Ingestion] List messages failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /messages/ingest
   * Manually ingest a message (for testing or manual paste).
   */
  router.post('/messages/ingest', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const { source_id, raw_text, external_message_id, sender_name } = req.body || {};
      if (!source_id || !raw_text) {
        return res.status(400).json({ error: 'source_id and raw_text are required' });
      }
      const source = await ingestionRepo.getSourceById(source_id);
      if (!source || source.mentor_profile_id !== profile.id) {
        return res.status(404).json({ error: 'Source not found' });
      }

      const result = await ingestionService.ingestMessage({
        sourceId: source_id,
        mentorProfileId: profile.id,
        rawText: raw_text,
        externalMessageId: external_message_id,
        senderName: sender_name,
      });

      res.status(201).json({ success: true, ...result });
    } catch (error) {
      logger.error('[Ingestion] Ingest message failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ==================== Candidates ====================

  router.get('/candidates', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const candidates = await ingestionRepo.getCandidates(profile.id, {
        reviewStatus: req.query.review_status as ReviewStatus | undefined,
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json({ success: true, candidates });
    } catch (error) {
      logger.error('[Ingestion] List candidates failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/candidates/:id', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const candidate = await ingestionRepo.getCandidateById(req.params.id);
      if (!candidate || candidate.mentor_profile_id !== profile.id) {
        return res.status(404).json({ error: 'Candidate not found' });
      }
      res.json({ success: true, candidate });
    } catch (error) {
      logger.error('[Ingestion] Get candidate failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.patch('/candidates/:id', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const candidate = await ingestionRepo.getCandidateById(req.params.id);
      if (!candidate || candidate.mentor_profile_id !== profile.id) {
        return res.status(404).json({ error: 'Candidate not found' });
      }
      const updated = await ingestionRepo.updateCandidate(req.params.id, {
        candidateType: req.body.candidate_type,
        parsedSymbol: req.body.parsed_symbol,
        parsedDirection: req.body.parsed_direction,
        parsedOrderKind: req.body.parsed_order_kind,
        parsedEntryPrice: req.body.parsed_entry_price != null ? Number(req.body.parsed_entry_price) : undefined,
        parsedStopLoss: req.body.parsed_stop_loss != null ? Number(req.body.parsed_stop_loss) : undefined,
        parsedTp1: req.body.parsed_tp1 != null ? Number(req.body.parsed_tp1) : undefined,
        parsedTp2: req.body.parsed_tp2 != null ? Number(req.body.parsed_tp2) : undefined,
        parsedTp3: req.body.parsed_tp3 != null ? Number(req.body.parsed_tp3) : undefined,
        parsedTp4: req.body.parsed_tp4 != null ? Number(req.body.parsed_tp4) : undefined,
        parsedNotes: req.body.parsed_notes,
        parsedUpdateType: req.body.parsed_update_type,
        parsedNewSl: req.body.parsed_new_sl != null ? Number(req.body.parsed_new_sl) : undefined,
        parsedCloseTpLevel: req.body.parsed_close_tp_level != null ? Number(req.body.parsed_close_tp_level) : undefined,
        linkedSignalId: req.body.linked_signal_id,
        reviewerNotes: req.body.reviewer_notes,
      });
      res.json({ success: true, candidate: updated });
    } catch (error) {
      logger.error('[Ingestion] Update candidate failed', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/candidates/:id/approve', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      const result = await ingestionService.approveAndPublish(req.params.id, profile.id);
      res.json({ success: true, ...result });
    } catch (error: any) {
      logger.error('[Ingestion] Approve candidate failed', error);
      res.status(400).json({ error: error.message || 'Failed to approve' });
    }
  });

  router.post('/candidates/:id/reject', async (req: Request, res: Response) => {
    try {
      const profile = await getMentorProfile(req, res); if (!profile) return;
      await ingestionService.rejectCandidate(req.params.id, profile.id, req.body?.notes);
      res.json({ success: true });
    } catch (error: any) {
      logger.error('[Ingestion] Reject candidate failed', error);
      res.status(400).json({ error: error.message || 'Failed to reject' });
    }
  });

  return router;
}
