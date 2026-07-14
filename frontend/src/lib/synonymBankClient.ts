import { fetchPhonemes } from './phonemizer';
import type { Language } from '@/types';
import localSynonymCacheRaw from '@/data/synonym_cache.json';

const localSynonymCache = localSynonymCacheRaw as unknown as Record<string, Record<string, string[]>>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function splitPhonemes(phonemes: string[]): { begin: string[]; mid: string[]; end: string[] } {
  const n = phonemes.length;
  if (n === 0) {
    return { begin: [], mid: [], end: [] };
  }
  if (n === 1) {
    return { begin: [phonemes[0]], mid: [], end: [phonemes[0]] };
  }
  return {
    begin: [phonemes[0]],
    mid: phonemes.slice(1, -1),
    end: [phonemes[n - 1]]
  };
}

async function fetchMistralSynonyms(
  sentence: string,
  word: string,
  language: Language,
  apiKey: string,
  retries = 3
): Promise<string[]> {
  try {
    const prompt = `In ${language === 'fr' ? 'French' : 'English'}, list up to 30 single-word synonyms that could replace "${word}" in: "${sentence}". Each replacement must be exactly ONE word. Return ONLY a comma-separated list. No preamble.`;

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'mistral-large-latest',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.5,
        max_tokens: 200
      })
    });

    if (response.status === 429 && retries > 0) {
      console.warn(`Rate limit hit for word "${word}". Retrying in 2 seconds...`);
      await sleep(2000);
      return fetchMistralSynonyms(sentence, word, language, apiKey, retries - 1);
    }

    if (!response.ok) {
      throw new Error(`Mistral API returned status ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Clean potential reasoning tags if present
    const cleanedContent = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    const synonyms = cleanedContent
      .split(',')
      .map((s: string) => s.trim().replace(/"/g, ''))
      .filter((s: string) => s.length > 0 && !s.includes(' '));

    return synonyms;
  } catch (err) {
    console.error(`Mistral synonym generation failed for word "${word}":`, err);
    throw err;
  }
}

export async function fetchSynonymBank(
  text: string,
  language: Language,
  mistralApiKey?: string
): Promise<{
  original: string;
  synonyms: {
    text: string;
    segments: { begin: string[]; mid: string[]; end: string[] };
  }[];
}[]> {
  const wordRegex = /[a-zA-Z0-9À-ÿ'-]+/g;
  let match;
  const originalWords: string[] = [];
  while ((match = wordRegex.exec(text)) !== null) {
    originalWords.push(match[0]);
  }

  const bank = [];

  for (const word of originalWords) {
    const wordKey = word.toLowerCase().trim();
    let syns: string[] = [];

    // 1. Check local pre-populated cache
    const langCache = localSynonymCache[language];
    if (langCache && langCache[wordKey]) {
      syns = langCache[wordKey];
    } else if (mistralApiKey) {
      // 2. Fallback to direct Mistral API call with 1100ms delay to avoid rate limits (1 req/sec)
      await sleep(1100);
      syns = await fetchMistralSynonyms(text, word, language, mistralApiKey);
    }

    // Keep unique synonyms, preserving order, and limit to 30
    const seen = new Set<string>();
    const uniqueSyns: string[] = [word]; // Original word is always first
    seen.add(wordKey);

    for (const s of syns) {
      const sKey = s.toLowerCase().trim();
      if (!seen.has(sKey)) {
        uniqueSyns.push(s);
        seen.add(sKey);
      }
    }

    const synData = [];
    for (const sText of uniqueSyns) {
      // Phonemize the synonym
      const phonemesData = await fetchPhonemes(sText, language);
      const sPhonemes = phonemesData.flatMap(wd => wd.phonemes);

      synData.push({
        text: sText,
        segments: splitPhonemes(sPhonemes)
      });
    }

    bank.push({
      original: word,
      synonyms: synData
    });
  }

  return bank;
}
