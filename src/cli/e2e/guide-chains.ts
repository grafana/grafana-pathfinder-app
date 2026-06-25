/**
 * Dependency-aware guide execution planner.
 *
 * Groups guides into chains over their hard `depends` prerequisites and orders
 * each chain so prerequisites run first. Only `depends` participates;
 * `recommends`/`suggests` are advisory. Dependency targets may be real package
 * IDs or virtual capabilities resolved through `provides`.
 */

import type { GraphEdge, GraphEdgeType, RepositoryEntry, RepositoryJson } from '../../types/package.types';
import { detectCycles } from '../utils/graph-cycles';
import type { LoadedGuide } from '../utils/file-loader';

export interface PlannedGuide {
  id: string;
  guide: LoadedGuide;
  dependencies: string[];
  autoIncluded: boolean;
}

/** Guides ordered so prerequisites run before dependents. */
export type GuideChain = PlannedGuide[];

export interface ExecutionPlan {
  chains: GuideChain[];
  autoIncludedIds: string[];
  errors: string[];
}

export interface PlanGuideExecutionOptions {
  guides: LoadedGuide[];
  repository: RepositoryJson;
  loadGuideById?: (id: string, entry: RepositoryEntry) => LoadedGuide | null;
}

/**
 * Derive a guide's bare package ID. Prefers the `id` field in content.json,
 * falling back to the directory/file name for legacy guides.
 */
export function deriveGuideId(guide: LoadedGuide): string {
  try {
    const parsed = JSON.parse(guide.content) as { id?: unknown };
    if (parsed && typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id;
    }
  } catch {
    // Not JSON or no id — fall through to the path-derived name.
  }

  const segments = guide.path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? guide.path;
  const parent = segments[segments.length - 2];
  if (last === 'content.json' && parent !== undefined) {
    return parent;
  }
  return last.replace(/\.json$/, '');
}

/**
 * Build a capability → provider-IDs index from a repository, sorted for
 * deterministic provider selection.
 */
function buildProvidesIndex(repository: RepositoryJson): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const [id, entry] of Object.entries(repository)) {
    for (const capability of entry.provides ?? []) {
      const providers = index.get(capability) ?? [];
      providers.push(id);
      index.set(capability, providers);
    }
  }
  for (const providers of index.values()) {
    providers.sort();
  }
  return index;
}

/**
 * Resolve a single dependency candidate (a real package ID or virtual
 * capability) to the concrete provider package IDs that could satisfy it.
 */
function resolveCandidateProviders(
  candidate: string,
  repository: RepositoryJson,
  providesIndex: Map<string, string[]>
): string[] {
  if (repository[candidate]) {
    return [candidate];
  }
  return providesIndex.get(candidate) ?? [];
}

function clauseCandidates(clause: string | string[]): string[] {
  return typeof clause === 'string' ? [clause] : clause;
}

/**
 * Plan guide execution: resolve dependencies, auto-include missing
 * prerequisites, detect cycles, and group guides into topologically ordered
 * dependency chains.
 */
export function planGuideExecution(options: PlanGuideExecutionOptions): ExecutionPlan {
  const { guides, repository, loadGuideById } = options;
  const errors: string[] = [];

  const providesIndex = buildProvidesIndex(repository);

  const idToGuide = new Map<string, LoadedGuide>();
  const directDeps = new Map<string, string[]>();
  const autoIncluded = new Set<string>();
  const runSet = new Set<string>();

  for (const guide of guides) {
    const id = deriveGuideId(guide);
    const existing = idToGuide.get(id);
    if (existing) {
      if (existing.path !== guide.path) {
        // Fail loudly on duplicate IDs from different paths
        errors.push(`duplicate guide id "${id}" derived from "${existing.path}" and "${guide.path}"`);
      }
      continue;
    }
    idToGuide.set(id, guide);
    runSet.add(id);
  }

  // Load a prereq into the run set on demand.
  const ensureLoaded = (requesterId: string, providerId: string): boolean => {
    if (runSet.has(providerId)) {
      return true;
    }
    const providerEntry = repository[providerId];
    const loaded = providerEntry ? (loadGuideById?.(providerId, providerEntry) ?? null) : null;
    if (!loaded) {
      errors.push(`${requesterId}: could not load auto-included prerequisite "${providerId}"`);
      return false;
    }
    idToGuide.set(providerId, loaded);
    runSet.add(providerId);
    autoIncluded.add(providerId);
    return true;
  };

  // Resolve one clause to a concrete provider: prefer an alternative already in
  // the run set (so chains reuse it), otherwise the first resolvable candidate.
  // Returns null when nothing satisfies the clause.
  const resolveClauseProvider = (candidates: string[]): string | null => {
    for (const candidate of candidates) {
      const reused = resolveCandidateProviders(candidate, repository, providesIndex).find((p) => runSet.has(p));
      if (reused) {
        return reused;
      }
    }
    for (const candidate of candidates) {
      const [provider] = resolveCandidateProviders(candidate, repository, providesIndex);
      if (provider) {
        return provider;
      }
    }
    return null;
  };

  // Resolve a single guide's clauses for one phase: `forced` handles
  // single-target clauses, `!forced` handles OR-groups. Deps accumulate across
  // the two phases.
  const resolvePhase = (id: string, forced: boolean): void => {
    const deps = directDeps.get(id) ?? [];
    directDeps.set(id, deps);
    const entry = repository[id];
    if (!entry) {
      return; // Unmanaged guide (no repository entry): dependency-free singleton.
    }
    for (const clause of entry.depends ?? []) {
      const candidates = clauseCandidates(clause);
      const isForced = candidates.length === 1;
      if (candidates.length === 0 || isForced !== forced) {
        continue;
      }
      const providerId = resolveClauseProvider(candidates);
      if (providerId === null) {
        errors.push(
          `${id}: depends target "${candidates.join(' | ')}" does not resolve to a known package or capability`
        );
        continue;
      }
      if (ensureLoaded(id, providerId)) {
        deps.push(providerId);
      }
    }
  };

  // Make the plan a pure function of the selection set: expand forced
  // single-target prerequisites to a fixpoint, then resolve OR-group
  // clauses against that now-stable run set, iterating ids in sorted order.
  const forcedResolved = new Set<string>();
  const orResolved = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;

    let forcedProgress = true;
    while (forcedProgress) {
      forcedProgress = false;
      for (const id of [...runSet].sort()) {
        if (forcedResolved.has(id)) {
          continue;
        }
        forcedResolved.add(id);
        const before = runSet.size;
        resolvePhase(id, true);
        if (runSet.size !== before) {
          forcedProgress = true;
        }
      }
    }

    for (const id of [...runSet].sort()) {
      if (orResolved.has(id)) {
        continue;
      }
      orResolved.add(id);
      const before = runSet.size;
      resolvePhase(id, false);
      if (runSet.size !== before) {
        progressed = true;
      }
    }
  }

  // Deduplicate accumulated provider ids per guide.
  for (const [id, deps] of directDeps) {
    directDeps.set(id, [...new Set(deps)]);
  }

  const allIds = new Set(runSet);
  const edges: GraphEdge[] = [];
  for (const [id, deps] of directDeps) {
    for (const dep of deps) {
      edges.push({ source: id, target: dep, type: 'depends' });
    }
  }

  // A `depends` cycle is unsatisfiable. Fail the plan.
  const cycles = detectCycles(allIds, edges, new Set<GraphEdgeType>(['depends']));
  for (const cycle of cycles) {
    errors.push(`Cycle in depends chain: ${cycle.join(' → ')}`);
  }

  const autoIncludedIds = [...autoIncluded].sort();
  if (errors.length > 0) {
    return { chains: [], autoIncludedIds, errors };
  }

  const chains = buildChains(allIds, edges, directDeps, idToGuide, autoIncluded);
  return { chains, autoIncludedIds, errors };
}

/**
 * Group IDs into weakly connected components over `depends` edges, then
 * topologically sort each component so prerequisites come first.
 */
function buildChains(
  allIds: Set<string>,
  edges: GraphEdge[],
  directDeps: Map<string, string[]>,
  idToGuide: Map<string, LoadedGuide>,
  autoIncluded: Set<string>
): GuideChain[] {
  // Undirected adjacency for component detection.
  const adjacency = new Map<string, Set<string>>();
  for (const id of allIds) {
    adjacency.set(id, new Set());
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of [...allIds].sort()) {
    if (visited.has(start)) {
      continue;
    }
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) {
        continue;
      }
      component.push(node);
      for (const neighbor of [...(adjacency.get(node) ?? [])].sort()) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    components.push(component);
  }

  const chains = components.map((component) => {
    const order = topologicalSort(component, directDeps);
    return order.map<PlannedGuide>((id) => ({
      id,
      guide: idToGuide.get(id)!,
      dependencies: directDeps.get(id) ?? [],
      autoIncluded: autoIncluded.has(id),
    }));
  });

  // Deterministic chain ordering by the first (topologically earliest) guide.
  chains.sort((a, b) => a[0]!.id.localeCompare(b[0]!.id));
  return chains;
}

/**
 * Topologically sort so prerequisites come before their dependents.
 * A node is appended only after its prerequisites, and sorted iteration keeps
 * the result deterministic. The `visited` guard makes this terminate if a
 * cycle ever slipped through.
 */
function topologicalSort(component: string[], directDeps: Map<string, string[]>): string[] {
  const inComponent = new Set(component);
  const visited = new Set<string>();
  const order: string[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    for (const dep of [...(directDeps.get(id) ?? [])].filter((d) => inComponent.has(d)).sort()) {
      visit(dep);
    }
    order.push(id);
  };

  for (const id of [...component].sort()) {
    visit(id);
  }
  return order;
}
