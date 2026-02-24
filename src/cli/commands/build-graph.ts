/**
 * Build Graph Command
 *
 * Reads repository.json indexes, constructs an in-memory dependency graph,
 * performs lint checks, and outputs D3-compatible JSON.
 *
 * Graph structure:
 * - Nodes: full manifest metadata from denormalized repository.json
 * - Edges: typed relationships (depends, recommends, suggests, provides, conflicts, replaces, steps)
 * - Virtual nodes: capability names from `provides` fields (distinguished by virtual: true)
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import type {
  DependencyGraph,
  DependencyList,
  GraphEdge,
  GraphEdgeType,
  GraphNode,
  RepositoryEntry,
  RepositoryJson,
} from '../../types/package.types';
import { RepositoryJsonSchema } from '../../types/package.schema';

interface BuildGraphOptions {
  output?: string;
  lint?: boolean;
}

export interface GraphLintMessage {
  severity: 'error' | 'warn';
  message: string;
}

/**
 * Load and parse a repository.json file.
 */
function loadRepository(filePath: string, repoName: string): { repo: RepositoryJson; errors: string[] } {
  const errors: string[] = [];

  if (!fs.existsSync(filePath)) {
    errors.push(`Repository file not found: ${filePath}`);
    return { repo: {}, errors };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    errors.push(`Cannot read repository file: ${filePath}`);
    return { repo: {}, errors };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push(`Invalid JSON in repository file: ${filePath}`);
    return { repo: {}, errors };
  }

  const result = RepositoryJsonSchema.safeParse(parsed);
  if (!result.success) {
    const messages = result.error.issues.map((i) => i.message).join('; ');
    errors.push(`Repository validation failed for ${repoName}: ${messages}`);
    return { repo: {}, errors };
  }

  return { repo: result.data, errors };
}

/**
 * Extract all package IDs mentioned in a DependencyList (flattened).
 */
function extractDependencyIds(depList: DependencyList | undefined): string[] {
  if (!depList) {
    return [];
  }

  const ids: string[] = [];
  for (const clause of depList) {
    if (typeof clause === 'string') {
      ids.push(clause);
    } else {
      ids.push(...clause);
    }
  }
  return ids;
}

/**
 * Build edges from a dependency list field.
 */
function buildDependencyEdges(
  sourceId: string,
  depList: DependencyList | undefined,
  edgeType: GraphEdgeType
): GraphEdge[] {
  const ids = extractDependencyIds(depList);
  return ids.map((target) => ({ source: sourceId, target, type: edgeType }));
}

/**
 * Build the provides map: virtual capability name → set of real package IDs.
 */
function buildProvidesMap(
  allPackages: Map<string, { entry: RepositoryEntry; repository: string }>
): Map<string, Set<string>> {
  const providesMap = new Map<string, Set<string>>();

  for (const [pkgId, { entry }] of allPackages) {
    if (entry.provides) {
      for (const capability of entry.provides) {
        let providers = providesMap.get(capability);
        if (!providers) {
          providers = new Set();
          providesMap.set(capability, providers);
        }
        providers.add(pkgId);
      }
    }
  }

  return providesMap;
}

/**
 * Detect cycles in directed edges using DFS.
 * Returns arrays of IDs forming cycles.
 */
function detectCycles(nodeIds: Set<string>, edges: GraphEdge[], edgeTypes: Set<GraphEdgeType>): string[][] {
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
  const inStack = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): void {
    if (inStack.has(node)) {
      const cycleStart = stack.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push([...stack.slice(cycleStart), node]);
      }
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visited.add(node);
    inStack.add(node);
    stack.push(node);

    const neighbors = adjacency.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor);
    }

    stack.pop();
    inStack.delete(node);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      dfs(id);
    }
  }

  return cycles;
}

/**
 * Build a dependency graph from repository.json files.
 */
export function buildGraph(repositoryPaths: Array<{ name: string; path: string }>): {
  graph: DependencyGraph;
  lintMessages: GraphLintMessage[];
  errors: string[];
} {
  const errors: string[] = [];
  const lintMessages: GraphLintMessage[] = [];
  const allPackages = new Map<string, { entry: RepositoryEntry; repository: string }>();

  // Load all repositories
  for (const { name, path: repoPath } of repositoryPaths) {
    const { repo, errors: loadErrors } = loadRepository(repoPath, name);
    errors.push(...loadErrors);

    for (const [pkgId, entry] of Object.entries(repo)) {
      if (allPackages.has(pkgId)) {
        lintMessages.push({
          severity: 'warn',
          message: `Duplicate package ID "${pkgId}" across repositories`,
        });
      }
      allPackages.set(pkgId, { entry, repository: name });
    }
  }

  // Build provides map
  const providesMap = buildProvidesMap(allPackages);

  // Build nodes
  const nodes: GraphNode[] = [];
  const realNodeIds = new Set<string>();

  for (const [pkgId, { entry, repository }] of allPackages) {
    realNodeIds.add(pkgId);
    nodes.push({
      id: pkgId,
      repository,
      title: entry.title,
      description: entry.description,
      category: entry.category,
      type: entry.type,
      startingLocation: entry.startingLocation,
      steps: entry.steps,
      depends: entry.depends,
      recommends: entry.recommends,
      suggests: entry.suggests,
      provides: entry.provides,
      conflicts: entry.conflicts,
      replaces: entry.replaces,
    });
  }

  // Add virtual capability nodes
  const allNodeIds = new Set(realNodeIds);
  for (const [capability] of providesMap) {
    if (!realNodeIds.has(capability)) {
      allNodeIds.add(capability);
      nodes.push({
        id: capability,
        repository: '',
        type: 'guide',
        virtual: true,
      });
    }
  }

  // Build edges
  const edges: GraphEdge[] = [];

  for (const [pkgId, { entry }] of allPackages) {
    edges.push(...buildDependencyEdges(pkgId, entry.depends, 'depends'));
    edges.push(...buildDependencyEdges(pkgId, entry.recommends, 'recommends'));
    edges.push(...buildDependencyEdges(pkgId, entry.suggests, 'suggests'));

    if (entry.provides) {
      for (const capability of entry.provides) {
        edges.push({ source: pkgId, target: capability, type: 'provides' });
      }
    }

    if (entry.conflicts) {
      for (const conflictId of entry.conflicts) {
        edges.push({ source: pkgId, target: conflictId, type: 'conflicts' });
      }
    }

    if (entry.replaces) {
      for (const replacedId of entry.replaces) {
        edges.push({ source: pkgId, target: replacedId, type: 'replaces' });
      }
    }

    if (entry.steps) {
      for (const stepId of entry.steps) {
        edges.push({ source: pkgId, target: stepId, type: 'steps' });
      }
    }
  }

  // --- Lint checks (all WARN severity during migration phase) ---

  // Broken dependency references
  for (const [pkgId, { entry }] of allPackages) {
    const depFields: Array<{ field: string; deps: DependencyList | undefined }> = [
      { field: 'depends', deps: entry.depends },
      { field: 'recommends', deps: entry.recommends },
      { field: 'suggests', deps: entry.suggests },
    ];

    for (const { field, deps } of depFields) {
      for (const targetId of extractDependencyIds(deps)) {
        if (!realNodeIds.has(targetId) && !providesMap.has(targetId)) {
          lintMessages.push({
            severity: 'warn',
            message: `${pkgId}: ${field} target "${targetId}" does not exist as a real package or virtual capability`,
          });
        }
      }
    }

    // Broken step references
    if (entry.steps) {
      for (const stepId of entry.steps) {
        if (!realNodeIds.has(stepId)) {
          lintMessages.push({
            severity: 'warn',
            message: `${pkgId}: steps entry "${stepId}" does not resolve to an existing package`,
          });
        }
      }
    }
  }

  // Cycle detection
  const dependsCycles = detectCycles(allNodeIds, edges, new Set(['depends']));
  for (const cycle of dependsCycles) {
    lintMessages.push({
      severity: 'error',
      message: `Cycle in depends chain: ${cycle.join(' → ')}`,
    });
  }

  const recommendsCycles = detectCycles(allNodeIds, edges, new Set(['recommends']));
  for (const cycle of recommendsCycles) {
    lintMessages.push({
      severity: 'warn',
      message: `Cycle in recommends chain: ${cycle.join(' → ')}`,
    });
  }

  const stepsCycles = detectCycles(allNodeIds, edges, new Set(['steps']));
  for (const cycle of stepsCycles) {
    lintMessages.push({
      severity: 'error',
      message: `Cycle in steps chain: ${cycle.join(' → ')}`,
    });
  }

  // Orphaned packages (no incoming or outgoing edges)
  const connectedNodes = new Set<string>();
  for (const edge of edges) {
    connectedNodes.add(edge.source);
    connectedNodes.add(edge.target);
  }
  for (const pkgId of realNodeIds) {
    if (!connectedNodes.has(pkgId)) {
      lintMessages.push({
        severity: 'warn',
        message: `${pkgId}: orphaned package (no incoming or outgoing edges)`,
      });
    }
  }

  // Quality: missing description or category
  for (const [pkgId, { entry }] of allPackages) {
    if (!entry.description) {
      lintMessages.push({
        severity: 'warn',
        message: `${pkgId}: missing description`,
      });
    }
    if (!entry.category) {
      lintMessages.push({
        severity: 'warn',
        message: `${pkgId}: missing category`,
      });
    }
  }

  const graph: DependencyGraph = {
    nodes,
    edges,
    metadata: {
      generatedAt: new Date().toISOString(),
      repositories: repositoryPaths.map((r) => r.name),
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };

  return { graph, lintMessages, errors };
}

export const buildGraphCommand = new Command('build-graph')
  .description('Build a dependency graph from repository.json files')
  .argument('<repositories...>', 'Repository entries as name:path pairs (e.g., bundled:path/to/repository.json)')
  .option('-o, --output <file>', 'Output file path (default: stdout)')
  .option('--lint', 'Show lint warnings and errors', true)
  .option('--no-lint', 'Suppress lint output')
  .action((repositories: string[], options: BuildGraphOptions) => {
    const repoPaths = repositories.map((entry) => {
      const colonIndex = entry.indexOf(':');
      if (colonIndex === -1) {
        console.error(`Invalid repository entry "${entry}". Expected format: name:path/to/repository.json`);
        process.exit(1);
      }
      const name = entry.slice(0, colonIndex);
      const repoPath = entry.slice(colonIndex + 1);
      const absolutePath = path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
      return { name, path: absolutePath };
    });

    const { graph, lintMessages, errors } = buildGraph(repoPaths);

    for (const error of errors) {
      console.error(`❌ ${error}`);
    }

    if (options.lint !== false) {
      for (const msg of lintMessages) {
        const icon = msg.severity === 'error' ? '❌' : '⚠️ ';
        console.error(`${icon} ${msg.message}`);
      }

      if (lintMessages.length > 0) {
        const errorCount = lintMessages.filter((m) => m.severity === 'error').length;
        const warnCount = lintMessages.filter((m) => m.severity === 'warn').length;
        console.error(`\nLint: ${errorCount} error(s), ${warnCount} warning(s)`);
      }
    }

    const json = JSON.stringify(graph, null, 2);

    if (options.output) {
      const outputPath = path.isAbsolute(options.output) ? options.output : path.resolve(process.cwd(), options.output);
      fs.writeFileSync(outputPath, json + '\n', 'utf-8');
      console.error(
        `✅ Wrote graph to ${outputPath} (${graph.metadata.nodeCount} nodes, ${graph.metadata.edgeCount} edges)`
      );
    } else {
      console.log(json);
    }

    if (errors.length > 0) {
      process.exit(1);
    }
  });
