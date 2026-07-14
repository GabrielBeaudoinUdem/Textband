import { NextRequest, NextResponse } from 'next/server';

const WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:8000';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const language = formData.get('language') as string || 'english';

    if (!file) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    // Forward to FastAPI Whisper server
    const whisperFormData = new FormData();
    whisperFormData.append('file', file);
    
    const whisperUrl = new URL(`${WHISPER_URL}/transcribe`);
    whisperUrl.searchParams.append('language', language);

    const response = await fetch(whisperUrl.toString(), {
      method: 'POST',
      body: whisperFormData,
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Whisper server error: ${errText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
