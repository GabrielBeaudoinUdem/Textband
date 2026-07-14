import phoneticsData from '@/data/phonetics.json';
import type { Language, PhonemeEvent } from '@/types';
import { loadDictionary } from '@/lib/dictionarySearch';

// Quick index map for O(1) lookups
const dictionaryIndexMaps: Record<Language, Map<string, string[]> | null> = {
  en: null,
  fr: null,
};

function phonemizeWordFallback(word: string, language: Language): string[] {
  if (language === 'fr') {
    const frFallback: Record<string, string[]> = {
      'a': ['a'], 'b': ['b'], 'c': ['k'], 'd': ['d'], 'e': ['e'],
      'f': ['f'], 'g': ['ɡ'], 'h': [], 'i': ['i'], 'j': ['ʒ'],
      'k': ['k'], 'l': ['l'], 'm': ['m'], 'n': ['n'], 'o': ['o'],
      'p': ['p'], 'q': ['k'], 'r': ['ʁ'], 's': ['s'], 't': ['t'],
      'u': ['y'], 'v': ['v'], 'w': ['w'], 'x': ['k', 's'], 'y': ['j'],
      'z': ['z'], 'é': ['e'], 'è': ['ɛ'], 'à': ['a'], 'ù': ['y'],
      'ou': ['u'], 'ch': ['ʃ'], 'au': ['o'], 'eau': ['o'], 'ai': ['ɛ'],
      'ei': ['ɛ'], 'eu': ['ø'], 'oi': ['w', 'a'], 'gn': ['ɲ'],
      'an': ['ɑ̃'], 'am': ['ɑ̃'], 'en': ['ɑ̃'], 'em': ['ɑ̃'],
      'in': ['ɛ̃'], 'im': ['ɛ̃'], 'on': ['ɔ̃'], 'om': ['ɔ̃'],
      'un': ['œ̃'], 'um': ['œ̃']
    };
    const phonemes: string[] = [];
    let i = 0;
    while (i < word.length) {
      const three = word.slice(i, i + 3);
      const two = word.slice(i, i + 2);
      const one = word.slice(i, i + 1);
      if (frFallback[three]) {
        phonemes.push(...frFallback[three]);
        i += 3;
      } else if (frFallback[two]) {
        phonemes.push(...frFallback[two]);
        i += 2;
      } else if (frFallback[one]) {
        phonemes.push(...frFallback[one]);
        i += 1;
      } else {
        i += 1;
      }
    }
    return phonemes;
  } else {
    const enFallback: Record<string, string[]> = {
      'a': ['æ'], 'b': ['b'], 'c': ['k'], 'd': ['d'], 'e': ['ɛ'],
      'f': ['f'], 'g': ['ɡ'], 'h': ['h'], 'i': ['ɪ'], 'j': ['dʒ'],
      'k': ['k'], 'l': ['l'], 'm': ['m'], 'n': ['n'], 'o': ['ɑ'],
      'p': ['p'], 'q': ['k'], 'r': ['r'], 's': ['s'], 't': ['t'],
      'u': ['ʌ'], 'v': ['v'], 'w': ['w'], 'x': ['k', 's'], 'y': ['j'],
      'z': ['z'],
      'th': ['θ'], 'sh': ['ʃ'], 'ch': ['tʃ'], 'ng': ['ŋ'], 'ee': ['i'],
      'oo': ['u'], 'ea': ['i'], 'ai': ['eɪ'], 'ay': ['eɪ'], 'ou': ['aʊ'],
      'ow': ['aʊ'], 'oi': ['ɔɪ'], 'oy': ['ɔɪ'], 'or': ['ɔ'], 'ar': ['ɑ'],
      'er': ['ɚ'], 'ir': ['ɚ'], 'ur': ['ɚ']
    };
    const phonemes: string[] = [];
    let i = 0;
    while (i < word.length) {
      const two = word.slice(i, i + 2);
      const one = word.slice(i, i + 1);
      if (enFallback[two]) {
        phonemes.push(...enFallback[two]);
        i += 2;
      } else if (enFallback[one]) {
        phonemes.push(...enFallback[one]);
        i += 1;
      } else {
        i += 1;
      }
    }
    return phonemes;
  }
}

/**
 * Fetch phonemes client-side for a given text.
 */
export async function fetchPhonemes(
  text: string, 
  language: Language
): Promise<{ text: string, phonemes: string[] }[]> {
  try {
    const dict = await loadDictionary(language);
    if (!dictionaryIndexMaps[language]) {
      const map = new Map<string, string[]>();
      for (const entry of dict) {
        map.set(entry.w.toLowerCase().trim(), entry.p);
      }
      dictionaryIndexMaps[language] = map;
    }
    const indexMap = dictionaryIndexMaps[language]!;

    const wordRegex = /[a-zA-Z0-9À-ÿ'-]+/g;
    let match;
    const words: string[] = [];
    while ((match = wordRegex.exec(text)) !== null) {
      words.push(match[0]);
    }

    const wordsData = words.map(w => {
      const lower = w.toLowerCase().trim();
      let phonemes: string[] = [];
      if (indexMap.has(lower)) {
        phonemes = indexMap.get(lower)!;
      } else {
        phonemes = phonemizeWordFallback(lower, language);
      }
      return {
        text: w,
        phonemes
      };
    });

    return wordsData;
  } catch (err) {
    console.error('Client-side phonemize error:', err);
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
