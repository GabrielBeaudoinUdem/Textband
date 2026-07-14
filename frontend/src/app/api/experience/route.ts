import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const PROJECT_ROOT = process.cwd();
const EXPERIENCE_DIR = path.join(PROJECT_ROOT, '..', 'experience');

export const maxDuration = 3600;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { participantId, phraseId, type, content, filename } = body;

    if (!participantId) {
      return NextResponse.json({ error: 'Participant ID is required' }, { status: 400 });
    }

    const baseDir = phraseId
      ? path.join(EXPERIENCE_DIR, participantId, phraseId)
      : path.join(EXPERIENCE_DIR, participantId);

    // Ensure directories exist
    await fs.mkdir(baseDir, { recursive: true });

    switch (type) {
      case 'init':
        return NextResponse.json({ message: 'Directory created' });

      case 'log':
        const logPath = path.join(baseDir, filename || 'interaction_logs.txt');
        await fs.appendFile(logPath, `${new Date().toISOString()} - ${content}\n`);
        return NextResponse.json({ message: 'Logged' });

      case 'final_text':
        const textPath = path.join(baseDir, 'final_text.txt');
        await fs.writeFile(textPath, content);
        return NextResponse.json({ message: 'Final text saved' });

      default:
        return NextResponse.json({ error: 'Invalid log type' }, { status: 400 });
    }
  } catch (err: any) {
    console.error('Experience API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}


