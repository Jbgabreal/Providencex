/**
 * IngestionService — Orchestrates message ingestion, parsing, and candidate creation.
 * Also handles approval/publish flow into the existing mentor signal engine.
 */

import { Logger } from '@providencex/shared-utils';
import { IngestionRepository } from './IngestionRepository';
import { SignalParser } from './SignalParser';
import { CopyTradingRepository } from '../copytrading/CopyTradingRepository';
import { CopyTradingOrchestrator } from '../copytrading/CopyTradingOrchestrator';
import { CopyTradingUpdatePropagator } from '../copytrading/CopyTradingUpdatePropagator';
import { CopyTradingRiskService } from '../copytrading/CopyTradingRiskService';
import { TenantRepository } from '../db/TenantRepository';
import type { ImportedSignalCandidate } from './types';

const logger = new Logger('IngestionService');

export class IngestionService {
  private parser = new SignalParser();
  private copyRepo: CopyTradingRepository;
  private orchestrator: CopyTradingOrchestrator;
  private propagator: CopyTradingUpdatePropagator;

  constructor(private repo: IngestionRepository) {
    this.copyRepo = new CopyTradingRepository();
    const tenantRepo = new TenantRepository();
    const riskService = new CopyTradingRiskService();
    this.orchestrator = new CopyTradingOrchestrator(this.copyRepo, tenantRepo, riskService);
    this.propagator = new CopyTradingUpdatePropagator(this.copyRepo, tenantRepo);
  }

  /**
   * Ingest a raw message: store it, parse it, create candidate if signal detected.
   */
  async ingestMessage(params: {
    sourceId: string;
    mentorProfileId: string;
    rawText: string;
    externalMessageId?: string;
    rawPayload?: Record<string, unknown>;
    senderName?: string;
    senderId?: string;
    messageTimestamp?: string;
  }): Promise<{ message: any; candidate: ImportedSignalCandidate | null }> {
    // 1. Store raw message
    const message = await this.repo.createMessage({
      sourceId: params.sourceId,
      mentorProfileId: params.mentorProfileId,
      externalMessageId: params.externalMessageId,
      rawText: params.rawText,
      rawPayload: params.rawPayload,
      senderName: params.senderName,
      senderId: params.senderId,
      messageTimestamp: params.messageTimestamp,
    });

    if (!message) {
      logger.info(`[Ingestion] Duplicate message skipped: ${params.externalMessageId}`);
      return { message: null, candidate: null };
    }

    // 2. Parse
    const parsed = this.parser.parse(params.rawText);

    if (!parsed) {
      await this.repo.updateMessageParseStatus(message.id, 'no_signal');
      return { message, candidate: null };
    }

    // 3. Update message parse status
    await this.repo.updateMessageParseStatus(message.id, 'parsed', parsed.confidence);

    // 4. Create candidate
    const candidate = await this.repo.createCandidate({
      importedMessageId: message.id,
      sourceId: params.sourceId,
      mentorProfileId: params.mentorProfileId,
      candidateType: parsed.candidateType,
      parsedSymbol: parsed.symbol,
      parsedDirection: parsed.direction,
      parsedOrderKind: parsed.orderKind,
      parsedEntryPrice: parsed.entryPrice,
      parsedStopLoss: parsed.stopLoss,
      parsedTp1: parsed.tp1,
      parsedTp2: parsed.tp2,
      parsedTp3: parsed.tp3,
      parsedTp4: parsed.tp4,
      parsedNotes: parsed.notes,
      parsedUpdateType: parsed.updateType,
      parsedNewSl: parsed.newSl,
      parsedCloseTpLevel: parsed.closeTpLevel,
      parseConfidence: parsed.confidence,
      rawParsedFields: parsed as any,
    });

    logger.info(`[Ingestion] Parsed candidate: ${parsed.candidateType} ${parsed.symbol || parsed.updateType} (confidence=${parsed.confidence})`);

    return { message, candidate };
  }

  /**
   * Approve a candidate and publish it as a mentor signal or signal update.
   * Triggers the existing copy-trading fanout pipeline.
   */
  async approveAndPublish(candidateId: string, mentorProfileId: string): Promise<{
    signal?: any; signalUpdate?: any; fanoutSummary?: any; propagationSummary?: any;
  }> {
    const candidate = await this.repo.getCandidateById(candidateId);
    if (!candidate) throw new Error('Candidate not found');
    if (candidate.mentor_profile_id !== mentorProfileId) throw new Error('Not your candidate');
    if (candidate.review_status === 'approved') throw new Error('Already approved');

    if (candidate.candidate_type === 'new_signal') {
      return this.publishNewSignal(candidate);
    } else {
      return this.publishSignalUpdate(candidate);
    }
  }

  private async publishNewSignal(candidate: ImportedSignalCandidate) {
    if (!candidate.parsed_symbol || !candidate.parsed_direction || !candidate.parsed_entry_price || !candidate.parsed_stop_loss) {
      throw new Error('Missing required fields: symbol, direction, entry_price, stop_loss');
    }

    const idempotencyKey = `import_${candidate.id}`;

    const signal = await this.copyRepo.createSignal({
      mentorProfileId: candidate.mentor_profile_id,
      symbol: candidate.parsed_symbol.toUpperCase(),
      direction: candidate.parsed_direction.toUpperCase() as 'BUY' | 'SELL',
      orderKind: (candidate.parsed_order_kind as any) || 'market',
      entryPrice: Number(candidate.parsed_entry_price),
      stopLoss: Number(candidate.parsed_stop_loss),
      tp1: candidate.parsed_tp1 ? Number(candidate.parsed_tp1) : undefined,
      tp2: candidate.parsed_tp2 ? Number(candidate.parsed_tp2) : undefined,
      tp3: candidate.parsed_tp3 ? Number(candidate.parsed_tp3) : undefined,
      tp4: candidate.parsed_tp4 ? Number(candidate.parsed_tp4) : undefined,
      notes: candidate.parsed_notes || `Imported from external source`,
      idempotencyKey,
    });

    // Fan out to followers
    const fanoutSummary = await this.orchestrator.fanoutSignal(signal.id);

    // Link back to candidate
    await this.repo.setCandidatePublished(candidate.id, signal.id);

    logger.info(`[Ingestion] Published signal ${signal.id} from candidate ${candidate.id}`);

    return { signal, fanoutSummary };
  }

  private async publishSignalUpdate(candidate: ImportedSignalCandidate) {
    if (!candidate.parsed_update_type) {
      throw new Error('Missing update_type for signal_update candidate');
    }
    if (!candidate.linked_signal_id) {
      throw new Error('Signal update candidate must have a linked_signal_id');
    }

    const idempotencyKey = `import_upd_${candidate.id}`;

    const update = await this.copyRepo.createSignalUpdate({
      mentorSignalId: candidate.linked_signal_id,
      updateType: candidate.parsed_update_type as any,
      newSl: candidate.parsed_new_sl ? Number(candidate.parsed_new_sl) : undefined,
      closeTpLevel: candidate.parsed_close_tp_level || undefined,
      notes: candidate.parsed_notes || 'Imported update',
      idempotencyKey,
    });

    const propagationSummary = await this.propagator.propagateUpdate(update.id);

    await this.repo.setCandidatePublished(candidate.id, undefined, update.id);

    logger.info(`[Ingestion] Published signal update ${update.id} from candidate ${candidate.id}`);

    return { signalUpdate: update, propagationSummary };
  }

  /**
   * Reject a candidate.
   */
  async rejectCandidate(candidateId: string, mentorProfileId: string, notes?: string): Promise<void> {
    const candidate = await this.repo.getCandidateById(candidateId);
    if (!candidate) throw new Error('Candidate not found');
    if (candidate.mentor_profile_id !== mentorProfileId) throw new Error('Not your candidate');

    await this.repo.setCandidateReviewStatus(candidateId, 'rejected');
    if (notes) {
      await this.repo.updateCandidate(candidateId, { reviewerNotes: notes });
    }

    logger.info(`[Ingestion] Rejected candidate ${candidateId}`);
  }
}
