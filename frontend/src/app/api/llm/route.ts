import { NextResponse } from 'next/server';
type LLMProvider = 'lmstudio' | 'mistral' | 'openai';
const rawProvider = (process.env.LLM_PROVIDER || 'lmstudio').toLowerCase().trim();
const LLM_PROVIDER: LLMProvider = rawProvider === 'local' ? 'lmstudio' : (rawProvider as LLMProvider);

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const LM_STUDIO_URL = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL_LARGE || process.env.LM_STUDIO_MODEL || 'openai/gpt-oss-20b';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-2411';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

const CONFIG = {
  lmstudio: {
    url: LM_STUDIO_URL,
    model: LM_STUDIO_MODEL,
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: MISTRAL_MODEL,
    apiKey: MISTRAL_API_KEY,
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: OPENAI_MODEL,
    apiKey: OPENAI_API_KEY,
  }
};

async function callOpenAICompatible(url: string, apiKey: string | null, payload: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API responded with status ${response.status}: ${errorText}`);
  }

  return response.json();
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { systemPrompt, userPrompt } = body;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    console.log(`Proxying LLM request to ${LLM_PROVIDER}...`);

    const providerConfig = CONFIG[LLM_PROVIDER];
    const payload = {
      model: providerConfig.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
      stream: false,
    };

    const data = await callOpenAICompatible(
      providerConfig.url,
      'apiKey' in providerConfig ? providerConfig.apiKey : null,
      payload
    );

    return NextResponse.json(data);
  } catch (err: any) {
    console.error('LLM Proxy Error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to connect to LLM provider.' },
      { status: 500 }
    );
  }
}
