import type { WordSynonyms, BrushType, PhoneticSection } from '@/types';

/**
 * Checks if a specific synonym matches the given constraints for a word.
 */
export function synonymMatchesConstraints(
  synonym: { text: string; segments: { begin: string[]; mid: string[]; end: string[] } },
  constraints: Record<string, Record<string, BrushType>> // phoneme -> section -> brush
): boolean {
  for (const phoneme in constraints) {
    for (const section in constraints[phoneme]) {
      const brush = constraints[phoneme][section];
      const hasPhoneme = synonym.segments[section as PhoneticSection].includes(phoneme);
      
      if (brush === 'positive' && !hasPhoneme) return false;
      if (brush === 'negative' && hasPhoneme) return false;
    }
  }
  return true;
}

/**
 * Filter word synonyms based on phoneme constraints.
 * @param wordSyns The synonym bank entry for a specific word.
 * @param wordConstraints Map of Phoneme -> Section -> BrushType for this specific word.
 */
export function getValidSynonyms(
  wordSyns: WordSynonyms,
  wordConstraints: Record<string, Record<string, BrushType>>
) {
  return wordSyns.synonyms.filter(syn => synonymMatchesConstraints(syn, wordConstraints));
}

/**
 * Determines if a specific cell (phoneme, section) should be grayed out for a word.
 * A cell is grayed out if NO valid synonym contains that phoneme in that section.
 */
export function isCellGrayedOut(
  phoneme: string,
  section: PhoneticSection,
  wordSyns: WordSynonyms,
  wordConstraints: Record<string, Record<string, BrushType>>
): boolean {
  // We filter synonyms by current constraints (excluding the current cell being evaluated?)
  // Actually, the simplest check: given ALL constraints, does any valid synonym have this phoneme here?
  // If we want to allow constraints to be REMOVED (or added), "grayed out" means "if I click here, 
  // will it result in 0 valid synonyms?". 
  // So we take current constraints, ADD the prospective constraint (positive), and check.
  
  const tempConstraints = JSON.parse(JSON.stringify(wordConstraints));
  if (!tempConstraints[phoneme]) tempConstraints[phoneme] = {};
  tempConstraints[phoneme][section] = 'positive';
  
  const validSyns = getValidSynonyms(wordSyns, tempConstraints);
  return validSyns.length === 0;
}
