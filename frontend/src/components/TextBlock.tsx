import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Wand2 } from 'lucide-react';
import type { TextBlock } from '@/types';
import { timeStretchText } from '@/lib/llmClient';
import { PX_PER_CHAR } from '@/lib/constants';

interface HighlightRange {
  start: number;
  end: number;
  color: string;
}

interface TextBlockProps {
  block: TextBlock;
  isSelected: boolean;
  onUpdate: (id: string, newText: string, newWidth?: number) => void;
  onSelect: (id: string | null) => void;
  onSplit: (id: string, leftText: string, rightText: string) => void;
  onRemove: (id: string) => void;
  onUpdateWidth: (id: string, width: number) => void;
  onTimeStretch: (id: string) => void;
  language: string;
  isReadOnly?: boolean;
  highlightRanges?: HighlightRange[];
}

export default function TextBlockComponent({
  block,
  isSelected,
  onUpdate,
  onSelect,
  onSplit,
  onRemove,
  onUpdateWidth,
  onTimeStretch,
  language,
  isReadOnly,
  highlightRanges,
}: TextBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [localText, setLocalText] = useState(block.text);
  const contentRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const tempCursorPos = useRef<number | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: block.id });

  // Helper to save cursor position
  const saveCursorPosition = useCallback(() => {
    if (typeof window === 'undefined' || !contentRef.current) return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const preSelectionRange = range.cloneRange();
      preSelectionRange.selectNodeContents(contentRef.current);
      preSelectionRange.setEnd(range.startContainer, range.startOffset);
      tempCursorPos.current = preSelectionRange.toString().length;
    }
  }, []);

  // Helper to restore cursor position
  const restoreCursorPosition = useCallback(() => {
    if (typeof window === 'undefined' || tempCursorPos.current === null || !contentRef.current) return;

    let charIndex = 0;
    const range = document.createRange();
    range.setStart(contentRef.current, 0);
    range.collapse(true);

    const nodeStack: Node[] = [contentRef.current];
    let node: Node | undefined;
    let foundStart = false;

    while ((node = nodeStack.pop())) {
      if (node.nodeType === 3) {
        const nextCharIndex = charIndex + (node.nodeValue?.length || 0);
        if (!foundStart && tempCursorPos.current >= charIndex && tempCursorPos.current <= nextCharIndex) {
          range.setStart(node, tempCursorPos.current - charIndex);
          range.setEnd(node, tempCursorPos.current - charIndex);
          foundStart = true;
          break;
        }
        charIndex = nextCharIndex;
      } else {
        let i = node.childNodes.length;
        while (i--) {
          nodeStack.push(node.childNodes[i]);
        }
      }
    }

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    tempCursorPos.current = null;
  }, []);

  // Sync prop changes (e.g. LLM regeneration) back to local state
  useEffect(() => {
    if (!contentRef.current) return;

    // IMPORTANT: If we are currently editing, we don't want to update the DOM
    // from the props unless it's a SIGNIFICANT external change (like LLM sync)
    // because the user's local keystrokes are already in the DOM.
    const isExternalUpdate = block.text !== localText;

    if (isExternalUpdate) {
      if (document.activeElement === contentRef.current) {
        // If the user has focus, we only overwrite if there's a huge difference (e.g. LLM regeneration)
        // OR if it's the first time we set the content.
        // We use innerText comparison to avoid unnecessary DOM updates.
        if (Math.abs(contentRef.current.innerText.length - block.text.length) > 5 || contentRef.current.innerText === "") {
          saveCursorPosition();
          contentRef.current.innerText = block.text;
          restoreCursorPosition();
          setLocalText(block.text);
        }
      } else {
        // Not editing: safe to overwrite
        contentRef.current.innerText = block.text;
        setLocalText(block.text);
      }
    }
  }, [block.text, localText, saveCursorPosition, restoreCursorPosition]);

  // Build highlighted HTML from highlight ranges
  const highlightedHtml = useMemo(() => {
    if (!highlightRanges || highlightRanges.length === 0) return null;
    const text = block.text;
    if (!text) return null;
    
    // Build a map of charIndex -> colors
    const charColors: (string | null)[] = new Array(text.length).fill(null);
    for (const range of highlightRanges) {
      for (let i = Math.floor(range.start); i < Math.min(Math.ceil(range.end), text.length); i++) {
        charColors[i] = range.color;
      }
    }
    
    // Group consecutive chars with same color into spans
    let html = '';
    let i = 0;
    while (i < text.length) {
      const color = charColors[i];
      let j = i;
      while (j < text.length && charColors[j] === color) j++;
      const segment = text.slice(i, j)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (color) {
        html += `<span style="background:${color};border-radius:2px">${segment}</span>`;
      } else {
        html += segment;
      }
      i = j;
    }
    return html;
  }, [block.text, highlightRanges]);

  // Apply highlighted HTML when not editing
  useEffect(() => {
    if (!contentRef.current || isEditing) return;
    if (highlightedHtml) {
      contentRef.current.innerHTML = highlightedHtml;
    } else {
      // Restore plain text (if highlights were removed)
      contentRef.current.innerText = block.text;
    }
  }, [highlightedHtml, isEditing, block.text]);

  // Ensure initial content is set
  useEffect(() => {
    if (contentRef.current && contentRef.current.innerText === "" && block.text !== "") {
      contentRef.current.innerText = block.text;
    }
  }, []);

  // Handle focus when entering edit mode
  useEffect(() => {
    if (isEditing && contentRef.current) {
      contentRef.current.focus();
      // Move cursor to end if it was just triggered
      const sel = window.getSelection();
      if (sel && sel.rangeCount === 0) {
        const range = document.createRange();
        range.selectNodeContents(contentRef.current);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }, [isEditing]);

  const handleInput = () => {
    if (!contentRef.current) return;
    const newText = contentRef.current.innerText;

    // Update local state without re-rendering the content (since it's already in the DOM)
    setLocalText(newText);

    // Pass new width alongside text so the parent dispatches a SINGLE action
    // (instead of UPDATE_BLOCK + UPDATE_BLOCK_WIDTH = 2 full re-renders per keystroke)
    const newWidth = newText.length * PX_PER_CHAR;
    onUpdate(block.id, newText, newWidth);
  };

  const handleFocus = () => {
    onSelect(block.id);
  };

  const handleBlur = () => {
    setIsEditing(false);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isReadOnly) return;
    e.stopPropagation();
    setIsEditing(true);
    onSelect(block.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isReadOnly) return;

    // If we're currently editing, Enter/Shift-Enter handle line breaks or blur
    if (isEditing) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        contentRef.current?.blur();
      }
      return;
    }

    // If NOT editing but block is focused/selected, handle deletion
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      onRemove(block.id);
    }
  };

  // Focus the container when selected to capture keyboard events
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isSelected && !isEditing) {
      containerRef.current?.focus();
    }
  }, [isSelected, isEditing]);

  // -- Resize Handlers --
  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    if (isReadOnly) return;
    // We don't preventDefault here to allow focus if needed, but we stopPropagation
    // to prevent dnd-kit from starting a drag.
    e.stopPropagation();

    // Capture the pointer to ensure we get events even outside the handle
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);

    setIsResizing(true);
    resizeRef.current = {
      startX: e.clientX,
      startWidth: block.width
    };
    onSelect(block.id);
  }, [block.width, block.id, onSelect]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!resizeRef.current) return;
      const deltaX = e.clientX - resizeRef.current.startX;
      const rawNewWidth = resizeRef.current.startWidth + deltaX;
      // Snap to character grid (PX_PER_CHAR)
      const snappedWidth = Math.max(PX_PER_CHAR, Math.round(rawNewWidth / PX_PER_CHAR) * PX_PER_CHAR);
      onUpdateWidth(block.id, snappedWidth);
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isResizing, block.id, onUpdateWidth]);

  // -- Density Calculation --
  const density = useMemo(() => {
    const naturalWidth = block.text.length * PX_PER_CHAR;
    if (block.width === 0) return 1;
    return naturalWidth / block.width;
  }, [block.text, block.width]);

  // Color mapping for density
  const densityColor = useMemo(() => {
    if (density > 1.3) return '#ff4d4d'; // Too dense (rushed)
    if (density < 0.7) return '#4da6ff'; // Too sparse (dragging)
    return '#4dff88'; // Natural
  }, [density]);

  const handleTimeStretch = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (block.isRegenerating) return;
    onTimeStretch(block.id);
  }, [block.id, block.isRegenerating, onTimeStretch]);

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    width: block.width,
    position: 'relative',
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 100 : 1,
  };

  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        (containerRef as any).current = node;
      }}
      style={style}
      className={`text-block ${isSelected ? 'selected' : ''} ${isDragging ? 'is-dragging' : ''} ${isEditing ? 'is-editing' : ''} ${block.isRegenerating ? 'is-loading' : ''} ${isReadOnly ? 'is-readonly' : ''}`}
      {...(!isEditing && !isResizing && !block.isRegenerating && !isReadOnly ? attributes : {})}
      {...(!isEditing && !isResizing && !block.isRegenerating && !isReadOnly ? listeners : {})}
      onDoubleClick={!block.isRegenerating && !isReadOnly ? handleDoubleClick : undefined}
      onKeyDown={!block.isRegenerating ? handleKeyDown : undefined}
      tabIndex={block.isRegenerating ? -1 : 0}
      onClick={(e) => {
        if (block.isRegenerating || isReadOnly) return;
        e.stopPropagation();
        onSelect(block.id);
      }}
    >
      <div
        ref={contentRef}
        className="text-block__content"
        data-block-id={block.id}
        contentEditable={isEditing && !block.isRegenerating}
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={(e) => (isEditing || isResizing || block.isRegenerating) && e.stopPropagation()}
        spellCheck={false}
      />

      {!isReadOnly && (
        <div
          className="text-block__resize-handle"
          onPointerDown={handleResizeStart}
        />
      )}

      {!isReadOnly && (density > 1.05 || density < 0.95) && !block.isRegenerating && (
        <button
          className="text-block__wand-btn"
          title="Time-Stretch: Rewrite text to fit this duration"
          onClick={handleTimeStretch}
        >
          <Wand2 size={12} />
        </button>
      )}

      {block.isRegenerating && (
        <div className="text-block__loading-overlay">
          <div className="shimmer" />
        </div>
      )}
    </div>
  );
}
