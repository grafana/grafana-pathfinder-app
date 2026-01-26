/**
 * Droppable Zone
 *
 * A drop zone component for sections and conditional branches.
 * Provides visual feedback when items are dragged over it.
 */

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { css, cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';

const getStyles = (theme: GrafanaTheme2) => ({
  dropZone: css({
    minHeight: '56px',
    border: `2px dashed ${theme.colors.border.medium}`,
    borderRadius: theme.shape.radius.default,
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.secondary,
    transition: 'all 0.2s ease',
    cursor: 'pointer',
    marginTop: theme.spacing(1),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',

    '&:hover': {
      borderColor: theme.colors.primary.border,
      backgroundColor: theme.colors.action.hover,
      color: theme.colors.text.primary,
    },
  }),
  dropZoneActive: css({
    borderColor: theme.colors.primary.main,
    backgroundColor: theme.colors.primary.transparent,
    color: theme.colors.primary.text,
    minHeight: '60px',
    border: `3px solid ${theme.colors.primary.main}`,
    boxShadow: `0 0 12px ${theme.colors.primary.transparent}`,
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
 * Data attached to droppable zones
 */
export interface DropZoneData {
  /** Type of drop zone */
  type: 'section' | 'conditional-branch' | 'root-insert';
  /** For sections: the section ID */
  sectionId?: string;
  /** For conditional branches: the conditional ID and branch */
  conditionalId?: string;
  branch?: 'whenTrue' | 'whenFalse';
  /** Insert position index */
  insertIndex?: number;
  /** Block types that can be dropped here */
  acceptTypes?: string[];
}

export interface DroppableZoneProps {
  /** Unique ID for this droppable */
  id: string;
  /** Data attached to this droppable */
  data: DropZoneData;
  /** Whether this zone is disabled */
  disabled?: boolean;
  /** Child content */
  children?: React.ReactNode;
  /** Additional className */
  className?: string;
  /** Render as indicator line instead of full zone */
  asIndicator?: boolean;
  /** Label to show when active */
  label?: string;
}

/**
 * Droppable zone for sections and conditional branches
 */
export function DroppableZone({
  id,
  data,
  disabled = false,
  children,
  className,
  asIndicator = false,
  label = '📍 Move here',
}: DroppableZoneProps) {
  const styles = useStyles2(getStyles);

  const { setNodeRef, isOver } = useDroppable({
    id,
    data,
    disabled,
  });

  if (asIndicator) {
    return (
      <div ref={setNodeRef} className={cx(styles.dropIndicator, className)}>
        <div className={cx(styles.dropIndicatorLine, isOver && styles.dropIndicatorLineActive)} />
        {isOver && <div className={styles.dropIndicatorLabel}>{label}</div>}
      </div>
    );
  }

  return (
    <div ref={setNodeRef} className={cx(styles.dropZone, isOver && styles.dropZoneActive, className)}>
      {children}
    </div>
  );
}

DroppableZone.displayName = 'DroppableZone';
