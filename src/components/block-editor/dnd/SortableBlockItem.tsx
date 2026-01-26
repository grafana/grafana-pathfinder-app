/**
 * Sortable Block Item
 *
 * Wrapper component that makes a block item draggable/sortable
 * using @dnd-kit. Works for both root-level and nested blocks.
 */

import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { css, cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import type { DragData } from './DndProvider';

const getStyles = (theme: GrafanaTheme2) => ({
  sortableItem: css({
    // Ensure proper cursor during drag
    cursor: 'grab',
    touchAction: 'none',

    '&:active': {
      cursor: 'grabbing',
    },
  }),
  dragging: css({
    opacity: 0.5,
    cursor: 'grabbing',
    // Add subtle scale for visual feedback
    transform: 'scale(1.02)',
    zIndex: 10,
  }),
  dragOver: css({
    // Visual feedback when something is being dragged over this item
    '&::before': {
      content: '""',
      position: 'absolute',
      top: '-4px',
      left: 0,
      right: 0,
      height: '4px',
      backgroundColor: theme.colors.primary.main,
      borderRadius: '2px',
      boxShadow: `0 0 8px ${theme.colors.primary.main}`,
    },
  }),
});

export interface SortableBlockItemProps {
  /** Unique ID for sorting */
  id: string;
  /** Data attached to this sortable item */
  data: DragData;
  /** Whether dragging is disabled */
  disabled?: boolean;
  /** Child content to render */
  children: React.ReactNode;
  /** Additional className */
  className?: string;
}

/**
 * Sortable wrapper for block items
 *
 * Provides drag-and-drop functionality using @dnd-kit's useSortable hook.
 * Handles transform and transition styles automatically.
 */
export function SortableBlockItem({ id, data, disabled = false, children, className }: SortableBlockItemProps) {
  const styles = useStyles2(getStyles);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    data,
    disabled,
  });

  // Apply transform and transition styles from @dnd-kit
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: 'relative', // For the dragOver indicator
  };

  // Combine classes
  const itemClass = cx(styles.sortableItem, isDragging && styles.dragging, isOver && styles.dragOver, className);

  return (
    <div ref={setNodeRef} style={style} className={itemClass} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

SortableBlockItem.displayName = 'SortableBlockItem';
