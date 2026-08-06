/**
 * Package-aware guide execution planner.
 *
 * Hard `depends` relationships determine failure propagation. Ordered
 * `milestones` keep path and journey members in one execution chain without
 * turning presentation order into implicit hard dependencies.
 */

import type { GraphEdge, GraphEdgeType, RepositoryEntry, RepositoryJson } from '../../types/package.types';
import { detectCycles } from '../utils/graph-cycles';
import type { LoadedGuide } from '../utils/file-loader';

export interface PlannedGuideRef {
  id: string;
  dependencies: string[];
  autoIncluded: boolean;
}

export interface PlannedGuide extends PlannedGuideRef {
  guide: LoadedGuide;
}

/** Guides ordered so prerequisites run before dependents. */
export type GuideChain = PlannedGuide[];

/** Guide references ordered so prerequisites run before dependents. */
export type GuideChainRef = PlannedGuideRef[];

export interface PackageExecutionPlan {
  chains: GuideChainRef[];
  autoIncludedIds: string[];
  errors: string[];
}

export interface ExecutionPlan {
  chains: GuideChain[];
  autoIncludedIds: string[];
  errors: string[];
}

export interface PlanPackageExecutionOptions {
  rootIds: string[];
  repository: RepositoryJson;
}

export interface PlanGuideExecutionOptions {
  guides: LoadedGuide[];
  repository: RepositoryJson;
  loadGuideById?: (id: string, entry: RepositoryEntry) => LoadedGuide | null;
}

/** Derive a guide's bare package ID, falling back to its file or directory name. */
export function deriveGuideId(guide: LoadedGuide): string {
  try {
    const parsed = JSON.parse(guide.content) as { id?: unknown };
    if (parsed && typeof parsed.id === 'string' && parsed.id.length > 0) {
      return parsed.id;
    }
  } catch {
    // Fall through to the path-derived name.
  }

  const segments = guide.path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] ?? guide.path;
  const parent = segments[segments.length - 2];
  if (last === 'content.json' && parent !== undefined) {
    return parent;
  }
  return last.replace(/\.json$/, '');
}

function isMetapackage(entry: RepositoryEntry | undefined): boolean {
  return entry?.type === 'path' || entry?.type === 'journey';
}

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

function cycleKey(cycle: string[]): string {
  return [...new Set(cycle)].sort().join('\u0000');
}

/**
 * Resolve package metadata into executable leaf-guide chains.
 *
 * Design rationale:
 * - **Leaf projection**: Metapackages (path/journey) are non-executable containers.
 *   Only leaf guides run, so hard-dependency edges are projected from package
 *   boundaries onto the constituent leaf sets.
 * - **Ranking**: Guides are ranked by the order in which they are first reached
 *   during a DFS over the dependency and milestone graph, providing deterministic
 *   tiebreaking during topological sort so CI output is stable across runs.
 * - **Two-phase resolution**: Forced single-candidate dependencies are resolved
 *   to fixpoint before OR-group clauses see the selection set. This ensures
 *   provider choice is deterministic regardless of selection order.
 * - **Root isolation**: Each requested root is resolved independently before
 *   leaf plans are merged. Sibling roots therefore cannot change one another's
 *   OR-group provider choices; genuinely conflicting merged dependency edges
 *   are still cycle-checked before execution.
 * - **Milestone adjacency**: Milestones define presentation order but NOT hard
 *   dependencies. Soft adjacency edges keep journey members in one execution
 *   chain without turning ordering into failure propagation.
 *
 * Returns IDs only; callers hydrate leaf content after graph validation,
 * keeping network and filesystem concerns out of the planner.
 */
export function planPackageExecution(options: PlanPackageExecutionOptions): PackageExecutionPlan {
  const rootIds = [...new Set(options.rootIds)].sort();
  if (rootIds.length <= 1) {
    return planRootPackageExecution({ ...options, rootIds });
  }
  const providesIndex = buildProvidesIndex(options.repository);

  const rootPlans = rootIds.map((rootId) =>
    planRootPackageExecution({ rootIds: [rootId], repository: options.repository }, providesIndex)
  );
  return mergeRootPackagePlans(rootPlans);
}

function mergeRootPackagePlans(rootPlans: PackageExecutionPlan[]): PackageExecutionPlan {
  const errors = [...new Set(rootPlans.flatMap((plan) => plan.errors))];
  if (errors.length > 0) {
    return { chains: [], autoIncludedIds: [], errors };
  }

  const plannedById = new Map<string, { dependencies: Set<string>; autoIncluded: boolean }>();
  const rank = new Map<string, number>();
  const rootChains: string[][] = [];
  let nextRank = 0;

  for (const plan of rootPlans) {
    for (const chain of plan.chains) {
      rootChains.push(chain.map((planned) => planned.id));
      for (const planned of chain) {
        if (!rank.has(planned.id)) {
          rank.set(planned.id, nextRank++);
        }
        const merged = plannedById.get(planned.id) ?? {
          dependencies: new Set<string>(),
          autoIncluded: true,
        };
        for (const dependency of planned.dependencies) {
          merged.dependencies.add(dependency);
        }
        merged.autoIncluded &&= planned.autoIncluded;
        plannedById.set(planned.id, merged);
      }
    }
  }

  const allLeaves = new Set(plannedById.keys());
  const dependencyEdges: GraphEdge[] = [];
  for (const [id, planned] of plannedById) {
    for (const dependency of planned.dependencies) {
      dependencyEdges.push({ source: id, target: dependency, type: 'depends' });
    }
  }
  for (const cycle of detectCycles(allLeaves, dependencyEdges, new Set<GraphEdgeType>(['depends']))) {
    errors.push(`Cycle in depends chain: ${cycle.join(' → ')}`);
  }
  if (errors.length > 0) {
    return { chains: [], autoIncludedIds: [], errors };
  }

  const adjacency = new Map<string, Set<string>>([...allLeaves].map((id) => [id, new Set<string>()]));
  for (const [id, planned] of plannedById) {
    for (const dependency of planned.dependencies) {
      adjacency.get(id)?.add(dependency);
      adjacency.get(dependency)?.add(id);
    }
  }
  for (const rootChain of rootChains) {
    for (let index = 1; index < rootChain.length; index++) {
      const previous = rootChain[index - 1]!;
      const current = rootChain[index]!;
      adjacency.get(previous)?.add(current);
      adjacency.get(current)?.add(previous);
    }
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  for (const start of [...allLeaves].sort()) {
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

  const hardLeafDeps = new Map([...plannedById].map(([id, planned]) => [id, planned.dependencies] as const));
  const chains = components.map((component) =>
    stableTopologicalSort(component, hardLeafDeps, rank).map<PlannedGuideRef>((id) => ({
      id,
      dependencies: [...(plannedById.get(id)?.dependencies ?? [])].sort(compareLeafOrder(rank)),
      autoIncluded: plannedById.get(id)?.autoIncluded ?? true,
    }))
  );
  chains.sort((left, right) => left[0]!.id.localeCompare(right[0]!.id));

  const autoIncludedIds = [...plannedById]
    .filter(([, planned]) => planned.autoIncluded)
    .map(([id]) => id)
    .sort();
  return { chains, autoIncludedIds, errors };
}

function planRootPackageExecution(
  options: PlanPackageExecutionOptions,
  providesIndex: Map<string, string[]> = buildProvidesIndex(options.repository)
): PackageExecutionPlan {
  const { repository } = options;
  const rootIds = [...new Set(options.rootIds)];
  const rootSet = new Set(rootIds);
  const errors: string[] = [];
  const packageSet = new Set<string>();
  const explicitPackages = new Set<string>();
  const directDeps = new Map<string, string[]>();

  const markExplicit = (id: string, seen: Set<string> = new Set()): void => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    explicitPackages.add(id);
    const entry = repository[id];
    if (isMetapackage(entry)) {
      for (const milestone of entry?.milestones ?? []) {
        markExplicit(milestone, seen);
      }
    }
  };

  const addPackage = (requesterId: string, id: string, explicit: boolean): void => {
    const entry = repository[id];
    if (!entry && !rootSet.has(id)) {
      errors.push(`${requesterId}: package "${id}" is missing from the repository index`);
      return;
    }
    if (explicit) {
      markExplicit(id);
    }
    if (packageSet.has(id)) {
      return;
    }
    packageSet.add(id);
    if (!isMetapackage(entry)) {
      return;
    }
    const milestones = entry?.milestones ?? [];
    if (milestones.length === 0) {
      errors.push(`${id}: ${entry?.type} package has no milestones`);
      return;
    }
    if (new Set(milestones).size !== milestones.length) {
      errors.push(`${id}: milestones contains duplicate package IDs`);
    }
    for (const milestone of milestones) {
      addPackage(id, milestone, explicit);
    }
  };

  for (const id of [...rootIds].sort()) {
    addPackage(id, id, true);
  }

  const ensureProvider = (requesterId: string, providerId: string): boolean => {
    if (!repository[providerId]) {
      errors.push(`${requesterId}: could not resolve prerequisite package "${providerId}"`);
      return false;
    }
    addPackage(requesterId, providerId, false);
    return true;
  };

  const resolveClauseProvider = (candidates: string[]): string | null => {
    for (const candidate of candidates) {
      const reused = resolveCandidateProviders(candidate, repository, providesIndex).find((id) => packageSet.has(id));
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

  const resolvePhase = (id: string, forced: boolean): void => {
    const deps = directDeps.get(id) ?? [];
    directDeps.set(id, deps);
    for (const clause of repository[id]?.depends ?? []) {
      const candidates = clauseCandidates(clause);
      if (candidates.length === 0 || (candidates.length === 1) !== forced) {
        continue;
      }
      const providerId = resolveClauseProvider(candidates);
      if (providerId === null) {
        errors.push(
          `${id}: depends target "${candidates.join(' | ')}" does not resolve to a known package or capability`
        );
        continue;
      }
      if (ensureProvider(id, providerId)) {
        deps.push(providerId);
      }
    }
  };

  const forcedResolved = new Set<string>();
  const alternativesResolved = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    let forcedProgress = true;
    while (forcedProgress) {
      forcedProgress = false;
      for (const id of [...packageSet].sort()) {
        if (forcedResolved.has(id)) {
          continue;
        }
        forcedResolved.add(id);
        const before = packageSet.size;
        resolvePhase(id, true);
        if (packageSet.size !== before) {
          forcedProgress = true;
        }
      }
    }
    for (const id of [...packageSet].sort()) {
      if (alternativesResolved.has(id)) {
        continue;
      }
      alternativesResolved.add(id);
      const before = packageSet.size;
      resolvePhase(id, false);
      if (packageSet.size !== before) {
        progressed = true;
      }
    }
  }

  for (const [id, deps] of directDeps) {
    directDeps.set(id, [...new Set(deps)]);
  }

  const dependencyEdges: GraphEdge[] = [];
  const milestoneEdges: GraphEdge[] = [];
  for (const id of packageSet) {
    for (const dependency of directDeps.get(id) ?? []) {
      dependencyEdges.push({ source: id, target: dependency, type: 'depends' });
    }
    for (const milestone of repository[id]?.milestones ?? []) {
      if (packageSet.has(milestone)) {
        milestoneEdges.push({ source: id, target: milestone, type: 'milestones' });
      }
    }
  }

  const reportedCycleKeys = new Set<string>();
  for (const cycle of detectCycles(packageSet, dependencyEdges, new Set<GraphEdgeType>(['depends']))) {
    reportedCycleKeys.add(cycleKey(cycle));
    errors.push(`Cycle in depends chain: ${cycle.join(' → ')}`);
  }
  for (const cycle of detectCycles(packageSet, milestoneEdges, new Set<GraphEdgeType>(['milestones']))) {
    reportedCycleKeys.add(cycleKey(cycle));
    errors.push(`Cycle in milestones chain: ${cycle.join(' → ')}`);
  }
  for (const cycle of detectCycles(
    packageSet,
    [...dependencyEdges, ...milestoneEdges],
    new Set<GraphEdgeType>(['depends', 'milestones'])
  )) {
    const key = cycleKey(cycle);
    if (!reportedCycleKeys.has(key)) {
      reportedCycleKeys.add(key);
      errors.push(`Cycle across depends and milestones: ${cycle.join(' → ')}`);
    }
  }

  const leavesMemo = new Map<string, string[]>();
  const packageLeaves = (id: string): string[] => {
    const cached = leavesMemo.get(id);
    if (cached) {
      return cached;
    }
    const entry = repository[id];
    const leaves = isMetapackage(entry)
      ? (entry?.milestones ?? []).flatMap((milestone) => packageLeaves(milestone))
      : [id];
    const unique = [...new Set(leaves)];
    leavesMemo.set(id, unique);
    return unique;
  };

  if (errors.length > 0) {
    return { chains: [], autoIncludedIds: [], errors };
  }

  const explicitLeafIds = new Set<string>();
  for (const id of explicitPackages) {
    if (!isMetapackage(repository[id])) {
      explicitLeafIds.add(id);
    }
  }

  const hardLeafDeps = new Map<string, Set<string>>();
  for (const id of packageSet) {
    for (const leaf of packageLeaves(id)) {
      hardLeafDeps.set(leaf, hardLeafDeps.get(leaf) ?? new Set());
    }
  }
  for (const [id, dependencies] of directDeps) {
    const prerequisiteLeaves = dependencies.flatMap((dependency) => packageLeaves(dependency));
    for (const leaf of packageLeaves(id)) {
      const leafDeps = hardLeafDeps.get(leaf) ?? new Set<string>();
      for (const prerequisite of prerequisiteLeaves) {
        if (prerequisite !== leaf) {
          leafDeps.add(prerequisite);
        }
      }
      hardLeafDeps.set(leaf, leafDeps);
    }
  }

  const rank = new Map<string, number>();
  const rankedPackages = new Set<string>();
  let nextRank = 0;
  const rankPackage = (id: string): void => {
    if (rankedPackages.has(id)) {
      return;
    }
    rankedPackages.add(id);
    for (const dependency of [...(directDeps.get(id) ?? [])].sort()) {
      rankPackage(dependency);
    }
    const entry = repository[id];
    if (isMetapackage(entry)) {
      for (const milestone of entry?.milestones ?? []) {
        rankPackage(milestone);
      }
      return;
    }
    if (!rank.has(id)) {
      rank.set(id, nextRank++);
    }
  };
  for (const id of [...rootIds].sort()) {
    rankPackage(id);
  }
  for (const id of [...packageSet].sort()) {
    rankPackage(id);
  }

  const allLeaves = new Set<string>([...packageSet].flatMap((id) => packageLeaves(id)));
  const adjacency = new Map<string, Set<string>>([...allLeaves].map((id) => [id, new Set<string>()]));
  for (const [id, dependencies] of hardLeafDeps) {
    for (const dependency of dependencies) {
      adjacency.get(id)?.add(dependency);
      adjacency.get(dependency)?.add(id);
    }
  }

  const closureLeaves = (rootId: string): string[] => {
    const packages = new Set<string>();
    const visit = (id: string): void => {
      if (packages.has(id)) {
        return;
      }
      packages.add(id);
      for (const dependency of directDeps.get(id) ?? []) {
        visit(dependency);
      }
      for (const milestone of repository[id]?.milestones ?? []) {
        visit(milestone);
      }
    };
    visit(rootId);
    return [...new Set([...packages].flatMap((id) => packageLeaves(id)))].sort(compareLeafOrder(rank));
  };
  for (const rootId of rootIds) {
    const leaves = closureLeaves(rootId);
    for (let index = 1; index < leaves.length; index++) {
      const previous = leaves[index - 1]!;
      const current = leaves[index]!;
      adjacency.get(previous)?.add(current);
      adjacency.get(current)?.add(previous);
    }
  }

  const components: string[][] = [];
  const visited = new Set<string>();
  for (const start of [...allLeaves].sort()) {
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

  const chains = components.map((component) =>
    stableTopologicalSort(component, hardLeafDeps, rank).map<PlannedGuideRef>((id) => ({
      id,
      dependencies: [...(hardLeafDeps.get(id) ?? [])].sort(compareLeafOrder(rank)),
      autoIncluded: !explicitLeafIds.has(id),
    }))
  );
  chains.sort((left, right) => left[0]!.id.localeCompare(right[0]!.id));

  const autoIncludedIds = [...allLeaves].filter((id) => !explicitLeafIds.has(id)).sort();
  return { chains, autoIncludedIds, errors };
}

function compareLeafOrder(rank: Map<string, number>): (left: string, right: string) => number {
  return (left, right) => {
    const rankDifference = (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER);
    return rankDifference !== 0 ? rankDifference : left.localeCompare(right);
  };
}

function stableTopologicalSort(
  component: string[],
  hardLeafDeps: Map<string, Set<string>>,
  rank: Map<string, number>
): string[] {
  const inComponent = new Set(component);
  const indegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>();
  for (const id of component) {
    const dependencies = [...(hardLeafDeps.get(id) ?? [])].filter((dependency) => inComponent.has(dependency));
    indegree.set(id, dependencies.length);
    for (const dependency of dependencies) {
      const values = dependents.get(dependency) ?? new Set<string>();
      values.add(id);
      dependents.set(dependency, values);
    }
  }

  const compare = compareLeafOrder(rank);
  const ready = component.filter((id) => indegree.get(id) === 0).sort(compare);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(id);
    for (const dependent of dependents.get(id) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) {
        ready.push(dependent);
        ready.sort(compare);
      }
    }
  }
  return order;
}

/** Hydrate an ID-only package plan with validated guide content. */
export function hydrateExecutionPlan(
  packagePlan: PackageExecutionPlan,
  guidesById: Map<string, LoadedGuide>,
  repository: RepositoryJson,
  loadGuideById?: (id: string, entry: RepositoryEntry) => LoadedGuide | null
): ExecutionPlan {
  const errors = [...packagePlan.errors];
  const loaded = new Map(guidesById);
  for (const chain of packagePlan.chains) {
    for (const planned of chain) {
      if (loaded.has(planned.id)) {
        continue;
      }
      const entry = repository[planned.id];
      const guide = entry ? (loadGuideById?.(planned.id, entry) ?? null) : null;
      if (!guide) {
        errors.push(
          planned.autoIncluded
            ? `could not load auto-included prerequisite "${planned.id}"`
            : `could not load planned guide "${planned.id}"`
        );
        continue;
      }
      loaded.set(planned.id, guide);
    }
  }
  if (errors.length > 0) {
    return { chains: [], autoIncludedIds: packagePlan.autoIncludedIds, errors };
  }
  return {
    chains: packagePlan.chains.map((chain) =>
      chain.map((planned) => ({
        ...planned,
        guide: loaded.get(planned.id)!,
      }))
    ),
    autoIncludedIds: packagePlan.autoIncludedIds,
    errors,
  };
}

/** Plan selected guides and hydrate any dependency- or milestone-expanded leaves. */
export function planGuideExecution(options: PlanGuideExecutionOptions): ExecutionPlan {
  const idToGuide = new Map<string, LoadedGuide>();
  const errors: string[] = [];
  for (const guide of options.guides) {
    const id = deriveGuideId(guide);
    const existing = idToGuide.get(id);
    if (existing) {
      if (existing.path !== guide.path) {
        errors.push(`duplicate guide id "${id}" derived from "${existing.path}" and "${guide.path}"`);
      }
      continue;
    }
    idToGuide.set(id, guide);
  }
  if (errors.length > 0) {
    return { chains: [], autoIncludedIds: [], errors };
  }
  const packagePlan = planPackageExecution({
    rootIds: [...idToGuide.keys()],
    repository: options.repository,
  });
  return hydrateExecutionPlan(packagePlan, idToGuide, options.repository, options.loadGuideById);
}
