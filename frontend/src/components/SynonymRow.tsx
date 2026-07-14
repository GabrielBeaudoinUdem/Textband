'use client';

import React, { useMemo } from 'react';
import type { TextBlock, BrushType, PhoneticSection, WordSynonyms } from '@/types';
import { PX_PER_CHAR, GAP_X } from '@/lib/constants';
import { getValidSynonyms } from '@/lib/synonymLogic';

interface SynonymRowProps {
  blocks: TextBlock[];
  midiOverrides?: Record<string, Record<string, Record<string, BrushType>>>;
  onSelectSynonym: (blockId: string, wIdx: number, newWord: string) => void;
  isReadOnly?: boolean;
}

const SynonymRow = React.memo(function SynonymRow({
  blocks,
  midiOverrides = {},
  onSelectSynonym,
  isReadOnly,
}: SynonymRowProps) {

  const wordDropdowns = useMemo(() => {
    const dropdowns: {
      blockId: string;
      wIdx: number;
      original: string;
      current: string;
      leftPx: number;
      widthPx: number;
      validSynonyms: { text: string }[];
      totalSynonyms: number;
    }[] = [];

    let currentPixelOffset = 0;

    for (const block of blocks) {
      if (block.synonymBank) {
        let charIdx = 0;
        for (let wIdx = 0; wIdx < block.synonymBank.length; wIdx++) {
          const wordSyns = block.synonymBank[wIdx];
          // Skip punctuation
          if (/^[.,;!?\s]+$/.test(wordSyns.original)) continue;

          const currentWordToSearch = wordSyns.currentText || wordSyns.original;
          const searchPart = block.text.toLowerCase().slice(charIdx);
          const wordStartInPart = searchPart.indexOf(currentWordToSearch.toLowerCase());

          if (wordStartInPart !== -1) {
            const wordStart = charIdx + wordStartInPart;
            const wordLen = currentWordToSearch.length;

            // Compute constraints for this word
            const wordKey = `${block.id}:${wIdx}`;
            const wordConstraints: Record<string, Record<string, BrushType>> = {};
            for (const ph in midiOverrides) {
              if (midiOverrides[ph]?.[wordKey]) {
                wordConstraints[ph] = midiOverrides[ph][wordKey];
              }
            }

            const hasConstraints = Object.keys(wordConstraints).length > 0;
            const validSyns = hasConstraints
              ? getValidSynonyms(wordSyns, wordConstraints)
              : wordSyns.synonyms;

            dropdowns.push({
              blockId: block.id,
              wIdx,
              original: wordSyns.original,
              current: currentWordToSearch,
              leftPx: currentPixelOffset + (wordStart * PX_PER_CHAR),
              widthPx: wordLen * PX_PER_CHAR,
              validSynonyms: validSyns,
              totalSynonyms: wordSyns.synonyms.length,
            });

            charIdx = wordStart + wordLen;
          }
        }
      }

      currentPixelOffset += block.width + GAP_X;
    }

    return dropdowns;
  }, [blocks, midiOverrides]);

  if (wordDropdowns.length === 0) return null;

  return (
    <div className="synonym-row">
      <div className="synonym-row__label">
        SYN
      </div>
      <div className="synonym-row__content" style={{ position: 'relative', minHeight: 28 }}>
        {wordDropdowns.map((wd) => (
          <div
            key={`${wd.blockId}:${wd.wIdx}`}
            className="synonym-row__dropdown-wrapper"
            style={{
              position: 'absolute',
              left: wd.leftPx,
              width: Math.max(wd.widthPx, 60),
            }}
          >
            <select
              className="synonym-row__select"
              value={wd.current.toLowerCase()}
              disabled={isReadOnly}
              onChange={(e) => {
                if (e.target.value !== wd.current.toLowerCase()) {
                  onSelectSynonym(wd.blockId, wd.wIdx, e.target.value);
                }
              }}
              title={`${wd.validSynonyms.length}/${wd.totalSynonyms} synonyms available`}
            >
              {wd.validSynonyms.map((syn, i) => (
                <option key={`${syn.text}-${i}`} value={syn.text.toLowerCase()}>
                  {syn.text}
                </option>
              ))}
              {wd.validSynonyms.length === 0 && (
                <option value={wd.original.toLowerCase()} disabled>
                  ∅
                </option>
              )}
            </select>
            <span className="synonym-row__count">
              {wd.validSynonyms.length}/{wd.totalSynonyms}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default SynonymRow;
