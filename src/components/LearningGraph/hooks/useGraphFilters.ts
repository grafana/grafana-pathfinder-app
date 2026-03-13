/**
 * Hook that manages the 5-dimensional filter state and derives the filtered
 * DependencyGraph output from the (collapsed) raw graph + filter state.
 */

import { useState, useMemo, useCallback } from 'react';
import type { DependencyGraph, GraphEdgeType } from '../../../types/package.types';
import { DEFAULT_FILTER_STATE, type GraphFilterState, type CompletionFilter, type TypeFilter } from '../types';
import { collapseMilestones, applyFilters, extractCategories } from '../utils';

export interface UseGraphFiltersResult {
  filters: GraphFilterState;
  filteredGraph: DependencyGraph | null;
  availableCategories: string[];
  toggleEdgeType: (edgeType: GraphEdgeType) => void;
  setTypeFilter: (typeFilter: TypeFilter) => void;
  toggleCategory: (category: string) => void;
  setCompletionFilter: (completionFilter: CompletionFilter) => void;
  toggleWhatsNext: () => void;
  togglePathExpanded: (pathId: string) => void;
  resetFilters: () => void;
}

export function useGraphFilters(rawGraph: DependencyGraph | null, completedGuides: string[]): UseGraphFiltersResult {
  const [filters, setFilters] = useState<GraphFilterState>(DEFAULT_FILTER_STATE);

  // Collapse milestone children into their parent paths.
  // Expanded paths are skipped — their children remain as individual nodes.
  // When a structural type filter (paths/journeys) is active, all containers of that
  // type are also treated as expanded so their milestone guides are present in the
  // graph and can be surfaced by applyFilters.
  const collapsedGraph = useMemo(() => {
    if (!rawGraph) {
      return null;
    }

    let expandedPaths = filters.expandedPaths;
    if (filters.typeFilter === 'paths' || filters.typeFilter === 'journeys') {
      const targetType = filters.typeFilter === 'paths' ? 'path' : 'journey';
      const containerIds = rawGraph.nodes.filter((n) => n.type === targetType).map((n) => n.id);
      expandedPaths = new Set([...filters.expandedPaths, ...containerIds]);
    }

    return collapseMilestones(rawGraph, expandedPaths);
  }, [rawGraph, filters.expandedPaths, filters.typeFilter]);

  // Derive available categories from the collapsed graph
  const availableCategories = useMemo(() => {
    if (!collapsedGraph) {
      return [];
    }
    return extractCategories(collapsedGraph);
  }, [collapsedGraph]);

  // Apply all active filters to produce the final filtered graph
  const filteredGraph = useMemo(() => {
    if (!collapsedGraph) {
      return null;
    }
    return applyFilters(collapsedGraph, filters, completedGuides);
  }, [collapsedGraph, filters, completedGuides]);

  const toggleEdgeType = useCallback((edgeType: GraphEdgeType) => {
    setFilters((prev) => {
      const next = new Set(prev.edgeTypes);
      if (next.has(edgeType)) {
        next.delete(edgeType);
      } else {
        next.add(edgeType);
      }
      return { ...prev, edgeTypes: next };
    });
  }, []);

  const setTypeFilter = useCallback((typeFilter: TypeFilter) => {
    setFilters((prev) => ({ ...prev, typeFilter }));
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setFilters((prev) => {
      const next = new Set(prev.categories);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return { ...prev, categories: next };
    });
  }, []);

  const setCompletionFilter = useCallback((completionFilter: CompletionFilter) => {
    setFilters((prev) => ({ ...prev, completionFilter }));
  }, []);

  const toggleWhatsNext = useCallback(() => {
    setFilters((prev) => {
      if (!prev.whatsNextMode) {
        // Enabling smart mode — reset all other filters for clarity
        return {
          ...DEFAULT_FILTER_STATE,
          whatsNextMode: true,
          expandedPaths: prev.expandedPaths,
        };
      }
      return { ...prev, whatsNextMode: false };
    });
  }, []);

  const togglePathExpanded = useCallback((pathId: string) => {
    setFilters((prev) => {
      const next = new Set(prev.expandedPaths);
      if (next.has(pathId)) {
        next.delete(pathId);
      } else {
        next.add(pathId);
      }
      return { ...prev, expandedPaths: next };
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTER_STATE);
  }, []);

  return {
    filters,
    filteredGraph,
    availableCategories,
    toggleEdgeType,
    setTypeFilter,
    toggleCategory,
    setCompletionFilter,
    toggleWhatsNext,
    togglePathExpanded,
    resetFilters,
  };
}
