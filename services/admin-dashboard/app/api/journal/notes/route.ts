import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const NOTES_PATH = path.resolve(process.cwd(), '../trading-engine/backtests/trade_notes.json');

export interface TradeNote {
  entryAnalysis: string;
  postTradeReview: string;
  tags: string[];
  rating: number | null; // 1-5 self-rating of trade quality
  updatedAt: string;
}

export type TradeNotes = Record<string, TradeNote>;

function readNotes(): TradeNotes {
  if (!fs.existsSync(NOTES_PATH)) return {};
  return JSON.parse(fs.readFileSync(NOTES_PATH, 'utf-8'));
}

function writeNotes(notes: TradeNotes) {
  fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2), 'utf-8');
}

// GET - return all notes
export async function GET() {
  const notes = readNotes();
  return NextResponse.json({ notes });
}

// POST - save note for a specific trade
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tradeId, entryAnalysis, postTradeReview, tags, rating } = body;

  if (!tradeId) {
    return NextResponse.json({ error: 'tradeId is required' }, { status: 400 });
  }

  const notes = readNotes();
  notes[String(tradeId)] = {
    entryAnalysis: entryAnalysis || '',
    postTradeReview: postTradeReview || '',
    tags: tags || [],
    rating: rating ?? null,
    updatedAt: new Date().toISOString(),
  };

  writeNotes(notes);
  return NextResponse.json({ success: true, note: notes[String(tradeId)] });
}
