'use client';

import React from 'react';

interface LoopRegionProps {
  region: [number, number] | null;
}

export default function LoopRegion({ region }: LoopRegionProps) {
  if (!region) return null;

  const [start, end] = region;
  const width = Math.max(0, end - start);

  return (
    <div 
      className="loop-region" 
      style={{ 
        position: 'absolute',
        left: start,
        width: width,
        height: '100%',
        backgroundColor: 'rgba(74, 158, 255, 0.2)',
        borderLeft: '2px solid rgba(74, 158, 255, 0.8)',
        borderRight: '2px solid rgba(74, 158, 255, 0.8)',
        pointerEvents: 'none',
        zIndex: 5
      }}
    >
      <div className="loop-region__label" style={{
        position: 'absolute',
        top: -20,
        left: 0,
        backgroundColor: 'rgba(74, 158, 255, 0.8)',
        color: 'white',
        fontSize: '10px',
        padding: '2px 4px',
        borderRadius: '2px',
        whiteSpace: 'nowrap'
      }}>
        LOOP
      </div>
    </div>
  );
}
