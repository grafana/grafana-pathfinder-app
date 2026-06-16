/**
 * Pure structural cycle detection over typed dependency-graph edges.
 *
 * Lives in `utils/` so both the `build-graph` command and the guide-chain
 * planner can share it without `utils/` importing from `commands/`.
 */

import type { GraphEdge, GraphEdgeType } from '../../types/package.types';

/**
 * Detect cycles in directed edges using DFS.
 * Returns arrays of IDs forming cycles.
 */
export function detectCycles(nodeIds: Set<string>, edges: GraphEdge[], edgeTypes: Set<GraphEdgeType>): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!edgeTypes.has(edge.type)) {
      continue;
    }
    const neighbors = adjacency.get(edge.source);
    if (neighbors) {
      neighbors.push(edge.target);
    }
  }

  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stackPosition = new Map<string, number>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (stackPosition.has(node)) {
      const cycleStart = stackPosition.get(node)!;
      cycles.push([...stack.slice(cycleStart), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    stackPosition.set(node, stack.length);
    stack.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    stack.pop();
    stackPosition.delete(node);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      dfs(id);
    }
  }

  return cycles;
}
