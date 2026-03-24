/**
 * Signal Ingestion Domain Types — Phase 7
 */

export type SourceType = 'telegram' | 'discord' | 'webhook';
export type ParseStatus = 'pending' | 'parsed' | 'no_signal' | 'error';
export type CandidateType = 'new_signal' | 'signal_update';
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'edited';

export interface ImportSignalSource {
  id: string;
  mentor_profile_id: string;
  source_type: SourceType;
  source_name: string;
  source_identifier: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ImportedMessage {
  id: string;
  source_id: string;
  mentor_profile_id: string;
  external_message_id: string | null;
  raw_text: string;
  raw_payload: Record<string, unknown>;
  sender_name: string | null;
  sender_id: string | null;
  message_timestamp: string | null;
  parse_status: ParseStatus;
  parse_confidence: number | null;
  created_at: string;
}

export interface ImportedSignalCandidate {
  id: string;
  imported_message_id: string;
  source_id: string;
  mentor_profile_id: string;
  candidate_type: CandidateType;
  parsed_symbol: string | null;
  parsed_direction: string | null;
  parsed_order_kind: string | null;
  parsed_entry_price: number | null;
  parsed_stop_loss: number | null;
  parsed_tp1: number | null;
  parsed_tp2: number | null;
  parsed_tp3: number | null;
  parsed_tp4: number | null;
  parsed_notes: string | null;
  parsed_update_type: string | null;
  parsed_new_sl: number | null;
  parsed_close_tp_level: number | null;
  linked_signal_id: string | null;
  parse_confidence: number | null;
  raw_parsed_fields: Record<string, unknown>;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  published_signal_id: string | null;
  published_signal_update_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParsedSignalFields {
  symbol?: string;
  direction?: 'BUY' | 'SELL';
  orderKind?: 'market' | 'limit' | 'stop';
  entryPrice?: number;
  stopLoss?: number;
  tp1?: number;
  tp2?: number;
  tp3?: number;
  tp4?: number;
  notes?: string;
  updateType?: 'move_sl' | 'breakeven' | 'partial_close' | 'close_all' | 'cancel';
  newSl?: number;
  closeTpLevel?: number;
  candidateType: CandidateType;
  confidence: number;
}

/**
 * Source connector interface — implement for each source type.
 */
export interface SourceConnector {
  sourceType: SourceType;
  ingestMessages(source: ImportSignalSource): Promise<{
    externalMessageId?: string;
    rawText: string;
    rawPayload?: Record<string, unknown>;
    senderName?: string;
    senderId?: string;
    messageTimestamp?: string;
  }[]>;
}
