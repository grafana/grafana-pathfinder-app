/**
 * Custom React Flow node types for the LearningGraph visualization.
 *
 * - GuideNode: standalone guide (rounded card)
 * - PathNode: collapsed learning path (wider card with milestone count + expand toggle)
 */

import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useStyles2, Icon } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import type { GraphNode } from '../../../types/package.types';

// ============ SHARED TYPES ============

export interface GraphNodeData extends Record<string, unknown> {
  graphNode: GraphNode;
  isCompleted: boolean;
  milestoneCount?: number;
  isExpanded?: boolean;
  onToggleExpand?: (id: string) => void;
  onNodeClick?: (node: GraphNode) => void;
}

// ============ STYLES ============

function getNodeStyles(theme: GrafanaTheme2) {
  return {
    node: css({
      padding: theme.spacing(1, 1.5),
      borderRadius: theme.shape.radius.default,
      border: `1px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.primary,
      cursor: 'pointer',
      transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      userSelect: 'none',
      '&:hover': {
        boxShadow: theme.shadows.z2,
        borderColor: theme.colors.primary.border,
      },
    }),
    nodeCompleted: css({
      borderColor: theme.colors.success.border,
      background: theme.colors.success.transparent,
    }),
    nodeInProgress: css({
      borderColor: theme.colors.primary.border,
    }),
    pathNode: css({
      padding: theme.spacing(1.25, 1.5),
      borderRadius: theme.shape.radius.default,
      border: `2px solid ${theme.colors.border.medium}`,
      background: theme.colors.background.secondary,
      cursor: 'pointer',
      transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      userSelect: 'none',
      '&:hover': {
        boxShadow: theme.shadows.z2,
        borderColor: theme.colors.primary.border,
      },
    }),
    pathNodeCompleted: css({
      borderColor: theme.colors.success.border,
      background: theme.colors.success.transparent,
    }),
    title: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightMedium,
      color: theme.colors.text.primary,
      margin: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '160px',
    }),
    pathTitle: css({
      fontSize: theme.typography.bodySmall.fontSize,
      fontWeight: theme.typography.fontWeightBold,
      color: theme.colors.text.primary,
      margin: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      maxWidth: '190px',
    }),
    meta: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.5),
      marginTop: theme.spacing(0.5),
    }),
    categoryBadge: css({
      fontSize: '10px',
      padding: '1px 5px',
      borderRadius: '3px',
      background: theme.colors.background.canvas,
      color: theme.colors.text.secondary,
      border: `1px solid ${theme.colors.border.weak}`,
      textTransform: 'lowercase',
      maxWidth: '100px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }),
    completionDot: css({
      width: 8,
      height: 8,
      borderRadius: '50%',
      flexShrink: 0,
    }),
    completedDot: css({
      background: theme.colors.success.main,
    }),
    incompleteDot: css({
      background: theme.colors.border.medium,
    }),
    milestoneCount: css({
      fontSize: '10px',
      color: theme.colors.text.secondary,
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(0.25),
    }),
    expandButton: css({
      background: 'none',
      border: 'none',
      padding: 0,
      cursor: 'pointer',
      color: theme.colors.text.secondary,
      display: 'flex',
      alignItems: 'center',
      marginLeft: theme.spacing(0.5),
      '&:hover': {
        color: theme.colors.text.primary,
      },
    }),
  };
}

// ============ GUIDE NODE ============

export const GuideNode = memo(function GuideNode({ data, selected }: NodeProps) {
  const styles = useStyles2(getNodeStyles);
  const nodeData = data as GraphNodeData;
  const { graphNode, isCompleted, onNodeClick } = nodeData;

  const handleClick = () => {
    onNodeClick?.(graphNode);
  };

  const nodeClass = [styles.node, isCompleted ? styles.nodeCompleted : ''].filter(Boolean).join(' ');

  return (
    <div className={nodeClass} onClick={handleClick} style={{ outline: selected ? '2px solid' : undefined }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <p className={styles.title} title={graphNode.title ?? graphNode.id}>
        {graphNode.title ?? graphNode.id}
      </p>

      <div className={styles.meta}>
        <span className={[styles.completionDot, isCompleted ? styles.completedDot : styles.incompleteDot].join(' ')} />
        {graphNode.category && <span className={styles.categoryBadge}>{graphNode.category}</span>}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});

// ============ PATH NODE ============

export const PathNode = memo(function PathNode({ data, selected }: NodeProps) {
  const styles = useStyles2(getNodeStyles);
  const nodeData = data as GraphNodeData;
  const { graphNode, isCompleted, milestoneCount = 0, isExpanded = false, onToggleExpand, onNodeClick } = nodeData;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.(graphNode.id);
  };

  const handleClick = () => {
    onNodeClick?.(graphNode);
  };

  const nodeClass = [styles.pathNode, isCompleted ? styles.pathNodeCompleted : ''].filter(Boolean).join(' ');

  return (
    <div className={nodeClass} onClick={handleClick} style={{ outline: selected ? '2px solid' : undefined }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />

      <p className={styles.pathTitle} title={graphNode.title ?? graphNode.id}>
        {graphNode.title ?? graphNode.id}
      </p>

      <div className={styles.meta}>
        <span className={[styles.completionDot, isCompleted ? styles.completedDot : styles.incompleteDot].join(' ')} />
        {graphNode.category && <span className={styles.categoryBadge}>{graphNode.category}</span>}
        {milestoneCount > 0 && (
          <span className={styles.milestoneCount}>
            <Icon name="list-ul" size="xs" />
            {milestoneCount}
            {onToggleExpand && (
              <button className={styles.expandButton} onClick={handleToggle} title={isExpanded ? 'Collapse' : 'Expand'}>
                <Icon name={isExpanded ? 'angle-up' : 'angle-down'} size="xs" />
              </button>
            )}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
});
