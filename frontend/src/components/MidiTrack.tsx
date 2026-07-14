'use client';

import React from 'react';
import { Play, Pause } from 'lucide-react';
import type { PhonemeEvent, BrushType, PhoneticSection } from '@/types';
import { LABEL_COLOR_SELECTED, LABEL_COLOR_HOVER } from '@/lib/phonemeColors';

interface MidiTrackProps {
  phoneme: string;
  events: PhonemeEvent[];
  /** Total width of all blocks combined (in pixels) */
  totalWidth: number;
  /** Positioning metrics for grid lines */
  blocksMetrics: { id: string; leftPx: number; widthPx: number; words: { text: string; leftPx: number; widthPx: number; wIdx: number }[] }[];
  /** Current constraints for this phoneme lane */
  constraints?: Record<string, Record<string, BrushType>>; // wordKey -> section -> brush
  /** Set of cell keys to gray out: "wordKey-section" */
  grayedOutCells?: Set<string>;
  onToggleNote: (phoneme: string, wordKey: string, section: PhoneticSection, brush: BrushType) => void;
  onAuditionTrack?: (phoneme: string, events: PhonemeEvent[]) => void;
  isVowel?: boolean;
  wordBoundaries?: number[];
  isPlaying?: boolean;
  playingPhoneme?: string | null;
  isReadOnly?: boolean;
  onLabelClick?: (phoneme: string) => void;
  isSelectedPhoneme?: boolean;
  isHoveredPhoneme?: boolean;
  onLabelRightClick?: (phoneme: string) => void;
  onLabelHover?: (phoneme: string | null) => void;
}

export default function MidiTrack({
  phoneme,
  events,
  totalWidth,
  blocksMetrics,
  constraints = {},
  grayedOutCells = new Set(),
  onToggleNote,
  onAuditionTrack,
  isVowel,
  wordBoundaries,
  isPlaying,
  playingPhoneme,
  isReadOnly,
  onLabelClick,
  isSelectedPhoneme,
  isHoveredPhoneme,
  onLabelRightClick,
  onLabelHover,
}: MidiTrackProps) {

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only capture left click (0) and right click (2)
    if (e.button !== 0 && e.button !== 2) return;

    // Prevent default right-click to block context menu from firing at pointer level
    if (e.button === 2) {
      e.stopPropagation();
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    // Find which word and which section was clicked
    for (const bm of blocksMetrics) {
      for (let wIdx = 0; wIdx < bm.words.length; wIdx++) {
        const word = bm.words[wIdx];
        if (x >= word.leftPx && x < word.leftPx + word.widthPx) {
          const relativeX = x - word.leftPx;
          const sectionWidth = word.widthPx / 3;
          const sectionOffset = Math.floor(relativeX / sectionWidth);
          const sections: PhoneticSection[] = ['begin', 'mid', 'end'];
          const section = sections[Math.min(2, sectionOffset)];
          const wordKey = `${bm.id}:${word.wIdx}`;

          // Block clicks on grayed-out cells (Req 5)
          const cellKey = `${phoneme}-${wordKey}-${section}`;
          if (grayedOutCells.has(cellKey)) return;
          
          const brush: BrushType = e.button === 0 ? 'positive' : 'negative';
          onToggleNote(phoneme, wordKey, section, brush);
          return;
        }
      }
    }
  };

  return (
    <div className={`midi-lane ${isVowel ? 'is-vowel' : ''}`}>
      <div 
        className={`midi-lane__label ${isSelectedPhoneme ? 'is-label-selected' : ''} ${isHoveredPhoneme && !isSelectedPhoneme ? 'is-label-hovered' : ''}`}
        title={phoneme}
        onClick={() => onLabelClick?.(phoneme)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onLabelRightClick?.(phoneme); }}
        onMouseEnter={() => onLabelHover?.(phoneme)}
        onMouseLeave={() => onLabelHover?.(null)}
        style={{ 
          cursor: 'pointer', 
          ...(isSelectedPhoneme ? { backgroundColor: LABEL_COLOR_SELECTED, color: '#fff' } : {}),
          ...(!isSelectedPhoneme && isHoveredPhoneme ? { backgroundColor: LABEL_COLOR_HOVER } : {}),
        }}
      >
        <span style={{ flex: 1, textAlign: 'center' }}>{phoneme}</span>
        {onAuditionTrack && (
          <button 
            className="btn btn--icon-ghost" 
            style={{ padding: '2px', position: 'absolute', right: '4px', opacity: 0.6 }}
            onClick={(e) => { e.stopPropagation(); onAuditionTrack(phoneme, events); }}
            title={isPlaying && playingPhoneme === phoneme ? `Pause ${phoneme}` : `Audition ${phoneme}`}
          >
            {isPlaying && playingPhoneme === phoneme ? (
              <Pause size={10} fill="currentColor" />
            ) : (
              <Play size={10} fill="currentColor" />
            )}
          </button>
        )}
      </div>
      <div
        className="midi-lane__notes"
        style={{ 
          minWidth: totalWidth, 
          cursor: isReadOnly ? 'default' : 'cell',
          touchAction: 'none'
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        onPointerDown={isReadOnly ? undefined : handlePointerDown}
      >
        {blocksMetrics.map((bm) => (
          <div
            key={bm.id}
            className="midi-grid-block"
            style={{ left: bm.leftPx, width: bm.widthPx }}
          >
            {!/^[.,;!?\s]+$/.test(phoneme) && bm.words.map((word, _idx) => {
              const wordKey = `${bm.id}:${word.wIdx}`;
              const wordConstraints = constraints[wordKey] || {};
              
              const isPunct = /^[.,;!?\s]+$/.test(word.text);
              const isPeriod = word.text.includes('.');
              const isComma = word.text.includes(',');
              
              return (
                <div 
                  key={word.wIdx} 
                  className="midi-grid-word"
                  style={{ position: 'absolute', left: word.leftPx - bm.leftPx, width: word.widthPx, height: '100%' }}
                >
                  {(['begin', 'mid', 'end'] as PhoneticSection[]).map((section, sIdx) => {
                    const brush = wordConstraints[section];
                    // Form the key correctly: phoneme-wordKey-section
                    const cellKey = `${phoneme}-${wordKey}-${section}`;
                    const isGrayed = grayedOutCells.has(cellKey);
                    const sectionWidth = word.widthPx / 3;
                    
                    return (
                      <div
                        key={section}
                        className={`midi-grid-section ${brush ? `is-${brush}` : ''} ${isGrayed ? 'is-grayed' : ''} ${isPunct ? 'is-punctuation' : ''} ${isPeriod ? 'is-period' : ''} ${isComma ? 'is-comma' : ''}`}
                        style={{
                          position: 'absolute',
                          left: sIdx * sectionWidth,
                          width: sectionWidth,
                          height: '100%'
                        }}
                        title={isGrayed ? `${phoneme} unavailable here` : `${phoneme} - ${section}`}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}

        {wordBoundaries?.map((x, i) => (
          <div key={i} className="word-marker" style={{ left: x }} />
        ))}

        {events.map((evt, idx) => {
          const left = evt.startPx ?? 0;
          const width = Math.max(2, (evt.endPx ?? 0) - left);
          return (
            <div
              key={`${evt.blockId || 'manual'}-${idx}`}
              className={`midi-note ${evt.constraintType === 'negative' ? 'is-negative' : evt.constraintType === 'positive' ? 'is-positive' : ''}`}
              style={{
                left,
                width,
                pointerEvents: 'none',
                opacity: 0.5, // Make original notes more subtle to highlight constraints
              }}
              title={`${evt.phoneme}`}
            />
          );
        })}
      </div>
    </div>
  );
}
