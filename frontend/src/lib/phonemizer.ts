import phoneticsData from '@/data/phonetics.json';
import type { Language, PhonemeEvent } from '@/types';

/**
 * Fetch phonemes from the backend for a given text.
 */
export async function fetchPhonemes(
  text: string, 
  language: Language
): Promise<{ text: string, phonemes: string[] }[]> {
  try {
    const res = await fetch('/api/phonemize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
    });
    const data = await res.json();
    return data.words || [];
  } catch (err) {
    console.error('Phonemize fetch error:', err);
    return [];
  }
}

/**
 * Normalize a phoneme from backend to match phonetics.json.
 */
export function normalizePhoneme(ph: string): string {
  // Strip stress markers and vowel length markers
  let normalized = ph.replace(/[ˈˌː]/g, '');
  
  // Character mapping for common IPA variants to match phonetics.json
  const maps: Record<string, string> = {
    'ɹ': 'r',
    'g': 'ɡ', // Map standard g to IPA ɡ used in phonetics.json
  };
  
  if (maps[normalized]) return maps[normalized];
  return normalized;
}

/**
 * Get the heuristic character weight for a phoneme.
 * Diphthongs and multi-character consonants consume more characters.
 */
export function getPhonemeWeight(ph: string): number {
  const norm = normalizePhoneme(ph);
  if (['aɪ', 'aʊ', 'ɔɪ', 'eɪ', 'oʊ', 'aɪə', 'aʊə'].includes(norm)) return 2.2;
  if (['ʃ', 'tʃ', 'θ', 'ð', 'dʒ', 'ŋ', 'hw'].includes(norm)) return 1.8;
  if (['ɛ̃', 'ɑ̃', 'ɔ̃', 'œ̃'].includes(norm)) return 1.6;
  if (ph.includes('ː')) return 1.5;
  return 1.0;
}

/**
 * Shared helper: maps a list of phonemes over `widthChars` character slots
 * using weighted proportional distribution (same formula used everywhere).
 * Returns a Record<slotIndex, phoneme[]> so both the visualizer and
 * the dictionary search use *identical* position arithmetic.
 */
export function mapPhonemeToSlots(
  phonemes: string[],
  widthChars: number,
): Record<number, string[]> {
  const slots: Record<number, string[]> = {};
  for (let c = 0; c < widthChars; c++) slots[c] = [];

  const weights = phonemes.map(ph => getPhonemeWeight(ph));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let offset = 0;

  for (let i = 0; i < phonemes.length; i++) {
    const ph = normalizePhoneme(phonemes[i]);
    const share = weights[i] / totalWeight;
    const phLen = share * widthChars;
    const startChar = offset;
    const endChar = i === phonemes.length - 1 ? widthChars : offset + phLen;
    const intStart = Math.floor(startChar);
    const intEnd = Math.max(intStart + 1, Math.ceil(endChar));
    for (let j = intStart; j < intEnd && j < widthChars; j++) {
      slots[j].push(ph);
    }
    offset += phLen;
  }
  return slots;
}

/**
 * Map text to phoneme events with weighted character distribution.
 */
export function textToPhonemes(
  text: string,
  language: Language,
  blockId: string,
  providedPhonemes?: { text: string, phonemes: string[] }[]
): PhonemeEvent[] {
  const langData = phoneticsData[language];
  const order = langData.order;
  const events: PhonemeEvent[] = [];

  // If no phonemes provided, we can't do anything synchronous anymore.
  if (!providedPhonemes || providedPhonemes.length === 0) {
    return [];
  }

  let charIdx = 0;

  for (const wordData of providedPhonemes) {
    // Find the word in the text to keep track of spacing
    // We search from current charIdx to avoid repeating words
    const searchPart = text.toLowerCase().slice(charIdx);
    const wordStartInPart = searchPart.indexOf(wordData.text.toLowerCase());
    
    if (wordStartInPart === -1) {
      // If word not found (punctuation etc), skip it visually or handle gracefully
      continue;
    }
    
    const wordStart = charIdx + wordStartInPart;
    charIdx = wordStart;
    const phonemes = wordData.phonemes;
    const wordLen = wordData.text.length;
    
    // Weighted distribution optimization
    const phonemeWeights = phonemes.map(ph => getPhonemeWeight(ph));

    const totalWeight = phonemeWeights.reduce((a, b) => a + b, 0);
    let currentWordCharOffset = 0;

    for (let i = 0; i < phonemes.length; i++) {
      const ph = normalizePhoneme(phonemes[i]);
      const row = order.indexOf(ph);
      
      const weightShare = phonemeWeights[i] / totalWeight;
      const phCharLen = weightShare * wordLen;

      if (row !== -1) {
        // Use floats for start/end to avoid cumulative rounding drift
        const startChar = charIdx + currentWordCharOffset;
        const endChar = (i === phonemes.length - 1) 
          ? charIdx + wordLen 
          : charIdx + currentWordCharOffset + phCharLen;
        
        events.push({
          phoneme: ph,
          startChar,
          endChar,
          textStr: text.substring(Math.floor(startChar), Math.ceil(endChar)),
          row,
          blockId,
        });
      }

      currentWordCharOffset += phCharLen;
    }

    charIdx += wordLen;
  }

  return events;
}

/**
 * Get the full ordered phoneme list for a language.
 */
export function getPhonemeOrder(language: Language): string[] {
  return phoneticsData[language].order;
}

/**
 * Get the language label.
 */
export function getLanguageLabel(language: Language): string {
  return phoneticsData[language].label;
}

/**
 * Check if a phoneme is a vowel in the given language.
 */
export function isVowel(phoneme: string, language: Language): boolean {
  return phoneticsData[language].vowels.includes(phoneme);
}
