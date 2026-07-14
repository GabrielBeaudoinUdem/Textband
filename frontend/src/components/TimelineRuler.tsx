'use client';

import React, { useRef } from 'react';
import { setPlayheadPosition } from './Playhead';

interface TimelineRulerProps {
  onTimelineClick: (e: React.MouseEvent) => void;
  totalWidth: number;
}

export default function TimelineRuler({ onTimelineClick, totalWidth }: TimelineRulerProps) {
  const rulerRef = useRef<HTMLDivElement>(null);

  // We reuse the page's handleTimelineClick but scoped to this ruler
  // However, handleTimelineClick in page.tsx expects to be on timelineRef
  // So we calculate the position relative to the ruler here instead.
  
  const handleClick = (e: React.MouseEvent) => {
    // We let the parent handle the actual logic (loop region vs playhead)
    // but ensure the target is scoped.
    onTimelineClick(e);
  };

  return (
    <div 
      className="timeline-ruler"
      onClick={handleClick}
      style={{
        height: '24px',
        width: totalWidth || '100%',
        background: 'var(--bg-surface-raised)',
        borderBottom: '1px solid var(--border-medium)',
        position: 'relative',
        cursor: 'pointer',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: '0px'
      }}
    >
      <div className="timeline-ruler__ticks" style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'none',
        backgroundImage: 'linear-gradient(to right, var(--border-subtle) 1px, transparent 1px)',
        backgroundSize: '100px 100%', // Major ticks every 100px
      }} />
    </div>
  );
}
