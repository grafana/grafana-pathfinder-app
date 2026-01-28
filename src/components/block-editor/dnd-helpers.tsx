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
    userSelect: 'none',
    '&:active': {
      cursor: 'grabbing',
    },
  }),
  dragging: css({
    // Original element becomes a faded placeholder showing "source position"
    opacity: 0.5,
    cursor: 'grabbing !important',
    // Dashed border indicates this is where the item came from
    outline: '2px dashed currentColor',
    outlineOffset: '-2px',
    '& *': {
      cursor: 'grabbing !important',
    },
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
    boxShadow: `0 0 12px ${theme.colors.primary.main}, 0 0 4px ${theme.colors.primary.main}`,
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
  passThrough = false,
}: {
  id: string;
  data: DragData;
  disabled: boolean;
  children: React.ReactNode;
  /** When true, this block is invisible to collision detection (pointer events pass through) */
  passThrough?: boolean;
}) {
  const sortableStyles = useStyles2(getSortableStyles);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data,
    disabled: disabled || passThrough,
  });

  // Don't apply sortable transforms - we use drop zones for positioning feedback instead
  // This prevents the confusing "sortable reorder" visual that conflicts with drop zones
  const style: React.CSSProperties = {
    // Only apply transform for nested blocks (within sections), not root blocks
    // Root blocks use drop zones exclusively for position feedback
    transform: data.type === 'root' ? undefined : CSS.Transform.toString(transform),
    transition: data.type === 'root' ? undefined : transition,
    ...(passThrough ? { pointerEvents: 'none' as const } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cx(sortableStyles.sortableItem, isDragging && sortableStyles.dragging)}
      {...(passThrough ? {} : { ...attributes, ...listeners })}
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
  enlarged = false,
}: {
  id: string;
  data: DropZoneData;
  isActive: boolean;
  label: string;
  /** When true, increases the hit area for easier targeting (e.g., when dragging sections) */
  enlarged?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data });

  return (
    <div ref={setNodeRef} style={{ padding: enlarged ? '16px 0' : '6px 0' }}>
      <DropIndicator isActive={isActive || isOver} label={label} />
    </div>
  );
}

/**
 * Check if a drop zone is redundant (immediately before or after the dragged item)
 * This prevents showing "move here" markers that would result in no movement.
 */
export function isInsertZoneRedundant(
  activeDragData: DragData | null,
  zoneType: 'section-insert' | 'conditional-insert' | 'root-zone',
  zoneIndex: number,
  zoneSectionId?: string,
  zoneConditionalId?: string,
  zoneBranch?: 'whenTrue' | 'whenFalse'
): boolean {
  if (!activeDragData) {
    return false;
  }

  // For root zones, check against root blocks
  if (zoneType === 'root-zone' && activeDragData.type === 'root') {
    return zoneIndex === activeDragData.index || zoneIndex === activeDragData.index + 1;
  }

  // For section insert zones, check against nested blocks in the same section
  if (zoneType === 'section-insert' && activeDragData.type === 'nested') {
    if (activeDragData.sectionId === zoneSectionId) {
      return zoneIndex === activeDragData.index || zoneIndex === activeDragData.index + 1;
    }
  }

  // For conditional insert zones, check against blocks in the same conditional branch
  if (zoneType === 'conditional-insert' && activeDragData.type === 'conditional') {
    if (activeDragData.conditionalId === zoneConditionalId && activeDragData.branch === zoneBranch) {
      return zoneIndex === activeDragData.index || zoneIndex === activeDragData.index + 1;
    }
  }

  return false;
}

// Add display names for debugging
SortableBlock.displayName = 'SortableBlock';
DropIndicator.displayName = 'DropIndicator';
DroppableInsertZone.displayName = 'DroppableInsertZone';
