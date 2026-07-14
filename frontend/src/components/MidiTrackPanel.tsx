'use client';

import React, { useMemo } from 'react';
import type { TextBlock, Language, MidiLane, PhonemeEvent, BrushType, PhoneticSection, PhonemeSortMode } from '@/types';
import { textToPhonemes, getPhonemeOrder, isVowel } from '@/lib/phonemizer';
import { buildMidiLanes } from '@/lib/midiBuilder';
import { PX_PER_CHAR, GAP_X } from '@/lib/constants';
import MidiTrack from './MidiTrack';
import phoneticsData from '@/data/phonetics.json';
import { isCellGrayedOut } from '@/lib/synonymLogic';

interface MidiTrackPanelProps {
  blocks: TextBlock[];
  language: Language;
  midiOverrides?: Record<string, Record<string, Record<string, BrushType>>>;
  onToggleNote: (phoneme: string, wordKey: string, section: PhoneticSection, brush: BrushType) => void;
  onAuditionTrack?: (phoneme: string, events: PhonemeEvent[]) => void;
  isPlaying?: boolean;
  playingPhoneme?: string | null;
  isReadOnly?: boolean;
  sortMode: PhonemeSortMode;
  selectedPhonemes?: Set<string>;
  hoveredPhoneme?: string | null;
  onLabelRightClick?: (phoneme: string) => void;
  onLabelHover?: (phoneme: string | null) => void;
}

const MidiTrackPanel = React.memo(function MidiTrackPanel({
  blocks,
  language,
  midiOverrides = {},
  onToggleNote,
  onAuditionTrack,
  isPlaying,
  playingPhoneme,
  isReadOnly,
  sortMode,
  selectedPhonemes,
  hoveredPhoneme,
  onLabelRightClick,
  onLabelHover,
}: MidiTrackPanelProps) {

  const { lanes, totalWidth, blocksMetrics, wordBoundaries, grayedOutCells } = useMemo(() => {
    let allEvents: any[] = [];
    let currentPixelOffset = 0;
    const metrics: { id: string; leftPx: number; widthPx: number; words: { text: string; leftPx: number; widthPx: number; wIdx: number }[] }[] = [];
    const grayedSet = new Set<string>();

    for (const block of blocks) {
      const wordsData: { text: string; leftPx: number; widthPx: number; wIdx: number }[] = [];
      if (block.synonymBank) {
        let charIdx = 0;
        for (let wIdx = 0; wIdx < block.synonymBank.length; wIdx++) {
          const wordSyns = block.synonymBank[wIdx];
          const currentWordToSearch = wordSyns.currentText || wordSyns.original;
          const searchPart = block.text.toLowerCase().slice(charIdx);
          const wordStartInPart = searchPart.indexOf(currentWordToSearch.toLowerCase());
          
          if (wordStartInPart !== -1) {
            const wordStart = charIdx + wordStartInPart;
            let wordLen = currentWordToSearch.length;
            
            if (/^[.,;!?\s]+$/.test(currentWordToSearch)) {
              while (wordStart + wordLen < block.text.length && block.text[wordStart + wordLen] === ' ') {
                wordLen++;
              }
            }
            
            wordsData.push({
              text: currentWordToSearch,
              leftPx: currentPixelOffset + (wordStart * PX_PER_CHAR),
              widthPx: wordLen * PX_PER_CHAR,
              wIdx: wIdx
            });
            charIdx = wordStart + wordLen;
          }
        }
      }

      const blockWidth = block.width;
      metrics.push({
        id: block.id,
        leftPx: currentPixelOffset,
        widthPx: blockWidth,
        words: wordsData,
      });

      const events = textToPhonemes(block.text, language, block.id, block.phonemes);
      const offsetEvents = events.map((e) => {
        return {
          ...e,
          startPx: currentPixelOffset + e.startChar * PX_PER_CHAR,
          endPx: currentPixelOffset + e.endChar * PX_PER_CHAR,
        };
      });
      allEvents.push(...offsetEvents);

      if (block.synonymBank) {
        const phonemeOrder = getPhonemeOrder(language);
        block.synonymBank.forEach((wordSyns, wIdx) => {
          const wordKey = `${block.id}:${wIdx}`;
          const currentWord = wordSyns.currentText || wordSyns.original;
          const isPunct = /^[.,;!?\s]+$/.test(currentWord);
          const wordConstraints: Record<string, Record<string, BrushType>> = {};
          
          for (const ph in midiOverrides) {
            if (midiOverrides[ph][wordKey]) {
              wordConstraints[ph] = midiOverrides[ph][wordKey];
            }
          }

          phonemeOrder.forEach(ph => {
            (['begin', 'mid', 'end'] as PhoneticSection[]).forEach(section => {
              if (isPunct || (!isReadOnly && isCellGrayedOut(ph, section, wordSyns, wordConstraints))) {
                grayedSet.add(`${ph}-${wordKey}-${section}`);
              }
            });
          });
        });
      }

      currentPixelOffset += blockWidth + GAP_X;
    }

    const rawLanes = buildMidiLanes(allEvents, language);
    let finalLanes = [...rawLanes];

    if (sortMode === 'popularity-text') {
      const counts: Record<string, number> = {};
      allEvents.forEach(e => {
        counts[e.phoneme] = (counts[e.phoneme] || 0) + 1;
      });
      finalLanes.sort((a, b) => (counts[b.phoneme] || 0) - (counts[a.phoneme] || 0));
    } else if (sortMode === 'popularity-lang') {
      const langOrder = getPhonemeOrder(language);
      finalLanes.sort((a, b) => langOrder.indexOf(a.phoneme) - langOrder.indexOf(b.phoneme));
    } else if (sortMode === 'selected' && selectedPhonemes && selectedPhonemes.size > 0) {
      finalLanes.sort((a, b) => {
        const aSelected = selectedPhonemes.has(a.phoneme) ? 0 : 1;
        const bSelected = selectedPhonemes.has(b.phoneme) ? 0 : 1;
        return aSelected - bSelected;
      });
    }

    const wordBoundaries: number[] = [];
    metrics.forEach(bm => {
      if (bm.words.length === 0) return;
      wordBoundaries.push(bm.words[0].leftPx);
      for (let i = 0; i < bm.words.length - 1; i++) {
        const currEnd = bm.words[i].leftPx + bm.words[i].widthPx;
        const nextStart = bm.words[i+1].leftPx;
        wordBoundaries.push((currEnd + nextStart) / 2);
      }
      const lastWord = bm.words[bm.words.length - 1];
      wordBoundaries.push(lastWord.leftPx + lastWord.widthPx);
    });

    const finalWidth = Math.max(currentPixelOffset + 500, 10000);

    return { lanes: finalLanes, totalWidth: finalWidth, blocksMetrics: metrics, wordBoundaries, grayedOutCells: grayedSet };
  }, [blocks, language, midiOverrides, sortMode, isReadOnly, selectedPhonemes]);

  const handleToggleNoteWithSound = (phoneme: string, wordKey: string, section: PhoneticSection, brush: BrushType) => {
    const currentOverride = midiOverrides[phoneme]?.[wordKey]?.[section];
    if (brush === 'positive' && currentOverride !== 'positive') {
      const soundPath = (phoneticsData as any)[language]?.sounds?.[phoneme];
      if (soundPath) {
        new Audio(soundPath).play().catch(() => {});
      }
    }
    onToggleNote(phoneme, wordKey, section, brush);
  };
  
  const handleLabelClick = (phoneme: string) => {
    const soundPath = (phoneticsData as any)[language]?.sounds?.[phoneme];
    if (soundPath) {
      new Audio(soundPath).play().catch(() => {});
    }
  };

  return (
    <div className="midi-panel">
      {lanes.map((lane, idx) => {
        const isV = isVowel(lane.phoneme, language);
        const prevIsVowel = idx > 0 ? isVowel(lanes[idx - 1].phoneme, language) : isV;
        const isFirstOfGroup = idx > 0 && isV !== prevIsVowel;

        return (
          <React.Fragment key={lane.phoneme}>
            {isFirstOfGroup && sortMode === 'default' && <div className="midi-group-separator" />}
            <MidiTrack
              phoneme={lane.phoneme}
              events={lane.events}
              isVowel={isV}
              totalWidth={totalWidth}
              blocksMetrics={blocksMetrics}
              wordBoundaries={wordBoundaries}
              onToggleNote={handleToggleNoteWithSound}
              onAuditionTrack={onAuditionTrack}
              onLabelClick={handleLabelClick}
              constraints={midiOverrides[lane.phoneme] || {}}
              grayedOutCells={grayedOutCells}
              isPlaying={isPlaying}
              playingPhoneme={playingPhoneme}
              isReadOnly={isReadOnly}
              isSelectedPhoneme={selectedPhonemes?.has(lane.phoneme) ?? false}
              isHoveredPhoneme={hoveredPhoneme === lane.phoneme}
              onLabelRightClick={onLabelRightClick}
              onLabelHover={onLabelHover}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
});

export default MidiTrackPanel;
