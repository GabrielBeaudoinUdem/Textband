'use client';

import React, { useReducer, useCallback, useRef, useState, useMemo, useEffect } from 'react';
import type { TextBlock, Language, DAWState, DAWAction, BrushType, PhonemeEvent, PhoneticSection } from '@/types';
import ControlBar from '@/components/ControlBar';
import MidiTrackPanel from '@/components/MidiTrackPanel';
import TextTrack from '@/components/TextTrack';
import SynonymRow from '@/components/SynonymRow';
import { getPhonemeOrder, fetchPhonemes, textToPhonemes } from '@/lib/phonemizer';
import { mergeTexts, splitText } from '@/lib/llmClient';
import Playhead, { setPlayheadPosition } from '@/components/Playhead';
import TimelineRuler from '@/components/TimelineRuler';
import LoopRegion from '@/components/LoopRegion';
import { ImportModal, ExportModal } from '@/components/ImportExportModals';
import ExitExperienceModal from '@/components/ExitExperienceModal';
import { PX_PER_CHAR, PADDING_X, GAP_X, INITIAL_PLAYHEAD_PADDING } from '@/lib/constants';
import { useExperience } from '@/components/ExperienceLogProvider';
import phoneticsData from '@/data/phonetics.json';
import { getValidSynonyms } from '@/lib/synonymLogic';
import { HIGHLIGHT_COLOR_SELECTED, HIGHLIGHT_COLOR_HOVER, LABEL_COLOR_SELECTED, LABEL_COLOR_HOVER } from '@/lib/phonemeColors';

let blockCounter = 0;
function createBlock(text: string, width?: number): TextBlock {
  blockCounter++;
  return {
    id: `block-${blockCounter}-${Date.now()}`,
    text,
    width: width ?? (text.length * PX_PER_CHAR),
  };
}

let sharedAudioCtx: AudioContext | null = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return sharedAudioCtx;
}

const audioBufferCache = new Map<string, AudioBuffer>();

async function fetchAudioBuffer(url: string, ctx: AudioContext): Promise<AudioBuffer> {
  if (audioBufferCache.has(url)) {
    return audioBufferCache.get(url)!;
  }
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  audioBufferCache.set(url, audioBuffer);
  return audioBuffer;
}

// ---- Reducer ----
const initialState: DAWState = {
  blocks: [
    {
      id: 'initial-block',
      text: 'Write here.',
      width: 'Write here.'.length * PX_PER_CHAR,
    },
  ],
  language: 'en',
  tempo: 183,
  isPlaying: false,
  selectedBlockId: null,
  loopRegion: null,
  copiedBlock: null,
  phonemeSortMode: 'popularity-text',
};

function dawReducer(state: DAWState, action: DAWAction): DAWState {
  switch (action.type) {
    case 'SET_BLOCKS':
      return { ...state, blocks: action.blocks };

    case 'UPDATE_BLOCK':
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.id === action.id
            ? { ...b, text: action.text, width: action.width ?? b.width, phonemes: undefined, isPhonemizing: false, suggestions: undefined }
            : b
        ),
      };

    case 'ADD_BLOCK':
      return { ...state, blocks: [...state.blocks, action.block] };

    case 'REMOVE_BLOCK':
      return {
        ...state,
        blocks: state.blocks.filter((b) => b.id !== action.id),
        selectedBlockId:
          state.selectedBlockId === action.id ? null : state.selectedBlockId,
      };

    case 'REORDER_BLOCKS': {
      const oldIdx = state.blocks.findIndex((b) => b.id === action.activeId);
      const newIdx = state.blocks.findIndex((b) => b.id === action.overId);
      if (oldIdx === -1 || newIdx === -1) return state;
      const newBlocks = [...state.blocks];
      const [moved] = newBlocks.splice(oldIdx, 1);
      newBlocks.splice(newIdx, 0, moved);
      return { ...state, blocks: newBlocks };
    }

    case 'SPLIT_BLOCK': {
      const idx = state.blocks.findIndex((b) => b.id === action.id);
      if (idx === -1) return state;
      const newBlocks = [...state.blocks];
      newBlocks.splice(idx, 1, createBlock(action.leftText), createBlock(action.rightText));
      return { ...state, blocks: newBlocks };
    }

    case 'SET_LANGUAGE':
      return { ...state, language: action.language };

    case 'SET_TEMPO':
      return { ...state, tempo: action.tempo };

    case 'SET_PHONEME_SORT_MODE':
      return { ...state, phonemeSortMode: action.mode };

    case 'SET_PLAYING':
      return { ...state, isPlaying: action.isPlaying };

    case 'SELECT_BLOCK':
      return { ...state, selectedBlockId: action.id };

    case 'TOGGLE_MIDI_NOTE': {
      const { phoneme, wordKey, section, brush } = action;

      const currentOverrides = state.midiOverrides || {};
      const laneOverrides = currentOverrides[phoneme] || {};
      const wordOverrides = laneOverrides[wordKey] || {};

      const newWordOverrides = { ...wordOverrides };
      const currentOverride = newWordOverrides[section];

      if (currentOverride === brush) {
        delete newWordOverrides[section];
      } else {
        newWordOverrides[section] = brush;
      }

      const newLaneOverrides = { ...laneOverrides, [wordKey]: newWordOverrides };
      if (Object.keys(newWordOverrides).length === 0) {
        delete newLaneOverrides[wordKey];
      }

      const newOverrides: Record<string, Record<string, Record<string, BrushType>>> = { ...currentOverrides, [phoneme]: newLaneOverrides };
      if (Object.keys(newLaneOverrides).length === 0) {
        delete newOverrides[phoneme];
      }

      const activeWordConstraints: Record<string, Record<string, BrushType>> = {};
      for (const ph in newOverrides) {
        if (newOverrides[ph]?.[wordKey]) {
          activeWordConstraints[ph] = newOverrides[ph][wordKey];
        }
      }

      const [blockId, wIdxStr] = wordKey.split(':');
      const wIdx = parseInt(wIdxStr, 10);
      const block = state.blocks.find(b => b.id === blockId);

      let newBlocks = state.blocks;

      if (block && block.synonymBank && block.synonymBank[wIdx]) {
        const wordSyns = block.synonymBank[wIdx];
        const originalWord = wordSyns.original;
        const wordCurrentlyInText = wordSyns.currentText || originalWord;
        
        let newWordToSelect = originalWord;
        let newSynonymBank = [...block.synonymBank];
        let wordSynsUpdated = { ...wordSyns, synonyms: [...wordSyns.synonyms] };

        if (Object.keys(activeWordConstraints).length === 0) {
          newWordToSelect = originalWord;
        } else {
          const validSynonyms = getValidSynonyms(wordSyns, activeWordConstraints);
          if (validSynonyms.length > 0) {
            const match = validSynonyms[0];
            newWordToSelect = match.text;
            
            const matchIdx = wordSynsUpdated.synonyms.findIndex(s => s.text === match.text);
            if (matchIdx !== -1) {
              const [removed] = wordSynsUpdated.synonyms.splice(matchIdx, 1);
              wordSynsUpdated.synonyms.push(removed);
            }
          } else {
            newWordToSelect = wordCurrentlyInText;
          }
        }
        
        wordSynsUpdated.currentText = newWordToSelect;
        newSynonymBank[wIdx] = wordSynsUpdated;
        
        let charIdx = 0;
        for (let i = 0; i < wIdx; i++) {
          const priorWord = block.synonymBank[i];
          const priorWordInText = priorWord.currentText || priorWord.original;
          const searchPart = block.text.toLowerCase().slice(charIdx);
          const pos = searchPart.indexOf(priorWordInText.toLowerCase());
          if (pos !== -1) {
            charIdx += pos + priorWordInText.length;
          }
        }

        const searchPart = block.text.toLowerCase().slice(charIdx);
        const wordStartInPart = searchPart.indexOf(wordCurrentlyInText.toLowerCase());
        
        if (wordStartInPart !== -1) {
          const wordStart = charIdx + wordStartInPart;
          const wordLen = wordCurrentlyInText.length;
          const originalStr = block.text.substring(wordStart, wordStart + wordLen);

          let formattedWord = newWordToSelect;
          if (originalStr.length > 0 && originalStr[0] === originalStr[0].toUpperCase() && originalStr[0] !== originalStr[0].toLowerCase()) {
            formattedWord = newWordToSelect.charAt(0).toUpperCase() + newWordToSelect.slice(1);
          }

          const newText = block.text.substring(0, wordStart) + formattedWord + block.text.substring(wordStart + wordLen);
          
          let newPhonemesArray = block.phonemes ? [...block.phonemes] : [];
          if (newPhonemesArray[wIdx]) {
            if (!wordSynsUpdated.originalPhonemes) {
              wordSynsUpdated.originalPhonemes = newPhonemesArray[wIdx].phonemes;
            }
            
            let wordPhonemes: string[] = [];
            if (newWordToSelect === originalWord) {
              wordPhonemes = wordSynsUpdated.originalPhonemes || [];
            } else {
              const match = wordSynsUpdated.synonyms.find(s => s.text === newWordToSelect);
              if (match) {
                wordPhonemes = [...match.segments.begin, ...match.segments.mid, ...match.segments.end];
              } else {
                wordPhonemes = newPhonemesArray[wIdx].phonemes;
              }
            }
            
            newPhonemesArray[wIdx] = {
              ...newPhonemesArray[wIdx],
              text: newWordToSelect,
              phonemes: wordPhonemes
            };
          }
          
          newBlocks = state.blocks.map(b =>
            b.id === blockId ? { 
              ...b, 
              text: newText, 
              width: Math.max(newText.length * PX_PER_CHAR, 10),
              phonemes: newPhonemesArray.length > 0 ? newPhonemesArray : undefined, 
              isPhonemizing: false,
              synonymBank: newSynonymBank 
            } : b
          );
        }
      }

      return {
        ...state,
        midiOverrides: newOverrides,
        blocks: newBlocks
      };
    }

    case 'RESET_MIDI':
      return {
        ...state,
        midiOverrides: {},
        blocks: state.blocks.map(b => ({ ...b, phonemes: undefined, isPhonemizing: false }))
      };

    case 'SET_BLOCK_LOADING':
      return {
        ...state,
        blocks: state.blocks.map(b =>
          b.id === action.id ? { ...b, isRegenerating: action.isLoading } : b
        )
      };

    case 'REPLACE_BLOCK_WITH_SEGMENTS': {
      const idx = state.blocks.findIndex(b => b.id === action.id);
      if (idx === -1) return state;
      const newBlocks = [...state.blocks];
      newBlocks.splice(idx, 1, ...action.segments);
      return { ...state, blocks: newBlocks };
    }

    case 'MERGE_BLOCKS': {
      const idx1 = state.blocks.findIndex(b => b.id === action.id1);
      const idx2 = state.blocks.findIndex(b => b.id === action.id2);
      if (idx1 === -1 || idx2 === -1) return state;

      const newBlocks = [...state.blocks];
      const startIdx = Math.min(idx1, idx2);
      // Remove both blocks and insert the merged one
      newBlocks.splice(startIdx, 2, action.mergedBlock);

      return {
        ...state,
        blocks: newBlocks,
        selectedBlockId: action.mergedBlock.id
      };
    }

    case 'SET_LOOP_REGION':
      return { ...state, loopRegion: action.region };

    case 'COPY_SELECTED_BLOCK': {
      const selected = state.blocks.find(b => b.id === state.selectedBlockId);
      if (!selected) return state;
      return { ...state, copiedBlock: selected };
    }

    case 'UPDATE_BLOCK_WIDTH':
      return {
        ...state,
        blocks: state.blocks.map((b) =>
          b.id === action.id ? { ...b, width: action.width } : b
        ),
      };

    case 'PASTE_COPIED_BLOCK': {
      if (!state.copiedBlock) return state;
      const newBlock = createBlock(state.copiedBlock.text);
      const selectedIdx = state.blocks.findIndex(b => b.id === state.selectedBlockId);

      const newBlocks = [...state.blocks];
      if (selectedIdx === -1) {
        newBlocks.push(newBlock);
      } else {
        newBlocks.splice(selectedIdx + 1, 0, newBlock);
      }

      return {
        ...state,
        blocks: newBlocks,
        selectedBlockId: newBlock.id
      };
    }

    case 'UPDATE_BLOCK_PHONEMES':
      return {
        ...state,
        blocks: state.blocks.map(b =>
          b.id === action.id ? { ...b, phonemes: action.phonemes, isPhonemizing: false } : b
        )
      };

    case 'UPDATE_BLOCK_SYNONYMS':
      return {
        ...state,
        blocks: state.blocks.map(b =>
          b.id === action.id ? { ...b, synonymBank: action.synonymBank } : b
        )
      };

    case 'SET_BLOCK_PHONEMIZING':
      return {
        ...state,
        blocks: state.blocks.map(b =>
          b.id === action.id ? { ...b, isPhonemizing: action.isPhonemizing } : b
        )
      };

    case 'SET_PLAYING_PHONEME':
      return { ...state, playingPhoneme: action.phoneme };

    case 'SELECT_SYNONYM': {
      const { id, wIdx, newWord } = action;
      const block = state.blocks.find(b => b.id === id);
      if (!block || !block.synonymBank || !block.synonymBank[wIdx]) return state;

      const wordSyns = block.synonymBank[wIdx];
      const original = wordSyns.original;
      const wordCurrentlyInText = wordSyns.currentText || original;

      // Walk through prior synonymBank words to find the correct char offset
      let charIdx = 0;
      for (let i = 0; i < wIdx; i++) {
        const priorWord = block.synonymBank[i];
        const priorWordInText = priorWord.currentText || priorWord.original;
        const searchPart = block.text.toLowerCase().slice(charIdx);
        const pos = searchPart.indexOf(priorWordInText.toLowerCase());
        if (pos !== -1) {
          charIdx += pos + priorWordInText.length;
        }
      }

      // Now find the target word from charIdx
      const searchPart = block.text.toLowerCase().slice(charIdx);
      const wordStartInPart = searchPart.indexOf(wordCurrentlyInText.toLowerCase());
      if (wordStartInPart === -1) return state;

      const wordStart = charIdx + wordStartInPart;
      const wordLen = wordCurrentlyInText.length;
      const originalStr = block.text.substring(wordStart, wordStart + wordLen);

      // Preserve capitalization
      let formattedWord = newWord;
      if (originalStr.length > 0 && originalStr[0] === originalStr[0].toUpperCase() && originalStr[0] !== originalStr[0].toLowerCase()) {
        formattedWord = newWord.charAt(0).toUpperCase() + newWord.slice(1);
      }

      const newText = block.text.substring(0, wordStart) + formattedWord + block.text.substring(wordStart + wordLen);

      const newSynonymBank = [...block.synonymBank];
      newSynonymBank[wIdx] = { ...wordSyns, currentText: newWord };

      let newPhonemesArray = block.phonemes ? [...block.phonemes] : [];
      if (newPhonemesArray[wIdx]) {
        if (!newSynonymBank[wIdx].originalPhonemes) {
          newSynonymBank[wIdx].originalPhonemes = newPhonemesArray[wIdx].phonemes;
        }
        
        let wordPhonemes: string[] = [];
        const match = newSynonymBank[wIdx].synonyms.find(s => s.text === newWord);
        if (match) {
          wordPhonemes = [...match.segments.begin, ...match.segments.mid, ...match.segments.end];
        } else {
          wordPhonemes = newPhonemesArray[wIdx].phonemes;
        }
        
        newPhonemesArray[wIdx] = {
          ...newPhonemesArray[wIdx],
          text: newWord,
          phonemes: wordPhonemes
        };
      }

      // Clear MIDI constraints for this word (like a mini-regeneration)
      const wordKey = `${id}:${wIdx}`;
      const newOverrides = { ...state.midiOverrides };
      for (const ph in newOverrides) {
        if (newOverrides[ph]?.[wordKey]) {
          newOverrides[ph] = { ...newOverrides[ph] };
          delete newOverrides[ph][wordKey];
          // Clean up empty phoneme entries
          if (Object.keys(newOverrides[ph]).length === 0) {
            delete newOverrides[ph];
          }
        }
      }

      return {
        ...state,
        midiOverrides: newOverrides,
        blocks: state.blocks.map(b =>
          b.id === id ? { ...b, text: newText, width: newText.length * PX_PER_CHAR, phonemes: newPhonemesArray.length > 0 ? newPhonemesArray : undefined, isPhonemizing: false, synonymBank: newSynonymBank } : b
        )
      };
    }

    default:
      return state;
  }
}

// ---- Undo/Redo Wrapper ----
type UndoableAction<T> = T | { type: 'UNDO' } | { type: 'REDO' };

interface StateWithHistory<T> {
  past: T[];
  present: T;
  future: T[];
}

/** 
 * Strips transient UI flags from the state before saving to history.
 * Ensures Undo doesn't land on "Loading" or "Playing" states.
 */
function cleanStateForHistory(state: DAWState): DAWState {
  return {
    ...state,
    isPlaying: false,
    playingPhoneme: null,
    blocks: state.blocks.map(b => ({
      ...b,
      isPhonemizing: false,
      isRegenerating: false
    }))
  };
}

function useUndoableReducer<S, A extends { type: string }>(
  reducer: React.Reducer<S, A>,
  initialState: S
): [StateWithHistory<S>, React.Dispatch<UndoableAction<A>>] {
  const undoableReducer = useCallback((state: StateWithHistory<S>, action: UndoableAction<A>): StateWithHistory<S> => {
    switch ((action as any).type) {
      case 'UNDO': {
        if (state.past.length === 0) return state;
        const previous = state.past[state.past.length - 1];
        const newPast = state.past.slice(0, state.past.length - 1);
        return {
          past: newPast,
          present: previous,
          future: [state.present, ...state.future],
        };
      }
      case 'REDO': {
        if (state.future.length === 0) return state;
        const next = state.future[0];
        const newFuture = state.future.slice(1);
        return {
          past: [...state.past, (state.present as any).blocks ? (cleanStateForHistory(state.present as any) as unknown as S) : state.present],
          present: next,
          future: newFuture,
        };
      }
      default: {
        const newPresent = reducer(state.present, action as A);
        if (newPresent === state.present) return state;

        const unrecordedActions = [
          'SET_PLAYING',
          'SET_PLAYING_PHONEME',
          'SELECT_BLOCK',
          'SET_BLOCK_PHONEMIZING',
          'UPDATE_BLOCK_PHONEMES',
          'SET_BLOCK_LOADING',
          'SET_LOOP_REGION',
          'COPY_SELECTED_BLOCK',
          'SET_TEMPO',
          'SET_LANGUAGE',
          'UPDATE_BLOCK_WIDTH',
          'UPDATE_BLOCK_SYNONYMS',
        ];

        if (unrecordedActions.includes((action as any).type)) {
          return { ...state, present: newPresent };
        }

        if ((action as any).replaceHistory) {
          return {
            ...state,
            present: newPresent,
          };
        }

        return {
          past: [...state.past, (state.present as any).blocks ? (cleanStateForHistory(state.present as any) as unknown as S) : state.present],
          present: newPresent,
          future: [],
        };
      }
    }
  }, [reducer]);

  const [state, dispatch] = useReducer(undoableReducer, {
    past: [],
    present: initialState,
    future: [],
  });

  return [state, dispatch as React.Dispatch<UndoableAction<A>>];
}

// ---- Main Page ----
export default function Home() {
  const [historyState, dispatch] = useUndoableReducer<DAWState, DAWAction>(dawReducer, initialState);
  const state = historyState.present;
  const [activeModal, setActiveModal] = useState<'import' | 'export' | null>(null);
  const [isRecordingSTT, setIsRecordingSTT] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showExitModal, setShowExitModal] = useState(false);
  const [selectedPhonemes, setSelectedPhonemes] = useState<Set<string>>(new Set());
  const [hoveredPhoneme, setHoveredPhoneme] = useState<string | null>(null);

  const { isExperienceActive, selectedPhrase, stopExperience, participantId, logLLM, logTextHistory, logAction } = useExperience();

  const timelineRef = useRef<HTMLDivElement>(null);

  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const auditionRafRef = useRef<number | null>(null);
  const currentAuditionIdRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const startPxRef = useRef<number>(INITIAL_PLAYHEAD_PADDING);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // ---- Effects ----
  // Log Text History
  const currentText = useMemo(() => state.blocks.map(b => b.text).join(' '), [state.blocks]);
  const previousTextRef = useRef(currentText);

  useEffect(() => {
    if (isExperienceActive && currentText !== previousTextRef.current) {
      // Don't log temporary merge states if possible
      if (!currentText.includes('Merging...')) {
        logTextHistory(currentText);
      }
      previousTextRef.current = currentText;
    }
  }, [currentText, isExperienceActive, logTextHistory]);

  // Stable key: only re-trigger phonemization when actual text content changes,
  // not on width/drag/selection updates that create new block objects but same text.
  const blockTextKey = useMemo(
    () => state.blocks.map(b => `${b.id}:${b.text}`).join('|'),
    [state.blocks]
  );

  // Automatically fetch phonemes for blocks that don't have them
  useEffect(() => {
    const fetchMissing = async () => {
      // Find all blocks that need phonemes and aren't already being processed
      const blocksToPhonemize = state.blocks.filter(b =>
        !b.phonemes && b.text.trim().length > 0 && !b.isRegenerating && !b.isPhonemizing
      );

      if (blocksToPhonemize.length > 0) {
        // Process all missing blocks in parallel
        await Promise.all(blocksToPhonemize.map(async (block) => {
          dispatch({ type: 'SET_BLOCK_PHONEMIZING', id: block.id, isPhonemizing: true });
          try {
            const [phonemes, synonymBank] = await Promise.all([
              fetchPhonemes(block.text, state.language),
              fetch('/api/synonym-bank', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: block.text, language: state.language })
              }).then(res => res.json()).then(data => data.synonym_bank).catch(() => undefined)
            ]);
            dispatch({ type: 'UPDATE_BLOCK_PHONEMES', id: block.id, phonemes });
            if (synonymBank) {
              dispatch({ type: 'UPDATE_BLOCK_SYNONYMS', id: block.id, synonymBank });
            }
          } catch (err) {
            console.error(`Failed to process block ${block.id}:`, err);
            dispatch({ type: 'SET_BLOCK_PHONEMIZING', id: block.id, isPhonemizing: false });
          }
        }));
      }
    };

    // Debounce the fetching: wait for short silence before requesting from server
    const timeoutId = setTimeout(() => {
      fetchMissing();
    }, 800);

    return () => clearTimeout(timeoutId);
    // Use blockTextKey instead of state.blocks so resize/drag don't trigger phonemization
  }, [blockTextKey, state.language]);

  // Experience Initialization
  useEffect(() => {
    if (isExperienceActive && selectedPhrase) {
      const segments = selectedPhrase.split(/(?<=[.:;!?\)\]—])\s+/).filter(s => s.trim().length > 0);
      const newBlocks = segments.length > 1 ? segments.map(t => createBlock(t.trim())) : [createBlock(selectedPhrase)];
      dispatch({ type: 'SET_BLOCKS', blocks: newBlocks });
      dispatch({ type: 'SELECT_BLOCK', id: newBlocks[0].id });
    }
  }, [isExperienceActive, selectedPhrase]);

  // ---- Handlers ----
  // Function to calculate character offset and relevant text for looping
  const startPlayback = useCallback((offsetPx: number) => {
    // 0. Cancel any existing playback
    window.speechSynthesis.cancel();
    if (activeUtteranceRef.current) {
      activeUtteranceRef.current = null;
    }

    let currentBlockStartPx = 0;
    let foundBlockIdx = 0;
    let charIndexInBlock = 0;

    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      const blockEndPx = currentBlockStartPx + b.width;
      if (offsetPx >= currentBlockStartPx && offsetPx <= blockEndPx) {
        foundBlockIdx = i;
        charIndexInBlock = Math.floor((offsetPx - currentBlockStartPx) / PX_PER_CHAR);
        break;
      }
      currentBlockStartPx += b.width + GAP_X;
    }

    const blocksToSpeak = state.blocks.slice(foundBlockIdx);
    let textToSpeak = blocksToSpeak.map((b, i) => i === 0 ? b.text.slice(charIndexInBlock) : b.text).join('. ');

    let globalCharOffset = 0;
    for (let i = 0; i < foundBlockIdx; i++) {
      globalCharOffset += state.blocks[i].text.length + 2; // + 2 for '. '
    }
    globalCharOffset += charIndexInBlock;

    if (!textToSpeak.trim()) {
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
      return;
    }

    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    activeUtteranceRef.current = utterance;
    utterance.lang = state.language === 'fr' ? 'fr-FR' : 'en-US';
    utterance.rate = state.tempo / 183;

    utterance.onboundary = (event) => {
      if (activeUtteranceRef.current !== utterance) return;

      if (event.name === 'word') {
        const globalCharIndex = event.charIndex + globalCharOffset;
        let charAcc = 0;
        let targetBlockId = "";
        let localCharIndex = 0;

        for (const b of state.blocks) {
          const blockTextLength = b.text.length + 2; 
          if (globalCharIndex >= charAcc && globalCharIndex < charAcc + blockTextLength) {
            targetBlockId = b.id;
            localCharIndex = globalCharIndex - charAcc;
            break;
          }
          charAcc += blockTextLength;
        }

        if (!targetBlockId) return;

        const blockEl = document.querySelector(`[data-block-id="${targetBlockId}"]`);
        const timelineEl = timelineRef.current;

        if (blockEl && timelineEl) {
          try {
            const range = document.createRange();
            const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
            let charCount = 0;
            let textNode: Text | null = null;
            let offsetInNode = 0;

            while (walker.nextNode()) {
              const node = walker.currentNode as Text;
              const nodeLen = node.nodeValue?.length || 0;
              if (charCount + nodeLen > localCharIndex) {
                textNode = node;
                offsetInNode = localCharIndex - charCount;
                break;
              }
              charCount += nodeLen;
            }

            if (textNode) {
              const maxOffset = textNode.nodeValue?.length || 0;
              range.setStart(textNode, Math.min(offsetInNode, maxOffset));
              range.setEnd(textNode, Math.min(offsetInNode + 1, maxOffset));

              const rect = range.getBoundingClientRect();
              const timelineRect = timelineEl.getBoundingClientRect();

              const px = rect.left - timelineRect.left + timelineEl.scrollLeft - 100;
              setPlayheadPosition(px);

              if (state.loopRegion) {
                const [, end] = state.loopRegion;
                if (px >= end - 5) {
                  window.speechSynthesis.pause();
                  window.speechSynthesis.cancel();
                  setTimeout(() => {
                    startPlayback(state.loopRegion![0]);
                  }, 50);
                }
              }
            }
          } catch (err) {
            console.warn("DOM position failed", err);
          }
        }
      }
    };

    utterance.onend = () => {
      if (activeUtteranceRef.current !== utterance) return;

      if (state.loopRegion) {
        setTimeout(() => {
          startPlayback(state.loopRegion![0]);
        }, 50);
      } else {
        activeUtteranceRef.current = null;
        dispatch({ type: 'SET_PLAYING', isPlaying: false });
        setPlayheadPosition(INITIAL_PLAYHEAD_PADDING);
      }
    };

    utterance.onerror = (e) => {
      if (activeUtteranceRef.current !== utterance) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;

      console.error('TTS error:', e.error || e);
      activeUtteranceRef.current = null;
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
    };

    window.speechSynthesis.speak(utterance);
  }, [state.blocks, state.language, state.tempo, state.loopRegion, dispatch, timelineRef]);

  const handlePlayPause = useCallback(() => {
    if (state.isPlaying) {
      if (activeUtteranceRef.current) {
        window.speechSynthesis.pause();
      } else {
        const runningCtx = getAudioContext();
        if (runningCtx && runningCtx.state === 'running' && auditionRafRef.current) {
          runningCtx.suspend();
          if (auditionRafRef.current) cancelAnimationFrame(auditionRafRef.current);
          auditionRafRef.current = null;
        } else {
          window.speechSynthesis.cancel();
          if (auditionRafRef.current) cancelAnimationFrame(auditionRafRef.current);
          auditionRafRef.current = null;
          dispatch({ type: 'SET_PLAYING_PHONEME', phoneme: null });
        }
      }
      dispatch({ type: 'SET_PLAYING', isPlaying: false });
      return;
    }

    if (activeUtteranceRef.current && window.speechSynthesis.paused) {
      window.speechSynthesis.cancel();
      activeUtteranceRef.current = null;
    }

    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended' && auditionRafRef.current) {
      cancelAnimationFrame(auditionRafRef.current);
      auditionRafRef.current = null;
      dispatch({ type: 'SET_PLAYING_PHONEME', phoneme: null });
    }

    logAction(state.isPlaying ? 'PAUSE' : 'PLAY', { isTts: true });
    dispatch({ type: 'SET_PLAYING', isPlaying: true });

    const currentPos = (window as any)._playheadPosition ?? INITIAL_PLAYHEAD_PADDING;
    const startPos = state.loopRegion ? state.loopRegion[0] : currentPos;
    startPlayback(startPos);

  }, [state.isPlaying, state.loopRegion, startPlayback, logAction, dispatch]);


  const handleAuditionTrack = useCallback(async (phoneme: string, events: PhonemeEvent[]) => {
    const ctx = getAudioContext();

    // If the user clicks the play button on the same track that is currently active,
    // we toggle its pause/resume state (inlined to avoid circular dep with handlePlayPause).
    if (state.playingPhoneme === phoneme) {
      if (state.isPlaying) {
        // Pause the audition
        if (ctx && ctx.state === 'running' && auditionRafRef.current) {
          ctx.suspend();
          cancelAnimationFrame(auditionRafRef.current);
          auditionRafRef.current = null;
        }
        dispatch({ type: 'SET_PLAYING', isPlaying: false });
      } else {
        // Resume the audition
        if (ctx && ctx.state === 'suspended') {
          await ctx.resume();
          // We need to restart the RAF loop here if it was stopped
          if (!auditionRafRef.current) {
            handleAuditionTrack(phoneme, events);
            return; // handleAuditionTrack will start a new loop
          }
        }
        dispatch({ type: 'SET_PLAYING', isPlaying: true });
      }
      return;
    }

    logAction('AUDITION_TRACK', { phoneme });
    dispatch({ type: 'SET_PLAYING_PHONEME', phoneme });

    // Cancel normal TTS if running
    if (activeUtteranceRef.current) {
      window.speechSynthesis.cancel();
      activeUtteranceRef.current = null;
    }

    const auditionId = ++currentAuditionIdRef.current;

    // Cancel existing audition visually
    if (auditionRafRef.current) {
      cancelAnimationFrame(auditionRafRef.current);
      auditionRafRef.current = null;
    }

    // Stop and clear previous Web Audio sources
    activeSourcesRef.current.forEach(s => {
      try { s.stop(); } catch (e) { }
    });
    activeSourcesRef.current = [];

    if (!ctx) return;

    if (ctx.state === 'suspended' && state.playingPhoneme !== phoneme) {
      await ctx.resume();
    }

    const soundPath = (phoneticsData as any)[state.language]?.sounds?.[phoneme];
    if (!soundPath) {
      console.warn(`No audio found for ${phoneme}`);
      return;
    }

    let totalWidth = 0;
    state.blocks.forEach(b => totalWidth += b.width + GAP_X);

    const currentPos = (window as any)._playheadPosition ?? INITIAL_PLAYHEAD_PADDING;
    const startPx = state.loopRegion ? state.loopRegion[0] : currentPos;
    const endPx = state.loopRegion ? state.loopRegion[1] : totalWidth;

    startPxRef.current = startPx;

    const buffer = await fetchAudioBuffer(soundPath, ctx);

    // Speed: sync exact matching of the tempo
    const pxPerSec = (PX_PER_CHAR * state.tempo / 10);

    let startTime = ctx.currentTime;

    // Schedule all valid events
    events.forEach(e => {
      const evStart = e.startPx ?? 0;

      if (evStart >= startPx && evStart <= endPx) {
        const delaySec = (evStart - startPx) / pxPerSec;
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(startTime + delaySec);
        activeSourcesRef.current.push(source);
      }
    });

    dispatch({ type: 'SET_PLAYING', isPlaying: true });

    // Animate the playhead
    const loop = () => {
      if (!ctx || !auditionRafRef.current || auditionId !== currentAuditionIdRef.current) return;
      if (ctx.state !== 'running') return;

      const elapsedSec = ctx.currentTime - startTime;
      const currentPx = startPx + (elapsedSec * pxPerSec);

      setPlayheadPosition(currentPx);

      if (currentPx < endPx && currentPx < totalWidth) {
        auditionRafRef.current = requestAnimationFrame(loop);
      } else {
        if (state.loopRegion) {
          setTimeout(() => {
            if (auditionId === currentAuditionIdRef.current) {
              handleAuditionTrack(phoneme, events).catch(console.error);
            }
          }, 50);
        } else {
          auditionRafRef.current = null;
          dispatch({ type: 'SET_PLAYING', isPlaying: false });
          dispatch({ type: 'SET_PLAYING_PHONEME', phoneme: null });
          setPlayheadPosition(INITIAL_PLAYHEAD_PADDING);
        }
      }
    };

    auditionRafRef.current = requestAnimationFrame(loop);
  }, [state.playingPhoneme, state.isPlaying, state.blocks, state.loopRegion, state.tempo, state.language]);

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + timelineRef.current.scrollLeft;
    const pos = Math.max(0, x - 100);

    if (state.isPlaying) {
      handlePlayPause();
    }

    if (e.metaKey || e.ctrlKey) {
      if (!state.loopRegion) {
        dispatch({ type: 'SET_LOOP_REGION', region: [pos, pos + 100] });
      } else {
        const [start, end] = state.loopRegion;
        // If cliking near start or end, maybe update it?
        // Simpler: alternating clicks. 1st click = start, 2nd click = end.
        if (state.loopRegion[0] === state.loopRegion[1]) {
          // We had a point, now we have a range
          const newStart = Math.min(start, pos);
          const newEnd = Math.max(start, pos);
          dispatch({ type: 'SET_LOOP_REGION', region: [newStart, newEnd] });
        } else {
          // Reset to a point
          dispatch({ type: 'SET_LOOP_REGION', region: [pos, pos] });
        }
      }
    } else {
      setPlayheadPosition(pos);
      dispatch({ type: 'SET_LOOP_REGION', region: null });
    }
    logAction('TIMELINE_CLICK', { pos });
  }, [state.loopRegion, state.isPlaying, handlePlayPause, logAction]);

  const handleCut = useCallback(async () => {
    // Find which block the playhead is over
    let currentBlockStartPx = 0;
    let targetBlock: TextBlock | null = null;
    let charIndexInBlock = 0;
    const currentPlayheadPos = (window as any)._playheadPosition ?? INITIAL_PLAYHEAD_PADDING;

    for (let i = 0; i < state.blocks.length; i++) {
      const b = state.blocks[i];
      const blockEndPx = currentBlockStartPx + b.width;
      if (currentPlayheadPos >= currentBlockStartPx && currentPlayheadPos <= blockEndPx) {
        targetBlock = b;
        charIndexInBlock = Math.floor((currentPlayheadPos - currentBlockStartPx) / PX_PER_CHAR);
        break;
      }
      currentBlockStartPx += b.width + GAP_X;
    }

    if (!targetBlock || targetBlock.text.length < 2) return;

    const id = targetBlock.id;
    const originalText = targetBlock.text;

    const textBeforeCut = originalText.slice(0, charIndexInBlock);
    const textAfterCut = originalText.slice(charIndexInBlock);
    const markedText = `${textBeforeCut}[CUT HERE]${textAfterCut}`;

    // Set regenerating state
    dispatch({ type: 'SET_BLOCK_LOADING', id, isLoading: true });

    try {
      logLLM('sent', { type: 'split', text: markedText, lang: state.language });
      const [leftText, rightText] = await splitText(markedText, state.language, originalText);
      logLLM('received', { type: 'split', result: `${leftText} ||| ${rightText}` });

      dispatch({
        type: 'SPLIT_BLOCK',
        id,
        leftText,
        rightText,
      });
      logAction('CUT_LLM', { id });
    } catch (err) {
      console.error("Failed to split text via LLM:", err);
      dispatch({ type: 'SET_BLOCK_LOADING', id, isLoading: false });
    }
  }, [state.blocks, logAction, dispatch, logLLM, state.language]);

  const handleReorderBlocks = useCallback((activeId: string, overId: string) => {
    logAction('REORDER', { activeId, overId });
    dispatch({ type: 'REORDER_BLOCKS', activeId, overId });
  }, [logAction]);

  const handleSelectBlock = useCallback((id: string | null) => {
    if (id) logAction('SELECT', { id });
    dispatch({ type: 'SELECT_BLOCK', id });
  }, [logAction]);
  
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (timelineRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      timelineRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  const handleToggleNote = useCallback((phoneme: string, wordKey: string, section: PhoneticSection, brush: BrushType) => {
    logAction('TOGGLE_MIDI_NOTE', { phoneme, wordKey, section, brush });
    dispatch({ type: 'TOGGLE_MIDI_NOTE', phoneme, wordKey, section, brush });
  }, [logAction]);

  const handleResetMidi = useCallback(() => {
    logAction('RESET_MIDI');
    dispatch({ type: 'RESET_MIDI' });
  }, [logAction]);

  // ---- Phoneme Selection (right-click on labels) ----
  const handleLabelRightClick = useCallback((phoneme: string) => {
    setSelectedPhonemes(prev => {
      const next = new Set(prev);
      if (next.has(phoneme)) {
        next.delete(phoneme);
      } else {
        next.add(phoneme);
      }
      return next;
    });
  }, []);

  const handleLabelHover = useCallback((phoneme: string | null) => {
    setHoveredPhoneme(phoneme);
  }, []);

  // Compute highlight ranges for each block based on selected + hovered phonemes
  const highlightRangesMap = useMemo(() => {
    const activePhonemes = new Set(selectedPhonemes);
    const hasHover = hoveredPhoneme && !selectedPhonemes.has(hoveredPhoneme);
    if (hasHover) activePhonemes.add(hoveredPhoneme);
    
    if (activePhonemes.size === 0) return {};
    const map: Record<string, { start: number; end: number; color: string }[]> = {};
    
    for (const block of state.blocks) {
      if (!block.phonemes) continue;
      const events = textToPhonemes(block.text, state.language, block.id, block.phonemes);
      const ranges: { start: number; end: number; color: string }[] = [];
      
      for (const evt of events) {
        if (selectedPhonemes.has(evt.phoneme)) {
          ranges.push({
            start: evt.startChar,
            end: evt.endChar,
            color: HIGHLIGHT_COLOR_SELECTED,
          });
        } else if (hasHover && evt.phoneme === hoveredPhoneme) {
          ranges.push({
            start: evt.startChar,
            end: evt.endChar,
            color: HIGHLIGHT_COLOR_HOVER,
          });
        }
      }
      
      if (ranges.length > 0) {
        map[block.id] = ranges;
      }
    }
    return map;
  }, [selectedPhonemes, hoveredPhoneme, state.blocks, state.language]);

  // Speculative Execution Cache
  const speculativeBlocksRef = useRef<TextBlock[] | null>(null);
  const speculativeSignatureRef = useRef<string | null>(null);

  const computeGeneration = useCallback(async (
    currentBlocks: TextBlock[],
    overrides: Record<string, Record<string, Record<string, BrushType>>>,
    isSpeculative: boolean
  ): Promise<TextBlock[] | null> => {
    const newBlocks: TextBlock[] = [...currentBlocks];
    let hasAnyChanges = false;

    for (let bIdx = 0; bIdx < newBlocks.length; bIdx++) {
      const block = newBlocks[bIdx];
      if (!block.synonymBank || block.synonymBank.length === 0) continue;

      let newText = "";
      let lastReplacedCharIdx = 0;
      let charIdx = 0;
      let blockHasChanges = false;

      for (let wIdx = 0; wIdx < block.synonymBank.length; wIdx++) {
        const wordSyns = block.synonymBank[wIdx];
        const searchPart = block.text.toLowerCase().slice(charIdx);
        const wordStartInPart = searchPart.indexOf(wordSyns.original.toLowerCase());

        if (wordStartInPart === -1) continue;

        const wordStart = charIdx + wordStartInPart;
        const wordLen = wordSyns.original.length;

        const wordKey = `${block.id}:${wIdx}`;

        const wordConstraints: Record<string, Record<string, BrushType>> = {};
        for (const ph in overrides) {
          if (overrides[ph] && overrides[ph][wordKey]) {
            wordConstraints[ph] = overrides[ph][wordKey];
          }
        }

        if (Object.keys(wordConstraints).length > 0) {
          const validSyns = getValidSynonyms(wordSyns, wordConstraints);
          if (validSyns.length > 0) {
            let choices = validSyns.filter(s => s.text !== wordSyns.original);
            if (choices.length === 0) {
              choices = validSyns;
            }
            const randomIndex = Math.floor(Math.random() * choices.length);
            const chosen = choices[randomIndex].text;

            if (chosen !== wordSyns.original) {
              blockHasChanges = true;
              hasAnyChanges = true;

              let formattedChosen = chosen;
              const originalStr = block.text.substring(wordStart, wordStart + wordLen);
              if (originalStr.length > 0 && originalStr[0] === originalStr[0].toUpperCase() && originalStr[0] !== originalStr[0].toLowerCase()) {
                formattedChosen = chosen.charAt(0).toUpperCase() + chosen.slice(1);
              }

              newText += block.text.substring(lastReplacedCharIdx, wordStart) + formattedChosen;
              lastReplacedCharIdx = wordStart + wordLen;
            }
          }
        }
        charIdx = wordStart + wordLen;
      }

      if (blockHasChanges) {
        newText += block.text.substring(lastReplacedCharIdx); // append the rest of the string
        newBlocks[bIdx] = {
          ...block,
          text: newText,
          width: newText.length * PX_PER_CHAR,
          phonemes: undefined,
          isPhonemizing: false
        };
      }
    }

    return hasAnyChanges ? newBlocks : null;
  }, []);
  // Speculative Execution Hook (Debounced)
  useEffect(() => {
    const overrides = state.midiOverrides || {};
    if (Object.keys(overrides).length === 0) {
      speculativeBlocksRef.current = null;
      speculativeSignatureRef.current = null;
      return;
    }

    const signature = JSON.stringify({ texts: state.blocks.map(b => b.text), overrides });
    if (speculativeSignatureRef.current === signature) return;

    const timer = setTimeout(async () => {
      try {
        const newBlocks = await computeGeneration(state.blocks, overrides, true);
        if (newBlocks) {
          speculativeBlocksRef.current = newBlocks;
          speculativeSignatureRef.current = signature;
        }
      } catch (err) {
        console.error("Speculative execution error:", err);
      }
    }, 400); // 400ms debounce while user is actively drawing/dragging MIDI

    return () => clearTimeout(timer);
  }, [state.blocks, state.midiOverrides, computeGeneration]);

  const handleRegenerateText = useCallback(async () => {
    try {
      const overrides = state.midiOverrides || {};
      if (Object.keys(overrides).length === 0) return;
      logAction('REGENERATE_TEXT', { constraintCount: Object.keys(overrides).length });

      const signature = JSON.stringify({ texts: state.blocks.map(b => b.text), overrides });

      // If we already pre-calculated this exact state, apply instantly!
      if (speculativeSignatureRef.current === signature && speculativeBlocksRef.current) {
        dispatch({ type: 'SET_BLOCKS', blocks: speculativeBlocksRef.current });
        dispatch({ type: 'RESET_MIDI' });
        return;
      }

      // Otherwise compute with loading state
      const newBlocks = await computeGeneration(state.blocks, overrides, false);
      if (newBlocks) {
        dispatch({ type: 'SET_BLOCKS', blocks: newBlocks });
        dispatch({ type: 'RESET_MIDI' });
      }
    } catch (err) {
      console.error("Erreur de regénération sémantique:", err);
    }
  }, [state.blocks, state.midiOverrides, computeGeneration, dispatch, logAction]);

  const handleUpdateBlock = useCallback((id: string, text: string, width?: number) => {
    logAction('UPDATE_BLOCK', { id, textLength: text.length });
    // Auto-segment when the text contains sentence-ending punctuation followed by a space
    const segments = text.split(/(?<=[.:;!?\)\]\u2014])\s+/).filter(s => s.trim().length > 0);
    if (segments.length > 1) {
      const newBlocks = segments.map(t => createBlock(t.trim()));
      dispatch({ type: 'REPLACE_BLOCK_WITH_SEGMENTS', id, segments: newBlocks });
    } else {
      // Pass width directly so we only dispatch ONE action per keystroke
      dispatch({ type: 'UPDATE_BLOCK', id, text, width: width ?? text.length * PX_PER_CHAR });
    }
  }, [logAction]);

  const handleRemoveBlock = useCallback((id: string) => {
    logAction('REMOVE_BLOCK', { id });
    dispatch({ type: 'REMOVE_BLOCK', id });
  }, [logAction]);

  const handleMergeBlocks = useCallback(async (id1: string, id2: string) => {
    const b1 = state.blocks.find(b => b.id === id1);
    const b2 = state.blocks.find(b => b.id === id2);
    if (!b1 || !b2) return;

    // 1. Calculate combined width (including gap)
    const combinedWidth = b1.width + GAP_X + b2.width;

    // 2. Create a temporary merged block with the combined width
    const tempMergedBlock = createBlock("Merging...", combinedWidth);
    tempMergedBlock.isRegenerating = true;

    logAction('MERGE_START', { id1, id2 });

    // 3. Immediate UI update: replace the two blocks with the temporary one
    dispatch({ type: 'MERGE_BLOCKS', id1, id2, mergedBlock: tempMergedBlock });

    // 3. Call the LLM in the background
    try {
      logLLM('sent', { type: 'merge', t1: b1.text, t2: b2.text, lang: state.language });
      const mergedText = await mergeTexts(b1.text, b2.text, state.language);
      logLLM('received', { type: 'merge', text: mergedText });

      // Update with final text
      dispatch({ type: 'UPDATE_BLOCK', id: tempMergedBlock.id, text: mergedText, width: mergedText.length * PX_PER_CHAR, replaceHistory: true } as any);
    } catch (err) {
      console.error('Merge error:', err);
      dispatch({ type: 'UPDATE_BLOCK', id: tempMergedBlock.id, text: b1.text + " " + b2.text, width: (b1.text.length + 1 + b2.text.length) * PX_PER_CHAR, replaceHistory: true } as any);
    } finally {
      dispatch({ type: 'SET_BLOCK_LOADING', id: tempMergedBlock.id, isLoading: false, replaceHistory: true } as any);
    }
  }, [state.blocks, state.language]);

  const handleUpdateWidth = useCallback((id: string, width: number) => {
    dispatch({ type: 'UPDATE_BLOCK_WIDTH', id, width });
  }, []);

  const handleTimeStretch = useCallback(async (id: string) => {
    const block = state.blocks.find(b => b.id === id);
    if (!block) return;

    dispatch({ type: 'SET_BLOCK_LOADING', id, isLoading: true });

    try {
      const idx = state.blocks.indexOf(block);
      const contextBefore = state.blocks.slice(0, idx).map(b => b.text).join(' ').slice(-100);
      const contextAfter = state.blocks.slice(idx + 1).map(b => b.text).join(' ').slice(0, 100);

      const targetChars = Math.round(block.width / PX_PER_CHAR);

      const { timeStretchText } = await import('@/lib/llmClient');
      logLLM('sent', { type: 'time_stretch', text: block.text, targetChars, lang: state.language });
      const newText = await timeStretchText(
        block.text,
        targetChars,
        state.language,
        contextBefore,
        contextAfter
      );
      logLLM('received', { type: 'time_stretch', text: newText });

      logAction('TIME_STRETCH_FINISH', { id, newText });
      dispatch({ type: 'UPDATE_BLOCK', id, text: newText, replaceHistory: true } as any);
    } catch (err) {
      console.error('Time-Stretch error:', err);
    } finally {
      dispatch({ type: 'SET_BLOCK_LOADING', id, isLoading: false, replaceHistory: true } as any);
    }
  }, [state.blocks, state.language]);

  const handleTempoChange = useCallback((tempo: number) => {
    dispatch({ type: 'SET_TEMPO', tempo });
  }, []);

  const handleLanguageChange = useCallback((language: Language) => {
    dispatch({ type: 'SET_LANGUAGE', language });
  }, []);

  const handleImportText = useCallback((text: string) => {
    // Use the same segmentation logic as handleUpdateBlock
    const segments = text.split(/(?<=[.:;!?\)\]—])\s+/).filter(s => s.trim().length > 0);
    const newBlocks = segments.length > 0 ? segments.map(t => createBlock(t.trim())) : [createBlock(text)];
    dispatch({ type: 'SET_BLOCKS', blocks: newBlocks });
  }, []);

  const exportedText = useMemo(() => {
    return state.blocks.map(b => b.text).join(' ');
  }, [state.blocks]);

  const totalEstimatedTime = useMemo(() => {
    const totalChars = state.blocks.reduce((acc, b) => acc + b.text.length, 0);
    const totalSeconds = (totalChars * 10) / state.tempo;
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }, [state.blocks, state.tempo]);

  // ---- STT Logic ----
  const handleStartRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        sendToTranscription(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecordingSTT(true);
      logAction('STT_START');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone.');
    }
  }, [state.language]);

  const handleStopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecordingSTT) {
      mediaRecorderRef.current.stop();
      logAction('STT_STOP');
      setIsRecordingSTT(false);
    }
  }, [isRecordingSTT, logAction]);

  const sendToTranscription = async (blob: Blob) => {
    setIsTranscribing(true);
    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');

    const whisperLang = state.language === 'fr' ? 'french' : 'english';
    formData.append('language', whisperLang);

    try {
      const res = await fetch('/api/stt', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.text) {
        const newBlock = createBlock(data.text);
        dispatch({ type: 'ADD_BLOCK', block: newBlock });
        dispatch({ type: 'SELECT_BLOCK', id: newBlock.id });
      } else if (data.error) {
        console.error('STT Error:', data.error);
      }
    } catch (err) {
      console.error('STT Request Error:', err);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleMovePlayhead = useCallback((delta: number) => {
    // 1. Collect all word start positions
    const wordStarts: number[] = [];
    let currentPixelOffset = 0;
    for (const block of state.blocks) {
      if (block.synonymBank) {
        let charIdx = 0;
        for (const wordSyns of block.synonymBank) {
          const currentWord = wordSyns.currentText || wordSyns.original;
          const searchPart = block.text.toLowerCase().slice(charIdx);
          const wordStartInPart = searchPart.indexOf(currentWord.toLowerCase());
          if (wordStartInPart !== -1) {
            const wordStart = charIdx + wordStartInPart;
            wordStarts.push(currentPixelOffset + (wordStart * PX_PER_CHAR));
            charIdx = wordStart + currentWord.length;
          }
        }
      } else {
        // Fallback split
        const words = block.text.split(/\s+/).filter(w => w.length > 0);
        let charIdx = 0;
        for (const w of words) {
          const pos = block.text.indexOf(w, charIdx);
          if (pos !== -1) {
            wordStarts.push(currentPixelOffset + (pos * PX_PER_CHAR));
            charIdx = pos + w.length;
          }
        }
      }
      currentPixelOffset += block.width + GAP_X;
    }

    if (wordStarts.length === 0) return;

    // 2. Find current word index
    const currentPos = (window as any)._playheadPosition ?? INITIAL_PLAYHEAD_PADDING;
    // Find the first word start that is >= currentPos
    let currentWordIdx = wordStarts.findIndex(ws => ws >= currentPos);
    if (currentWordIdx === -1) currentWordIdx = wordStarts.length - 1;

    // 3. Target index
    let targetIdx = currentWordIdx + delta;
    targetIdx = Math.max(0, Math.min(wordStarts.length - 1, targetIdx));
    const targetPx = wordStarts[targetIdx];
    
    setPlayheadPosition(targetPx);
    
    if (state.isPlaying) {
      handlePlayPause(); // Stop
      setTimeout(() => handlePlayPause(), 50); // Restart from new pos
    }
    logAction('MOVE_PLAYHEAD_KEYBOARD', { delta, targetPx });
  }, [state.blocks, state.isPlaying, handlePlayPause, logAction]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const isEditing = active?.tagName === 'INPUT' ||
        active?.tagName === 'TEXTAREA' ||
        (active instanceof HTMLElement && active.isContentEditable);

      if (isEditing) return;

      if (e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleMovePlayhead(-3);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleMovePlayhead(3);
        return;
      }

      const isCmd = e.metaKey || e.ctrlKey;
      if (!isCmd) return;

      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          logAction('REDO');
          dispatch({ type: 'REDO' });
        } else {
          logAction('UNDO');
          dispatch({ type: 'UNDO' });
        }
      } else if (e.key.toLowerCase() === 'c') {
        if (state.selectedBlockId) {
          dispatch({ type: 'COPY_SELECTED_BLOCK' });
        }
      } else if (e.key.toLowerCase() === 'v') {
        if (state.copiedBlock) {
          dispatch({ type: 'PASTE_COPIED_BLOCK' });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.selectedBlockId, state.copiedBlock, dispatch, handlePlayPause, handleMovePlayhead]);

  // Escape key for Experience Exit
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isExperienceActive) {
          setShowExitModal(true);
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isExperienceActive]);

  const handleConfirmExit = async () => {
    const finalText = state.blocks.map(b => b.text).join(' ');
    await stopExperience(finalText);
    setShowExitModal(false);
  };

  return (
    <div className="app-container">
      <ControlBar
        isReadOnly={true}
        isPlaying={state.isPlaying}
        isRecordingSTT={isRecordingSTT}
        isTranscribing={isTranscribing}
        tempo={state.tempo}
        language={state.language}
        onPlayPause={handlePlayPause}
        onCut={handleCut}
        onTempoChange={handleTempoChange}
        onLanguageChange={handleLanguageChange}
        onSkipBack={() => handleMovePlayhead(-3)}
        onSkipForward={() => handleMovePlayhead(3)}
        onRegenerateText={handleRegenerateText}
        onOpenImport={() => setActiveModal('import')}
        onOpenExport={() => setActiveModal('export')}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
        isExperienceActive={isExperienceActive}
        onExitExperience={() => setShowExitModal(true)}
        canUndo={historyState.past.length > 0}
        canRedo={historyState.future.length > 0}
        onUndo={() => { logAction('UNDO'); dispatch({ type: 'UNDO' }); }}
        onRedo={() => { logAction('REDO'); dispatch({ type: 'REDO' }); }}
        phonemeSortMode={state.phonemeSortMode}
        onPhonemeSortChange={(mode) => dispatch({ type: 'SET_PHONEME_SORT_MODE', mode })}
      />

      <div className="timeline-area">
        <div className="timeline-scroll" ref={timelineRef} onWheel={handleWheel}>
          <div className="timeline-content" style={{ position: 'relative' }}>
            <TimelineRuler
              onTimelineClick={handleTimelineClick}
              totalWidth={10000} // Matches MidiTrackPanel extended width
            />
            {/* Playhead Overlay */}
            <div
              className="playhead-overlay"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: 100,
                right: 0,
                pointerEvents: 'none',
                zIndex: 100
              }}
            >
              <LoopRegion region={state.loopRegion} />
              <Playhead tempo={state.tempo} />
            </div>

            <TextTrack
              isReadOnly={true}
              blocks={state.blocks}
              selectedBlockId={state.selectedBlockId}
              onUpdateBlock={handleUpdateBlock}
              onSelectBlock={handleSelectBlock}
              onReorderBlocks={handleReorderBlocks}
              onSplitBlock={handleCut}
              onRemoveBlock={handleRemoveBlock}
              onMergeBlocks={handleMergeBlocks}
              onUpdateWidth={handleUpdateWidth}
              onTimeStretch={handleTimeStretch}
              language={state.language}
              highlightRangesMap={highlightRangesMap}
            />

            {!isExperienceActive && (
              <SynonymRow
                isReadOnly={true}
                blocks={state.blocks}
                midiOverrides={state.midiOverrides}
                onSelectSynonym={(blockId: string, wIdx: number, newWord: string) => {
                  dispatch({ type: 'SELECT_SYNONYM', id: blockId, wIdx, newWord });
                }}
              />
            )}

            <MidiTrackPanel
              isReadOnly={true}
              blocks={state.blocks}
              midiOverrides={state.midiOverrides}
              language={state.language}
              onToggleNote={handleToggleNote}
              onAuditionTrack={handleAuditionTrack}
              isPlaying={state.isPlaying}
              playingPhoneme={state.playingPhoneme}
              sortMode={state.phonemeSortMode}
              selectedPhonemes={selectedPhonemes}
              hoveredPhoneme={hoveredPhoneme}
              onLabelRightClick={handleLabelRightClick}
              onLabelHover={handleLabelHover}
            />
          </div>
        </div>
      </div>

      <div className="status-bar">
        <div className="status-bar__item">
          <div className={`status-bar__dot ${state.isPlaying ? '' : 'offline'}`} />
          <span>{state.isPlaying ? 'Playing' : 'Stopped'}</span>
        </div>
        <div className="status-bar__item">
          <span>{state.blocks.length} block{state.blocks.length !== 1 ? 's' : ''} ·{' '}
            {state.blocks.reduce((acc, b) => acc + b.text.length, 0)} chars ·{' '}
            ~{totalEstimatedTime} read ·{' '}
            {state.language.toUpperCase()}</span>
        </div>
      </div>

      {activeModal === 'import' && (
        <ImportModal
          onClose={() => setActiveModal(null)}
          onImport={handleImportText}
        />
      )}

      {activeModal === 'export' && (
        <ExportModal
          text={exportedText}
          onClose={() => setActiveModal(null)}
        />
      )}

      {showExitModal && (
        <ExitExperienceModal
          onClose={() => setShowExitModal(false)}
          onConfirm={handleConfirmExit}
        />
      )}
    </div>
  );
}
