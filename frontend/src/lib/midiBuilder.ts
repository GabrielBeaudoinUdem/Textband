import { Track, NoteEvent, Writer } from 'midi-writer-js';
import type { PhonemeEvent, MidiLane, Language } from '@/types';
import { getPhonemeOrder, isVowel } from './phonemizer';

/**
 * Group phoneme events into MIDI lanes (one per unique phoneme row).
 */
export function buildMidiLanes(
  events: PhonemeEvent[],
  language: Language
): MidiLane[] {
  const order = getPhonemeOrder(language);
  const laneMap = new Map<number, MidiLane>();

  for (const evt of events) {
    if (!laneMap.has(evt.row)) {
      laneMap.set(evt.row, {
        phoneme: evt.phoneme,
        row: evt.row,
        events: [],
      });
    }
    laneMap.get(evt.row)!.events.push(evt);
  }

  // Return sorted by row index
  return Array.from(laneMap.values()).sort((a, b) => a.row - b.row);
}

/**
 * Map a phoneme row index to a MIDI pitch.
 * We start at C2 (MIDI 36) and go up chromatically.
 */
function rowToPitch(row: number): string {
  const midiBase = 36; // C2
  const midiNote = midiBase + row;
  // Convert MIDI number to note name
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
}

/**
 * Generate a MIDI file from phoneme events.
 * Returns a data URI that can be used for download.
 */
export function generateMidiFile(
  events: PhonemeEvent[],
  language: Language,
  tempo: number = 120
): string {
  const order = getPhonemeOrder(language);
  const track = new Track();
  track.setTempo(tempo);

  // Sort events by start position
  const sorted = [...events].sort((a, b) => a.startChar - b.startChar);

  for (const evt of sorted) {
    const pitch = rowToPitch(evt.row);
    
    // Rhythmic heuristic: vowels are usually longer than consonants
    const isV = isVowel(evt.phoneme, language);
    const duration = isV ? '8' : '16'; // eighth for vowels, sixteenth for consonants

    track.addEvent(
      new NoteEvent({
        pitch: [pitch],
        duration: duration,
      })
    );
  }

  const write = new Writer([track]);
  return write.dataUri();
}

/**
 * Build the full MIDI visualization data from text blocks.
 */
export function buildMidiFromBlocks(
  blocks: { id: string; text: string }[],
  language: Language,
  textToPhonemesFn: (text: string, lang: Language, blockId: string) => PhonemeEvent[]
): { lanes: MidiLane[]; allEvents: PhonemeEvent[] } {
  const allEvents: PhonemeEvent[] = [];

  for (const block of blocks) {
    const events = textToPhonemesFn(block.text, language, block.id);
    allEvents.push(...events);
  }

  const lanes = buildMidiLanes(allEvents, language);
  return { lanes, allEvents };
}
