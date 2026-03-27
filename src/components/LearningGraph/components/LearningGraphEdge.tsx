/**
 * Custom React Flow edge type for the LearningGraph.
 *
 * Renders different visual styles based on edge relationship type:
 * - recommends: dashed blue animated
 * - depends:    solid gray, heavier stroke
 * - suggests:   dotted, semi-transparent
 * - milestones: only visible when path is expanded (thin, internal)
 */

import React, { memo } from 'react';
import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useTheme2 } from '@grafana/ui';
import type { GraphEdgeType } from '../../../types/package.types';

export interface LearningEdgeData extends Record<string, unknown> {
  edgeType: GraphEdgeType;
}

function getEdgeStyle(
  edgeType: GraphEdgeType,
  theme: ReturnType<typeof useTheme2>
): React.CSSProperties & { strokeDasharray?: string } {
  switch (edgeType) {
    case 'recommends':
      return {
        stroke: theme.colors.primary.main,
        strokeWidth: 2,
        strokeDasharray: '6 3',
      };
    case 'depends':
      return {
        stroke: theme.colors.text.secondary,
        strokeWidth: 2.5,
      };
    case 'suggests':
      return {
        stroke: theme.colors.text.disabled,
        strokeWidth: 1.5,
        strokeDasharray: '2 4',
        opacity: 0.7,
      };
    case 'milestones':
      return {
        stroke: theme.colors.border.medium,
        strokeWidth: 1,
      };
    default:
      return {
        stroke: theme.colors.border.medium,
        strokeWidth: 1.5,
      };
  }
}

export const LearningGraphEdge = memo(function LearningGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const theme = useTheme2();
  const edgeType = (data as LearningEdgeData | undefined)?.edgeType ?? 'recommends';

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const style = getEdgeStyle(edgeType, theme);

  return <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />;
});
