/**
 * IngestionRepository — Data access for import sources, messages, and candidates.
 */

import { Pool } from 'pg';
import { Logger } from '@providencex/shared-utils';
import { getConfig } from '../config';
import type {
  ImportSignalSource, ImportedMessage, ImportedSignalCandidate,
  SourceType, ParseStatus, ReviewStatus, CandidateType,
} from './types';

const logger = new Logger('IngestionRepository');

export class IngestionRepository {
  private pool: Pool | null = null;

  constructor(databaseUrl?: string) {
    const config = getConfig();
    const url = databaseUrl || config.databaseUrl;
    if (!url) { logger.warn('[IngestionRepository] No databaseUrl'); return; }
    this.pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') ? false : { rejectUnauthorized: false },
    });
  }

  private ensurePool(): Pool {
    if (!this.pool) throw new Error('[IngestionRepository] Pool not initialized');
    return this.pool;
  }

  // ==================== Sources ====================

  async getSources(mentorProfileId: string): Promise<ImportSignalSource[]> {
    const pool = this.ensurePool();
    const result = await pool.query(
      'SELECT * FROM import_signal_sources WHERE mentor_profile_id = $1 ORDER BY created_at DESC',
      [mentorProfileId]
    );
    return result.rows;
  }

  async getSourceById(id: string): Promise<ImportSignalSource | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM import_signal_sources WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async createSource(params: {
    mentorProfileId: string; sourceType: SourceType; sourceName: string;
    sourceIdentifier: string; config?: Record<string, unknown>;
  }): Promise<ImportSignalSource> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO import_signal_sources (mentor_profile_id, source_type, source_name, source_identifier, config)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [params.mentorProfileId, params.sourceType, params.sourceName,
       params.sourceIdentifier, JSON.stringify(params.config || {})]
    );
    return result.rows[0];
  }

  async updateSourceActive(id: string, isActive: boolean): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      'UPDATE import_signal_sources SET is_active = $2, updated_at = NOW() WHERE id = $1',
      [id, isActive]
    );
  }

  // ==================== Messages ====================

  async createMessage(params: {
    sourceId: string; mentorProfileId: string; externalMessageId?: string;
    rawText: string; rawPayload?: Record<string, unknown>;
    senderName?: string; senderId?: string; messageTimestamp?: string;
  }): Promise<ImportedMessage | null> {
    const pool = this.ensurePool();
    try {
      const result = await pool.query(
        `INSERT INTO imported_messages (
          source_id, mentor_profile_id, external_message_id, raw_text, raw_payload,
          sender_name, sender_id, message_timestamp
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (source_id, external_message_id) DO NOTHING
        RETURNING *`,
        [params.sourceId, params.mentorProfileId, params.externalMessageId || null,
         params.rawText, JSON.stringify(params.rawPayload || {}),
         params.senderName || null, params.senderId || null, params.messageTimestamp || null]
      );
      return result.rows[0] || null;
    } catch (error) {
      logger.error('[IngestionRepo] Create message failed', error);
      return null;
    }
  }

  async getMessages(mentorProfileId: string, opts?: {
    sourceId?: string; parseStatus?: ParseStatus; limit?: number; offset?: number;
  }): Promise<ImportedMessage[]> {
    const pool = this.ensurePool();
    let where = 'WHERE mentor_profile_id = $1';
    const params: any[] = [mentorProfileId];
    let i = 2;
    if (opts?.sourceId) { where += ` AND source_id = $${i++}`; params.push(opts.sourceId); }
    if (opts?.parseStatus) { where += ` AND parse_status = $${i++}`; params.push(opts.parseStatus); }
    params.push(opts?.limit || 50, opts?.offset || 0);
    const result = await pool.query(
      `SELECT * FROM imported_messages ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      params
    );
    return result.rows;
  }

  async updateMessageParseStatus(id: string, status: ParseStatus, confidence?: number): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      'UPDATE imported_messages SET parse_status = $2, parse_confidence = $3 WHERE id = $1',
      [id, status, confidence || null]
    );
  }

  // ==================== Candidates ====================

  async createCandidate(params: {
    importedMessageId: string; sourceId: string; mentorProfileId: string;
    candidateType: CandidateType;
    parsedSymbol?: string; parsedDirection?: string; parsedOrderKind?: string;
    parsedEntryPrice?: number; parsedStopLoss?: number;
    parsedTp1?: number; parsedTp2?: number; parsedTp3?: number; parsedTp4?: number;
    parsedNotes?: string; parsedUpdateType?: string; parsedNewSl?: number;
    parsedCloseTpLevel?: number; linkedSignalId?: string;
    parseConfidence?: number; rawParsedFields?: Record<string, unknown>;
  }): Promise<ImportedSignalCandidate> {
    const pool = this.ensurePool();
    const result = await pool.query(
      `INSERT INTO imported_signal_candidates (
        imported_message_id, source_id, mentor_profile_id, candidate_type,
        parsed_symbol, parsed_direction, parsed_order_kind,
        parsed_entry_price, parsed_stop_loss, parsed_tp1, parsed_tp2, parsed_tp3, parsed_tp4,
        parsed_notes, parsed_update_type, parsed_new_sl, parsed_close_tp_level,
        linked_signal_id, parse_confidence, raw_parsed_fields
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [
        params.importedMessageId, params.sourceId, params.mentorProfileId, params.candidateType,
        params.parsedSymbol || null, params.parsedDirection || null, params.parsedOrderKind || 'market',
        params.parsedEntryPrice || null, params.parsedStopLoss || null,
        params.parsedTp1 || null, params.parsedTp2 || null, params.parsedTp3 || null, params.parsedTp4 || null,
        params.parsedNotes || null, params.parsedUpdateType || null, params.parsedNewSl || null,
        params.parsedCloseTpLevel || null, params.linkedSignalId || null,
        params.parseConfidence || null, JSON.stringify(params.rawParsedFields || {}),
      ]
    );
    return result.rows[0];
  }

  async getCandidates(mentorProfileId: string, opts?: {
    reviewStatus?: ReviewStatus; limit?: number; offset?: number;
  }): Promise<ImportedSignalCandidate[]> {
    const pool = this.ensurePool();
    let where = 'WHERE mentor_profile_id = $1';
    const params: any[] = [mentorProfileId];
    let i = 2;
    if (opts?.reviewStatus) { where += ` AND review_status = $${i++}`; params.push(opts.reviewStatus); }
    params.push(opts?.limit || 50, opts?.offset || 0);
    const result = await pool.query(
      `SELECT * FROM imported_signal_candidates ${where} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
      params
    );
    return result.rows;
  }

  async getCandidateById(id: string): Promise<ImportedSignalCandidate | null> {
    const pool = this.ensurePool();
    const result = await pool.query('SELECT * FROM imported_signal_candidates WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  async updateCandidate(id: string, updates: Partial<{
    candidateType: CandidateType; parsedSymbol: string; parsedDirection: string;
    parsedOrderKind: string; parsedEntryPrice: number; parsedStopLoss: number;
    parsedTp1: number; parsedTp2: number; parsedTp3: number; parsedTp4: number;
    parsedNotes: string; parsedUpdateType: string; parsedNewSl: number;
    parsedCloseTpLevel: number; linkedSignalId: string; reviewerNotes: string;
  }>): Promise<ImportedSignalCandidate | null> {
    const pool = this.ensurePool();
    const sets: string[] = [];
    const params: any[] = [];
    let i = 1;
    const fieldMap: Record<string, string> = {
      candidateType: 'candidate_type', parsedSymbol: 'parsed_symbol', parsedDirection: 'parsed_direction',
      parsedOrderKind: 'parsed_order_kind', parsedEntryPrice: 'parsed_entry_price', parsedStopLoss: 'parsed_stop_loss',
      parsedTp1: 'parsed_tp1', parsedTp2: 'parsed_tp2', parsedTp3: 'parsed_tp3', parsedTp4: 'parsed_tp4',
      parsedNotes: 'parsed_notes', parsedUpdateType: 'parsed_update_type', parsedNewSl: 'parsed_new_sl',
      parsedCloseTpLevel: 'parsed_close_tp_level', linkedSignalId: 'linked_signal_id', reviewerNotes: 'reviewer_notes',
    };
    for (const [key, col] of Object.entries(fieldMap)) {
      if ((updates as any)[key] !== undefined) {
        sets.push(`${col} = $${i++}`);
        params.push((updates as any)[key]);
      }
    }
    if (sets.length === 0) return this.getCandidateById(id);
    sets.push(`review_status = 'edited'`, 'updated_at = NOW()');
    params.push(id);
    const result = await pool.query(
      `UPDATE imported_signal_candidates SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  async setCandidateReviewStatus(id: string, status: ReviewStatus): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE imported_signal_candidates SET review_status = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, status]
    );
  }

  async setCandidatePublished(id: string, signalId?: string, signalUpdateId?: string): Promise<void> {
    const pool = this.ensurePool();
    await pool.query(
      `UPDATE imported_signal_candidates
       SET review_status = 'approved', reviewed_at = NOW(),
           published_signal_id = $2, published_signal_update_id = $3, updated_at = NOW()
       WHERE id = $1`,
      [id, signalId || null, signalUpdateId || null]
    );
  }
}
