'use client';

import React, { useEffect, useRef } from 'react';
import { INITIAL_PLAYHEAD_PADDING, PX_PER_CHAR } from '@/lib/constants';

interface PlayheadProps {
  tempo: number;
}

/**
 * Event-based playhead update to avoid re-rendering the whole app
 */
export function setPlayheadPosition(px: number) {
  if (typeof window !== 'undefined') {
    (window as any)._playheadPosition = px;
    window.dispatchEvent(new CustomEvent('playhead-move', { detail: px }));
  }
}

export default function Playhead({ tempo }: PlayheadProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    const updateTimeLabel = (pos: number) => {
      // Time label removed by user request
    };

    const handleMove = (e: any) => {
      const pos = e.detail;
      if (ref.current && !isDragging.current) {
        ref.current.style.left = `${pos}px`;
        updateTimeLabel(pos);

        // Auto-scroll logic (Keep playhead at ~25% from left to show look-ahead)
        const timelineEl = ref.current.closest('.timeline-scroll');
        if (timelineEl) {
          const actualX = pos + 100; // Account for the 100px label area
          const scrollLeft = timelineEl.scrollLeft;
          const width = timelineEl.clientWidth;
          const targetXInView = width * 0.6; // 25% of view from left

          if (actualX > scrollLeft + targetXInView) {
            timelineEl.scrollLeft = actualX - targetXInView;
          } else if (actualX < scrollLeft) {
            timelineEl.scrollLeft = Math.max(0, actualX - targetXInView);
          }
        }
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !ref.current) return;

      const timelineEl = ref.current.closest('.timeline-scroll');
      if (!timelineEl) return;

      const rect = timelineEl.getBoundingClientRect();
      const x = e.clientX - rect.left + timelineEl.scrollLeft;
      const pos = Math.max(0, x - 100);

      ref.current.style.left = `${pos}px`;
      updateTimeLabel(pos);
      setPlayheadPosition(pos);

      // Auto-scroll while dragging
      const actualX = pos + 100;
      const scrollLeft = timelineEl.scrollLeft;
      const width = timelineEl.clientWidth;
      const margin = 50;
      if (actualX > scrollLeft + width - margin) {
        timelineEl.scrollLeft += 10; // Scroll right
      } else if (actualX < scrollLeft + margin) {
        timelineEl.scrollLeft -= 10; // Scroll left
      }
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      // Only drag if it's a left click
      if (e.button !== 0) return;

      isDragging.current = true;
      document.body.style.cursor = 'col-resize';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      // Prevent text selection while dragging
      e.preventDefault();
    };

    window.addEventListener('playhead-move', handleMove);

    const playheadEl = ref.current;
    if (playheadEl) {
      playheadEl.addEventListener('mousedown', handleMouseDown);
    }

    // Set initial position
    const initialPos = (window as any)._playheadPosition ?? INITIAL_PLAYHEAD_PADDING;
    if (ref.current) {
      ref.current.style.left = `${initialPos}px`;
      updateTimeLabel(initialPos);
    }

    return () => {
      window.removeEventListener('playhead-move', handleMove);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (playheadEl) {
        playheadEl.removeEventListener('mousedown', handleMouseDown);
      }
    };
  }, [tempo]);

  return (
    <div
      ref={ref}
      className="playhead"
    />
  );
}
