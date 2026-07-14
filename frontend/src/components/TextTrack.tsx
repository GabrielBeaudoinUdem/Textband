import React, { useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToFirstScrollableAncestor } from '@dnd-kit/modifiers';
import { Link } from 'lucide-react';
import type { TextBlock } from '@/types';
import TextBlockComponent from './TextBlock';

interface TextTrackProps {
  blocks: TextBlock[];
  selectedBlockId: string | null;
  onUpdateBlock: (id: string, text: string, width?: number) => void;
  onSelectBlock: (id: string | null) => void;
  onReorderBlocks: (activeId: string, overId: string) => void;
  onSplitBlock: (id: string, leftText: string, rightText: string) => void;
  onRemoveBlock: (id: string) => void;
  onMergeBlocks: (id1: string, id2: string) => void;
  onUpdateWidth: (id: string, width: number) => void;
  onTimeStretch: (id: string) => void;
  language: string;
  isReadOnly?: boolean;
  highlightRangesMap?: Record<string, { start: number; end: number; color: string }[]>;
}

export default function TextTrack({
  blocks,
  selectedBlockId,
  onUpdateBlock,
  onSelectBlock,
  onReorderBlocks,
  onSplitBlock,
  onRemoveBlock,
  onMergeBlocks,
  onUpdateWidth,
  onTimeStretch,
  language,
  isReadOnly,
  highlightRangesMap,
}: TextTrackProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // Allow some movement for clicks
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorderBlocks(active.id.toString(), over.id.toString());
    }
  };

  const blockIds = useMemo(() => blocks.map(b => b.id), [blocks]);

  return (
    <div className="text-track">
      <div className="text-track__label" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
        TEXT
      </div>
      
      <div className="text-track__blocks">
        <DndContext
          id="text-track-dnd"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToFirstScrollableAncestor]}
        >
          <SortableContext items={blockIds} strategy={horizontalListSortingStrategy}>
            {blocks.map((block, idx) => (
              <React.Fragment key={block.id}>
                <TextBlockComponent
                  block={block}
                  isSelected={selectedBlockId === block.id}
                  onUpdate={onUpdateBlock}
                  onSelect={onSelectBlock}
                  onSplit={onSplitBlock}
                  onRemove={onRemoveBlock}
                  onUpdateWidth={onUpdateWidth}
                  onTimeStretch={onTimeStretch}
                  language={language}
                  isReadOnly={isReadOnly}
                  highlightRanges={highlightRangesMap?.[block.id]}
                />
                {idx < blocks.length - 1 && !isReadOnly && (
                  <div className="merge-gap">
                    <button 
                      className="merge-button"
                      title="Merge blocks"
                      onClick={() => onMergeBlocks(block.id, blocks[idx+1].id)}
                    >
                      <Link size={14} />
                    </button>
                  </div>
                )}
              </React.Fragment>
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
