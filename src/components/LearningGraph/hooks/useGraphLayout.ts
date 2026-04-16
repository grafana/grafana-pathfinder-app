/**
 * Hook that converts a filtered DependencyGraph into React Flow node/edge arrays
 * with Dagre-computed x/y positions.
 *
 * Memoized on (filteredGraph, completedGuides) so layout only reruns when
 * the graph content changes.
 */

import { useMemo } from 'react';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import type { DependencyGraph } from '../../../types/package.types';
import { buildDagreGraph } from '../utils';

export interface UseGraphLayoutResult {
  nodes: RFNode[];
  edges: RFEdge[];
}

export function useGraphLayout(filteredGraph: DependencyGraph | null, completedGuides: string[]): UseGraphLayoutResult {
  return useMemo(() => {
    if (!filteredGraph || filteredGraph.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }
    return buildDagreGraph(filteredGraph, completedGuides);
  }, [filteredGraph, completedGuides]);
}
