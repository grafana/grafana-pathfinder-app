/**
 * Component-local types for the LearningGraph visualization.
 * Shared types (DependencyGraph, GraphNode, GraphEdge) come from src/types/package.types.ts.
 */

import type { GraphEdgeType } from '../../types/package.types';

// ============ FILTER STATE ============

export type CompletionFilter = 'all' | 'not-started' | 'completed';
export type TypeFilter = 'all' | 'paths' | 'journeys' | 'guides';

export interface GraphFilterState {
  /** Edge types to display in the graph */
  edgeTypes: Set<GraphEdgeType>;
  /** Node type filter */
  typeFilter: TypeFilter;
  /** Category filter — empty set = all categories */
  categories: Set<string>;
  /** Completion status filter */
  completionFilter: CompletionFilter;
  /** "What's next" smart mode — shows only eligible uncompleted nodes */
  whatsNextMode: boolean;
  /** Whether path nodes are expanded (showing milestone children) */
  expandedPaths: Set<string>;
}

export const DEFAULT_FILTER_STATE: GraphFilterState = {
  edgeTypes: new Set<GraphEdgeType>(['recommends']),
  typeFilter: 'all',
  categories: new Set<string>(),
  completionFilter: 'all',
  whatsNextMode: false,
  expandedPaths: new Set<string>(),
};

// ============ FETCH STATE ============

export type FetchStatus = 'idle' | 'loading' | 'success' | 'error';

export interface GraphDataState {
  status: FetchStatus;
  error: string | null;
}
