/**
 * Pure utility functions for the LearningGraph visualization.
 *
 * All functions here are stateless and side-effect-free — safe to unit test
 * in isolation and safe to call during Dagre layout without React involvement.
 */

import dagre from '@dagrejs/dagre';
import type { Node as RFNode, Edge as RFEdge } from '@xyflow/react';
import type { DependencyGraph, GraphNode, GraphEdge } from '../../../types/package.types';
import type { GraphFilterState } from '../types';

// ============ URL RESOLUTION ============

const GRAPH_BASE_URL = 'https://interactive-learning.grafana.net/packages';

/**
 * Constructs a convention-based content.json URL for a graph node.
 *
 * Isolated here as a single-function seam so a future package-resolution-service
 * can replace this convention with a proper lookup without touching callers.
 */
export function resolveContentUrl(node: GraphNode): string {
  const base = new URL(`${node.id}/content.json`, `${GRAPH_BASE_URL}/`);
  return base.toString();
}

// ============ GRAPH COLLAPSE ============

/**
 * Collapses path nodes: each path absorbs its milestones children so that
 * the top-level graph shows ~13 items instead of ~30.
 *
 * Paths listed in `expandedPaths` are left intact — their milestone children
 * remain as individual nodes connected by their original milestone edges.
 * External edges that pointed at those children are NOT re-wired; they keep
 * their original endpoints so the expanded children appear correctly in layout.
 *
 * For collapsed paths: milestone edges are removed and any remaining edge whose
 * source or target is a swallowed child is re-wired to the parent path node.
 */
export function collapseMilestones(graph: DependencyGraph, expandedPaths: Set<string> = new Set()): DependencyGraph {
  // Build a map of milestone child id → parent path id
  const childToPath = new Map<string, string>();
  for (const edge of graph.edges) {
    if (edge.type === 'milestones') {
      childToPath.set(edge.target, edge.source);
    }
  }

  // Children of EXPANDED paths stay visible — only collapse children of collapsed paths
  const swallowedIds = new Set<string>();
  for (const [childId, pathId] of childToPath.entries()) {
    if (!expandedPaths.has(pathId)) {
      swallowedIds.add(childId);
    }
  }

  // Keep top-level nodes + children of any expanded path
  const visibleNodes = graph.nodes.filter((n) => !swallowedIds.has(n.id));

  const filteredEdges: GraphEdge[] = [];
  for (const edge of graph.edges) {
    if (edge.type === 'milestones') {
      // Keep milestone edges only for expanded paths
      const parentPathId = edge.source;
      if (expandedPaths.has(parentPathId)) {
        filteredEdges.push(edge);
      }
      continue;
    }

    // For non-milestone edges: re-wire endpoints that point at swallowed children
    const src = swallowedIds.has(edge.source) ? (childToPath.get(edge.source) ?? edge.source) : edge.source;
    const tgt = swallowedIds.has(edge.target) ? (childToPath.get(edge.target) ?? edge.target) : edge.target;
    if (src === tgt) {
      continue;
    }
    filteredEdges.push({ ...edge, source: src, target: tgt });
  }

  // Deduplicate non-milestone edges (same source + target + type)
  const seen = new Set<string>();
  const deduped = filteredEdges.filter((e) => {
    if (e.type === 'milestones') {
      return true; // milestone edges are already unique per child
    }
    const key = `${e.source}__${e.type}__${e.target}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    ...graph,
    nodes: visibleNodes,
    edges: deduped,
    metadata: {
      ...graph.metadata,
      nodeCount: visibleNodes.length,
      edgeCount: deduped.length,
    },
  };
}

// ============ FILTER APPLICATION ============

/**
 * Filters a (possibly collapsed) graph to only the nodes and edges that
 * match all active filter criteria. Nodes with no remaining edges are
 * retained unless type/category/completion filters explicitly exclude them
 * (isolated nodes are still meaningful starting points).
 */
export function applyFilters(
  graph: DependencyGraph,
  filters: GraphFilterState,
  completedGuides: string[]
): DependencyGraph {
  const completedSet = new Set(completedGuides);

  // 1. Filter nodes by type, category, completion
  let nodes = graph.nodes.filter((node) => {
    // Type filter — structural types (paths/journeys) include milestone guides in step 1b below
    if (filters.typeFilter === 'paths' && node.type !== 'path') {
      return false;
    }
    if (filters.typeFilter === 'journeys' && node.type !== 'journey') {
      return false;
    }
    if (filters.typeFilter === 'guides' && node.type !== 'guide') {
      return false;
    }

    // Category filter (empty = all)
    if (filters.categories.size > 0 && node.category && !filters.categories.has(node.category)) {
      return false;
    }

    // Completion filter
    const isCompleted = completedSet.has(node.id);
    if (filters.completionFilter === 'completed' && !isCompleted) {
      return false;
    }
    if (filters.completionFilter === 'not-started' && isCompleted) {
      return false;
    }

    return true;
  });

  // 1b. When filtering by a structural type (paths/journeys), also include guide nodes
  //     that are milestones of surviving nodes. The collapsed graph will already have
  //     those guides present as nodes because the hook auto-expands containers when
  //     this filter is active (see useGraphFilters).
  if (filters.typeFilter === 'paths' || filters.typeFilter === 'journeys') {
    const primaryIds = new Set(nodes.map((n) => n.id));
    const milestoneTargets = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.type === 'milestones' && primaryIds.has(edge.source)) {
        milestoneTargets.add(edge.target);
      }
    }

    if (milestoneTargets.size > 0) {
      const milestoneGuides = graph.nodes.filter((n) => {
        if (!milestoneTargets.has(n.id)) {
          return false;
        }
        // Respect category filter for milestone guides
        if (filters.categories.size > 0 && n.category && !filters.categories.has(n.category)) {
          return false;
        }
        // Respect completion filter for milestone guides
        const isCompleted = completedSet.has(n.id);
        if (filters.completionFilter === 'completed' && !isCompleted) {
          return false;
        }
        if (filters.completionFilter === 'not-started' && isCompleted) {
          return false;
        }
        return true;
      });
      nodes = [...nodes, ...milestoneGuides];
    }
  }

  // 2. "What's next" smart mode — keep only eligible uncompleted nodes
  if (filters.whatsNextMode) {
    const eligible = getEligibleNextGuides(graph, completedGuides);
    const eligibleIds = new Set(eligible.map((n) => n.id));
    nodes = nodes.filter((n) => eligibleIds.has(n.id));
  }

  const nodeIds = new Set(nodes.map((n) => n.id));

  // 3. Filter edges: keep only edges whose type is active and both endpoints survive.
  //    Milestone edges from expanded paths are always kept — they're internal structure,
  //    not a user-facing relationship type, so they're not subject to the edge-type toggle.
  //    When a structural type filter (paths/journeys) is active, milestone edges are also
  //    kept so the graph shows the path → guide containment relationships.
  const showingMilestonesByTypeFilter = filters.typeFilter === 'paths' || filters.typeFilter === 'journeys';
  const edges = graph.edges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return false;
    }
    if (edge.type === 'milestones') {
      return filters.expandedPaths.has(edge.source) || showingMilestonesByTypeFilter;
    }
    return filters.edgeTypes.has(edge.type);
  });

  return {
    ...graph,
    nodes,
    edges,
    metadata: { ...graph.metadata, nodeCount: nodes.length, edgeCount: edges.length },
  };
}

// ============ DAGRE LAYOUT ============

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const PATH_NODE_WIDTH = 240;
const PATH_NODE_HEIGHT = 96;

export interface LayoutResult {
  nodes: RFNode[];
  edges: RFEdge[];
}

/**
 * Runs Dagre on the filtered graph and returns React Flow node and edge arrays
 * with `position` populated. Does not mutate input.
 */
export function buildDagreGraph(graph: DependencyGraph, completedGuides: string[]): LayoutResult {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 40, marginx: 20, marginy: 20 });

  const completedSet = new Set(completedGuides);

  for (const node of graph.nodes) {
    const isPath = node.type === 'path';
    dagreGraph.setNode(node.id, {
      width: isPath ? PATH_NODE_WIDTH : NODE_WIDTH,
      height: isPath ? PATH_NODE_HEIGHT : NODE_HEIGHT,
    });
  }

  for (const edge of graph.edges) {
    dagreGraph.setEdge(edge.source, edge.target);
  }

  dagre.layout(dagreGraph);

  const rfNodes: RFNode[] = graph.nodes.map((node) => {
    const dagreNode = dagreGraph.node(node.id);
    const isPath = node.type === 'path';
    const w = isPath ? PATH_NODE_WIDTH : NODE_WIDTH;
    const h = isPath ? PATH_NODE_HEIGHT : NODE_HEIGHT;
    const isCompleted = completedSet.has(node.id);

    return {
      id: node.id,
      type: isPath ? 'pathNode' : 'guideNode',
      position: {
        x: (dagreNode?.x ?? 0) - w / 2,
        y: (dagreNode?.y ?? 0) - h / 2,
      },
      data: {
        graphNode: node,
        isCompleted,
        milestoneCount: (node.milestones ?? []).length,
      },
      style: { width: w },
    };
  });

  const rfEdges: RFEdge[] = graph.edges.map((edge, idx) => ({
    id: `e-${edge.source}-${edge.type}-${edge.target}-${idx}`,
    source: edge.source,
    target: edge.target,
    type: 'learningEdge',
    data: { edgeType: edge.type },
    animated: edge.type === 'recommends',
  }));

  return { nodes: rfNodes, edges: rfEdges };
}

// ============ ELIGIBLE NEXT GUIDES ============

/**
 * Returns nodes whose full `depends` chain is already satisfied (all required
 * packages are in completedGuides), making them the learner's eligible next step.
 *
 * Only uncompleted nodes are returned.
 */
export function getEligibleNextGuides(graph: DependencyGraph, completedGuides: string[]): GraphNode[] {
  const completedSet = new Set(completedGuides);

  return graph.nodes.filter((node) => {
    if (completedSet.has(node.id)) {
      return false;
    }

    const depends = node.depends ?? [];
    return depends.every((clause) => {
      if (Array.isArray(clause)) {
        // OR-group: at least one alternative must be completed
        return clause.some((alt) => completedSet.has(alt));
      }
      // Single requirement
      return completedSet.has(clause);
    });
  });
}

// ============ CATEGORY EXTRACTION ============

/** Extracts a sorted list of unique categories from the graph nodes. */
export function extractCategories(graph: DependencyGraph): string[] {
  const cats = new Set<string>();
  for (const node of graph.nodes) {
    if (node.category) {
      cats.add(node.category);
    }
  }
  return Array.from(cats).sort();
}
