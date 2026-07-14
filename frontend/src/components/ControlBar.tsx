import {
  Play,
  Pause,

  Scissors,
  Download,
  Upload,
  Mic,
  Loader2,
  LogOut,
  Pencil,
  Undo2,
  Redo2,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import type { Language, BrushType, PhonemeSortMode } from '@/types';

interface ControlBarProps {
  isPlaying: boolean;
  isRecordingSTT: boolean;
  isTranscribing: boolean;
  tempo: number;
  language: Language;
  onPlayPause: () => void;
  onCut: () => void;
  onTempoChange: (tempo: number) => void;
  onLanguageChange: (lang: Language) => void;
  onSkipBack: () => void;
  onSkipForward: () => void;

  onRegenerateText: () => void;
  onOpenImport: () => void;
  onOpenExport: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  isExperienceActive?: boolean;
  onExitExperience?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  isReadOnly?: boolean;
  phonemeSortMode: PhonemeSortMode;
  onPhonemeSortChange: (mode: PhonemeSortMode) => void;
}

export default function ControlBar({
  isPlaying,
  tempo,
  language,
  onPlayPause,
  onCut,
  onTempoChange,
  onLanguageChange,
  onSkipBack,
  onSkipForward,

  onRegenerateText,
  onOpenImport,
  onOpenExport,
  isRecordingSTT,
  isTranscribing,
  onStartRecording,
  onStopRecording,
  isExperienceActive,
  onExitExperience,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  isReadOnly,
  phonemeSortMode,
  onPhonemeSortChange,
}: ControlBarProps) {
  return (
    <div className="control-bar">
      <div className="control-bar__left">
        <span className="control-bar__title">TextBand</span>

        <div className="control-bar__divider" />

        <div className="tempo-input" style={{ minWidth: '120px' }}>
          <span className="tempo-input__label">Order</span>
          <select
            className="select"
            value={phonemeSortMode}
            onChange={(e) => onPhonemeSortChange(e.target.value as PhonemeSortMode)}
          >
            <option value="default">Standard</option>
            <option value="popularity-lang">Popularity (Lang)</option>
            <option value="popularity-text">Popularity (Text)</option>
            <option value="selected">Selected</option>
          </select>
        </div>

        <div className="control-bar__divider" />

        <div className="tempo-input">
          <span className="tempo-input__label">word minute</span>
          <input
            type="number"
            className="tempo-input__value"
            value={tempo}
            min={60}
            max={400}
            onChange={(e) => onTempoChange(Number(e.target.value))}
          />
        </div>
      </div>

      {/* CENTER section: Transport controls */}
      <div className="control-bar__center">
        {!isReadOnly && (
          <>
            <button
              className={`btn btn--transport ${isRecordingSTT ? 'recording-active' : ''} ${isTranscribing ? 'is-loading' : ''}`}
              onClick={isRecordingSTT ? onStopRecording : onStartRecording}
              disabled={isTranscribing}
              title={isRecordingSTT ? 'Stop Recording' : 'Voice to Text (STT)'}
            >
              {isTranscribing ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Mic size={20} fill={isRecordingSTT ? "currentColor" : "none"} />
              )}
            </button>

            <button
              className="btn btn--transport"
              onClick={onCut}
              title="Cut"
            >
              <Scissors size={20} />
            </button>

            <div className="control-bar__divider" />
          </>
        )}

        <button
          className="btn btn--transport"
          onClick={onSkipBack}
          title="Skip Backward"
        >
          <RotateCcw size={24} />
        </button>

        <button
          className={`btn btn--transport ${isPlaying ? 'active' : ''}`}
          onClick={onPlayPause}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? (
            <Pause size={32} fill="currentColor" />
          ) : (
            <Play size={32} fill="currentColor" />
          )}
        </button>

        <button
          className="btn btn--transport"
          onClick={onSkipForward}
          title="Skip Forward"
        >
          <RotateCw size={24} />
        </button>

        {!isReadOnly && (
          <>
            <div className="control-bar__divider" />

            <button
              className="btn btn--transport"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Cmd+Z)"
            >
              <Undo2 size={20} />
            </button>

            <button
              className="btn btn--transport"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Cmd+Shift+Z)"
            >
              <Redo2 size={20} />
            </button>
          </>
        )}
      </div>

      {/* RIGHT section: Import / Export */}
      <div className="control-bar__right">

        <div className="control-bar__divider" />

        <button className="btn btn--icon-ghost" title="Import" onClick={onOpenImport}>
          <Download size={16} />
        </button>
        <button className="btn btn--icon-ghost" title="Export" onClick={onOpenExport}>
          <Upload size={16} />
        </button>

        {isExperienceActive && (
          <>
            <div className="control-bar__divider" />
            <button
              className="btn btn--exit"
              title="Quit experience"
              onClick={onExitExperience}
            >
              <LogOut size={16} />
              <span>Quit</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

