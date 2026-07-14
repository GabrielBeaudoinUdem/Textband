declare module 'midi-writer-js' {
  export class Track {
    setTempo(tempo: number): this;
    addEvent(event: NoteEvent | ProgramChangeEvent, mapFunction?: () => void): this;
  }

  export class NoteEvent {
    constructor(options: {
      pitch: string | string[];
      duration: string | string[];
      velocity?: number;
      startTick?: number;
      channel?: number;
      repeat?: number;
      sequential?: boolean;
      wait?: string | string[];
    });
  }

  export class ProgramChangeEvent {
    constructor(options: { instrument: number });
  }

  export class Writer {
    constructor(tracks: Track | Track[]);
    dataUri(): string;
    stdout(): void;
    buildFile(): Uint8Array;
  }

  export default {
    Track: typeof Track,
    NoteEvent: typeof NoteEvent,
    Writer: typeof Writer,
    ProgramChangeEvent: typeof ProgramChangeEvent,
  };
}
