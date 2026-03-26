import { NextRequest, NextResponse } from 'next/server';
import cloudinary, { getPublicId } from '@/lib/cloudinary';
import fs from 'fs';
import path from 'path';

// Store screenshot URLs in a JSON file alongside trade notes
const SCREENSHOTS_JSON = fs.existsSync(path.resolve(process.cwd(), 'data'))
  ? path.resolve(process.cwd(), 'data/trade_screenshots.json')
  : path.resolve(process.cwd(), '../trading-engine/backtests/trade_screenshots.json');

type ScreenshotMap = Record<string, { setup?: string; result?: string }>;

function readScreenshots(): ScreenshotMap {
  if (!fs.existsSync(SCREENSHOTS_JSON)) return {};
  return JSON.parse(fs.readFileSync(SCREENSHOTS_JSON, 'utf-8'));
}

function writeScreenshots(data: ScreenshotMap) {
  fs.writeFileSync(SCREENSHOTS_JSON, JSON.stringify(data, null, 2), 'utf-8');
}

// GET - get screenshot URLs for a trade
export async function GET(req: NextRequest) {
  const tradeId = req.nextUrl.searchParams.get('tradeId');
  if (!tradeId) {
    return NextResponse.json({ error: 'tradeId required' }, { status: 400 });
  }

  const screenshots = readScreenshots();
  const entry = screenshots[tradeId] || {};

  return NextResponse.json({
    screenshots: {
      setup: entry.setup || null,
      result: entry.result || null,
    },
  });
}

// POST - upload a screenshot to Cloudinary
export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const tradeId = formData.get('tradeId') as string;
  const type = formData.get('type') as string;
  const file = formData.get('file') as File;

  if (!tradeId || !type || !file) {
    return NextResponse.json({ error: 'tradeId, type, and file are required' }, { status: 400 });
  }

  if (!['setup', 'result'].includes(type)) {
    return NextResponse.json({ error: 'type must be setup or result' }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = `data:${file.type};base64,${buffer.toString('base64')}`;
    const publicId = getPublicId(tradeId, type as 'setup' | 'result');

    const result = await cloudinary.uploader.upload(base64, {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
      transformation: [
        { width: 1920, crop: 'limit' },
        { quality: 'auto', fetch_format: 'auto' },
      ],
    });

    // Save URL to local JSON
    const screenshots = readScreenshots();
    if (!screenshots[tradeId]) screenshots[tradeId] = {};
    screenshots[tradeId][type as 'setup' | 'result'] = result.secure_url;
    writeScreenshots(screenshots);

    return NextResponse.json({ success: true, url: result.secure_url });
  } catch (error: any) {
    console.error('Cloudinary upload error:', error);
    return NextResponse.json(
      { error: 'Upload failed', message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

// DELETE - remove a screenshot from Cloudinary
export async function DELETE(req: NextRequest) {
  const { tradeId, type } = await req.json();
  if (!tradeId || !type) {
    return NextResponse.json({ error: 'tradeId and type required' }, { status: 400 });
  }

  try {
    const publicId = getPublicId(tradeId, type as 'setup' | 'result');
    await cloudinary.uploader.destroy(publicId);

    // Remove from local JSON
    const screenshots = readScreenshots();
    if (screenshots[tradeId]) {
      delete screenshots[tradeId][type as 'setup' | 'result'];
      if (!screenshots[tradeId].setup && !screenshots[tradeId].result) {
        delete screenshots[tradeId];
      }
      writeScreenshots(screenshots);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Cloudinary delete error:', error);
    return NextResponse.json(
      { error: 'Delete failed', message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
