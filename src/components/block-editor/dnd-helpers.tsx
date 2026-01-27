/**
 * DnD Helpers
 *
 * Shared components and types for @dnd-kit drag-and-drop functionality
 * used across BlockList, SectionNestedBlocks, and ConditionalBranches.
 */

import React from 'react';
import { useStyles2 } from '@grafana/ui';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

/**
 * Data attached to draggable items for @dnd-kit
 */
export interface DragData {
  type: 'root' | 'nested' | 'conditional';
  blockType: string;
  index: number;
  sectionId?: string;
  conditionalId?: string;
  branch?: 'whenTrue' | 'whenFalse';
}

/**
 * Data attached to droppable zones for @dnd-kit.
 * Using structured data eliminates ID parsing and makes the implementation type-safe.
 */
export interface DropZoneData {
  type: 'root-zone' | 'section-drop' | 'section-insert' | 'conditional-drop' | 'conditional-insert';
  index?: number;
  sectionId?: string;
  conditionalId?: string;
  branch?: 'whenTrue' | 'whenFalse';
}

/**
 * Styles for @dnd-kit sortable items
 */
export const getSortableStyles = (theme: GrafanaTheme2) => ({
  sortableItem: css({
    cursor: 'grab',
    touchAction: 'none',
    '&:active': {
      cursor: 'grabbing',
    },
  }),
  dragging: css({
    opacity: 0.4,
    cursor: 'grabbing',
  }),
  dropIndicator: css({
    position: 'relative',
    padding: theme.spacing(0.5),
    transition: 'all 0.15s ease',
  }),
  dropIndicatorLine: css({
    height: '2px',
    backgroundColor: theme.colors.border.medium,
    borderRadius: '2px',
    transition: 'all 0.15s ease',
  }),
  dropIndicatorLineActive: css({
    height: '4px',
    backgroundColor: theme.colors.primary.main,
    boxShadow: `0 0 8px ${theme.colors.primary.main}`,
  }),
  dropIndicatorLabel: css({
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    padding: `${theme.spacing(0.5)} ${theme.spacing(1.5)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: theme.shape.radius.pill,
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    whiteSpace: 'nowrap',
    boxShadow: theme.shadows.z2,
    zIndex: 1,
  }),
});

/**
 * Sortable wrapper for block items
 */
export function SortableBlock({
  id,
  data,
  disabled,
  children,
}: {
  id: string;
  data: DragData;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const sortableStyles = useStyles2(getSortableStyles);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(sortableStyles.sortableItem, isDragging && sortableStyles.dragging)}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/**
 * Drop indicator component
 */
export function DropIndicator({ isActive, label }: { isActive: boolean; label: string }) {
  const sortableStyles = useStyles2(getSortableStyles);
  return (
    <div className={sortableStyles.dropIndicator}>
      <div className={cx(sortableStyles.dropIndicatorLine, isActive && sortableStyles.dropIndicatorLineActive)} />
      {isActive && <div className={sortableStyles.dropIndicatorLabel}>{label}</div>}
    </div>
  );
}

/**
 * Droppable insert zone component using @dnd-kit
 */
export function DroppableInsertZone({
  id,
  data,
  isActive,
  label,
}: {
  id: string;
  data: DropZoneData;
  isActive: boolean;
  label: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });

  return (
    <div ref={setNodeRef} style={{ padding: '6px 0' }}>
      <DropIndicator isActive={isActive || isOver} label={label} />
    </div>
  );
}

// Add display names for debugging
SortableBlock.displayName = 'SortableBlock';
DropIndicator.displayName = 'DropIndicator';
DroppableInsertZone.displayName = 'DroppableInsertZone';
