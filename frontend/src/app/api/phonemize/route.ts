import { NextRequest, NextResponse } from 'next/server';

const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const { text, language } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'No text provided' }, { status: 400 });
    }

    const response = await fetch(`${WHISPER_URL}/api/phonemize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, language }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error: `Backend error: ${error}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error in phonemize proxy:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
