import type { Language } from '@/types';
import { normalizePhoneme, getPhonemeWeight, mapPhonemeToSlots } from '@/lib/phonemizer';

export interface DictWord {
  w: string;
  p: string[];
}

// Caches for the dictionaries
const dictCaches: Record<Language, DictWord[] | null> = {
  en: null,
  fr: null,
};

/**
 * Loads the dictionary for a specific language into the cache if not already loaded.
 */
export async function loadDictionary(language: Language): Promise<DictWord[]> {
  if (dictCaches[language]) {
    return dictCaches[language]!;
  }

  try {
    const isProd = process.env.NODE_ENV === 'production';
    const basePath = isProd ? '/Textband' : '';
    const res = await fetch(`${basePath}/dictionaries/${language}.json`);
    if (!res.ok) throw new Error(`Failed to load ${language} dictionary`);
    const data: DictWord[] = await res.json();
    dictCaches[language] = data;
    return data;
  } catch (err) {
    console.error('Error loading dictionary:', err);
    return [];
  }
}

export type CharOverride = 'positive' | 'negative' | undefined;

/**
 * Scores dictionary words against phoneme constraints.
 * Uses the shared `mapPhonemeToSlots` helper for consistent position arithmetic.
 *
 * Score === 0  → word perfectly satisfies all constraints.
 * Score  > 0  → word violates at least one constraint (positive missed or negative hit).
 */
function _getScoreSortedWords(
  language: Language,
  widthChars: number,
  midiOverrides: Record<string, Record<number, CharOverride>>,
): { word: DictWord; score: number }[] {
  const dict = dictCaches[language];
  if (!dict || dict.length === 0) return [];

  const scoredWords: { word: DictWord; score: number }[] = [];

  for (const entry of dict) {
    // Use the shared helper — same formula as phonemizer.ts textToPhonemes
    const phonemeSlots = mapPhonemeToSlots(entry.p, widthChars);

    let score = 0;
    for (const ph in midiOverrides) {
      const laneOverrides = midiOverrides[ph];
      for (const charIdxStr in laneOverrides) {
        const charIdx = parseInt(charIdxStr, 10);
        if (charIdx >= widthChars) continue;

        const constraint = laneOverrides[charIdx];
        const slotPhonemes = phonemeSlots[charIdx] || [];

        if (constraint === 'positive') {
          // Positive constraint violated: this phoneme is not here
          if (!slotPhonemes.includes(ph)) score += 2;
        } else if (constraint === 'negative') {
          // Negative constraint violated: this phoneme IS here but shouldn't be
          if (slotPhonemes.includes(ph)) score += 5;
        }
      }
    }
    scoredWords.push({ word: entry, score });
  }

  scoredWords.sort((a, b) => a.score - b.score);
  return scoredWords;
}

/**
 * Returns dictionary words (or 2-word phrases) that satisfy the given constraints.
 *
 * Strict threshold: only words with score === 0 (perfect match) are returned.
 * If no perfect match exists, we fall back to the best-scoring imperfect words
 * so the UI doesn't go completely dark when no perfect solution exists yet.
 */
export function getValidDictionaryWords(
  language: Language,
  widthChars: number,
  midiOverrides: Record<string, Record<number, CharOverride>>,
): DictWord[] {
  // No constraints → nothing to score, skip the expensive iteration entirely
  if (Object.keys(midiOverrides).length === 0) return [];

  // 1. Get single words
  const singles = _getScoreSortedWords(language, widthChars, midiOverrides);
  const combined = [...singles];

  // 2. Phrase Generation (Split and Conquer) — only for wider blocks
  if (widthChars >= 5) {
    for (let k = 2; k <= widthChars - 2; k++) {
      const leftOverrides: Record<string, Record<number, CharOverride>> = {};
      const rightOverrides: Record<string, Record<number, CharOverride>> = {};

      for (const ph in midiOverrides) {
        for (const idxStr in midiOverrides[ph]) {
          const idx = parseInt(idxStr, 10);
          if (idx < k) {
            if (!leftOverrides[ph]) leftOverrides[ph] = {};
            leftOverrides[ph][idx] = midiOverrides[ph][idxStr];
          } else {
            if (!rightOverrides[ph]) rightOverrides[ph] = {};
            rightOverrides[ph][idx - k] = midiOverrides[ph][idxStr];
          }
        }
      }

      const leftWords = _getScoreSortedWords(language, k, leftOverrides).slice(0, 3);
      const rightWords = _getScoreSortedWords(language, widthChars - k, rightOverrides).slice(0, 3);

      for (const lw of leftWords) {
        for (const rw of rightWords) {
          combined.push({
            word: { w: lw.word.w + ' ' + rw.word.w, p: [...lw.word.p, ...rw.word.p] },
            score: lw.score + rw.score,
          });
        }
      }
    }
  }

  // 3. Sort overall
  combined.sort((a, b) => a.score - b.score);

  // 4. ── STRICT THRESHOLD ──
  //    Prefer only perfectly-matching words (score === 0).
  //    If none exist, fall back to the best imperfect ones so the UI
  //    doesn't go completely dark (user still sees *some* options).
  const perfectMatches = combined.filter(c => c.score === 0);
  const pool = perfectMatches.length > 0 ? perfectMatches : combined;

  const uniqueWords: DictWord[] = [];
  const seen = new Set<string>();
  for (const c of pool) {
    if (!seen.has(c.word.w)) {
      seen.add(c.word.w);
      uniqueWords.push(c.word);
      if (uniqueWords.length >= 20) break;
    }
  }

  return uniqueWords;
}

/**
 * Returns a set of active (un-grayed) MIDI cells based on valid dictionary words.
 * Uses the shared mapPhonemeToSlots helper for consistent position math.
 * Key format: `${phoneme}-${charIndex}`
 */
export function getAvailableMidiCells(
  language: Language,
  widthChars: number,
  validWords: DictWord[]
): Set<string> {
  const availableSet = new Set<string>();

  for (const entry of validWords) {
    // Use shared helper — exact same formula as _getScoreSortedWords
    const slots = mapPhonemeToSlots(entry.p, widthChars);
    for (let j = 0; j < widthChars; j++) {
      for (const ph of (slots[j] || [])) {
        availableSet.add(`${ph}-${j}`);
      }
    }
  }

  return availableSet;
}

/**
 * Checks if a word exists in the dictionary cache for a language.
 */
export function isWordInDictionary(
  word: string,
  language: Language,
): boolean {
  const dict = dictCaches[language];
  if (!dict) return false;
  const lowerWord = word.toLowerCase().trim();
  return dict.some(d => d.w.toLowerCase() === lowerWord);
}

/**
 * Checks if a word contains any of the forbidden phonemes.
 * Looks the word up in the dictionary cache; if found, checks its phoneme list.
 * If the word is NOT in the dictionary, returns true (reject it) — we can't
 * verify it, so we don't trust it.
 */
export function wordContainsForbiddenPhoneme(
  word: string,
  forbiddenPhonemes: string[],
  language: Language,
): boolean {
  const dict = dictCaches[language];
  if (!dict) return true; // Can't check, reject to be safe

  const lowerWord = word.toLowerCase().trim();
  const entry = dict.find(d => d.w.toLowerCase() === lowerWord);

  if (entry) {
    const wordPhonemes = entry.p.map(p => normalizePhoneme(p));
    return forbiddenPhonemes.some(fp => wordPhonemes.includes(fp));
  }

  // Word not in dictionary — reject it (can't verify)
  return true;
}

