import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import { isInteractiveBlockType } from '../../types/json-guide-classification';
import { toLegacyResult, validateGuideFromString } from '../../validation';
import type { ManifestJson, RepositoryEntry, RepositoryJson } from '../../types/package.types';
import { buildRepository } from '../commands/build-repository';
import { bundledRepositoryPath, loadGuideFiles, loadRepositoryIndex, type LoadedGuide } from '../utils/file-loader';
import { classifyGuideSideEffectsFromString } from './side-effects';
import { resolveTarget, sameOrigin, type CloudTargetCapabilities } from './e2e-targets';
import { ExitCode } from './exit-codes';
import { deriveGuideId, hydrateExecutionPlan, planPackageExecution, type ExecutionPlan } from './guide-chains';
import { loadManifestFromDir, type CurrentTier } from './manifest-preflight';
import type { GuideRunResult, GuideStatus, PackageMeta } from './e2e-results';
import type { ExecutionSelection } from './schemas/e2e-report.schema';

export interface LocalRepositorySource {
  repository: RepositoryJson;
  loadGuideById: (id: string, entry: RepositoryEntry) => LoadedGuide | null;
  duplicateIds?: ReadonlySet<string>;
}

export interface LocalMetapackageOptions {
  packageDir: string;
  repositoryPath?: string;
  grafanaUrl: string;
  currentTier: CurrentTier;
  cloudUrl: string;
  verbose: boolean;
  cloudTargetCapabilities?: CloudTargetCapabilities;
}

export interface LocalMetapackageResolution {
  guides: LoadedGuide[];
  executionPlan?: ExecutionPlan;
  selection: ExecutionSelection;
  repoSource: LocalRepositorySource;
  preRunSkipped: GuideRunResult[];
  packageMetaById: Map<string, PackageMeta>;
  localPackageDir: string;
}

export class LocalMetapackageResolutionError extends Error {
  constructor(
    message: string,
    readonly selection?: ExecutionSelection
  ) {
    super(message);
    this.name = 'LocalMetapackageResolutionError';
  }
}

export class LocalCloudNonExecutionError extends Error {
  constructor(
    readonly guide: LoadedGuide,
    message: string,
    readonly plannedGuides: ReadonlyArray<{ id: string; guide: LoadedGuide; autoIncluded: boolean }>
  ) {
    super(message);
    this.name = 'LocalCloudNonExecutionError';
  }
}

function hasInteractiveBlocks(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasInteractiveBlocks);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  const block = value as Record<string, unknown>;
  return (
    isInteractiveBlockType(block.type) ||
    hasInteractiveBlocks(block.blocks) ||
    hasInteractiveBlocks(block.whenTrue) ||
    hasInteractiveBlocks(block.whenFalse)
  );
}

function hasLegacyGuideQuery(value: string): boolean {
  try {
    return Boolean(new URL(value, 'https://pathfinder.invalid/').searchParams.get('doc'));
  } catch {
    return false;
  }
}

function unsupportedGuideReference(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const unsupported = unsupportedGuideReference(item);
      if (unsupported) {
        return unsupported;
      }
    }
    return undefined;
  }

  const block = value as Record<string, unknown>;
  if (block.type === 'snippet-ref') {
    return 'snippet-ref';
  }
  if (block.action === 'navigate' || block.targetAction === 'navigate') {
    if (typeof block.openGuide === 'string' && block.openGuide.trim() !== '') {
      return 'navigate openGuide';
    }
    for (const key of ['reftarget', 'refTarget']) {
      const target = block[key];
      if (typeof target === 'string' && hasLegacyGuideQuery(target)) {
        return 'navigate ?doc= link';
      }
    }
  }
  for (const nested of Object.values(block)) {
    const unsupported = unsupportedGuideReference(nested);
    if (unsupported) {
      return unsupported;
    }
  }
  return undefined;
}

const LOCAL_CHECKOUT_EXCLUDES = ['.git', '.github', 'node_modules', 'scripts'] as const;

function localRepositoryRoot(repositoryPath: string): string {
  const resolvedPath = resolve(repositoryPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Local repository not found: ${resolvedPath}`);
  }
  return statSync(resolvedPath).isDirectory() ? resolvedPath : dirname(resolvedPath);
}

export function assertLocalCloudCheckoutSources(repositoryPath: string | undefined, packageDir: string): void {
  if (!repositoryPath) {
    throw new Error('A local cloud guide requires --repository <path>.');
  }
  const root = realpathSync(localRepositoryRoot(repositoryPath));
  const selected = realpathSync(packageDir);
  const selectedRelative = relative(root, selected);
  if (
    selectedRelative === '' ||
    selectedRelative === '..' ||
    selectedRelative.startsWith(`..${sep}`) ||
    isAbsolute(selectedRelative)
  ) {
    throw new Error('Selected local cloud package is outside the local repository.');
  }
  const selectedParts = selectedRelative.split(sep);
  if (LOCAL_CHECKOUT_EXCLUDES.some((excluded) => selectedParts[0] === excluded) || selectedParts.includes('assets')) {
    throw new Error('Selected local cloud package is outside the package catalog.');
  }

  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (dir === root && LOCAL_CHECKOUT_EXCLUDES.some((excluded) => entry.name === excluded)) {
        continue;
      }
      const entryPath = join(dir, entry.name);
      const sourceStat = lstatSync(entryPath);
      if (sourceStat.isSymbolicLink()) {
        throw new Error(`Local cloud source contains a symbolic link: ${relative(root, entryPath)}`);
      }
      if (sourceStat.isDirectory()) {
        pending.push(entryPath);
      } else if (!sourceStat.isFile()) {
        throw new Error(`Local cloud source contains a special file: ${relative(root, entryPath)}`);
      } else if (sourceStat.nlink !== 1) {
        throw new Error(`Local cloud source contains a hard link: ${relative(root, entryPath)}`);
      }
    }
  }
}

export function loadLocalRepositorySource(
  repositoryPath?: string,
  confined = false,
  buildFromCheckout = false
): LocalRepositorySource {
  const resolvedPath = repositoryPath
    ? isAbsolute(repositoryPath)
      ? repositoryPath
      : resolve(process.cwd(), repositoryPath)
    : bundledRepositoryPath();

  if (repositoryPath && !existsSync(resolvedPath)) {
    throw new Error(`Repository index not found: ${resolvedPath}`);
  }

  const repoBaseDir = buildFromCheckout && repositoryPath ? localRepositoryRoot(repositoryPath) : dirname(resolvedPath);
  let repository: RepositoryJson = {};
  let duplicateIds: ReadonlySet<string> | undefined;
  if (buildFromCheckout) {
    const built = buildRepository(repoBaseDir, { exclude: [...LOCAL_CHECKOUT_EXCLUDES] });
    repository = built.repository;
    duplicateIds = new Set(built.duplicateIds);
  } else if (existsSync(resolvedPath)) {
    const loaded = loadRepositoryIndex(resolvedPath);
    if (loaded.error) {
      if (repositoryPath) {
        throw new Error(`Failed to load repository index (${resolvedPath}): ${loaded.error}`);
      }
      console.warn(`⚠️  Ignoring default repository index (${resolvedPath}): ${loaded.error}`);
    }
    repository = loaded.repository ?? {};
  }

  const sourceRoot = confined ? realpathSync(repoBaseDir) : undefined;
  return {
    repository,
    ...(duplicateIds ? { duplicateIds } : {}),
    loadGuideById(id: string, entry: RepositoryEntry): LoadedGuide | null {
      const rel = entry.path || `${id}/`;
      const contentPath = rel.endsWith('.json') ? join(repoBaseDir, rel) : join(repoBaseDir, rel, 'content.json');
      if (sourceRoot) {
        if (!existsSync(contentPath)) {
          return null;
        }
        const actualPath = realpathSync(contentPath);
        const withinRoot = relative(sourceRoot, actualPath);
        if (withinRoot.startsWith('..') || isAbsolute(withinRoot) || withinRoot === '') {
          throw new Error(`Package "${id}" content is outside the local repository.`);
        }
      }
      return loadGuideFiles([contentPath])[0] ?? null;
    },
  };
}

function assertUnambiguousLocalCloudGraph(repoSource: LocalRepositorySource, selectedIds?: readonly string[]): void {
  if (!selectedIds) {
    throw new Error('Selected local cloud graph package IDs are unavailable.');
  }
  for (const id of selectedIds) {
    if (repoSource.duplicateIds?.has(id)) {
      throw new Error(`Selected local cloud graph contains duplicate package ID "${id}".`);
    }
  }
}

function localPackageEntry(
  options: LocalMetapackageOptions,
  repoSource: LocalRepositorySource,
  manifest: ManifestJson
): RepositoryEntry {
  const entry = repoSource.repository[manifest.id];
  if (!entry) {
    throw new Error(`Root package "${manifest.id}" is missing from the repository index.`);
  }
  if (entry.type !== manifest.type) {
    throw new Error(
      `Root package type mismatch: manifest declares "${manifest.type}", repository declares "${entry.type}".`
    );
  }
  if (
    JSON.stringify(manifest.depends ?? []) !== JSON.stringify(entry.depends ?? []) ||
    JSON.stringify(manifest.milestones ?? []) !== JSON.stringify(entry.milestones ?? []) ||
    JSON.stringify(manifest.provides ?? []) !== JSON.stringify(entry.provides ?? []) ||
    manifest.startingLocation !== entry.startingLocation ||
    manifest.testEnvironment?.tier !== entry.testEnvironment?.tier ||
    manifest.testEnvironment?.instance !== entry.testEnvironment?.instance ||
    manifest.testEnvironment?.minVersion !== entry.testEnvironment?.minVersion ||
    JSON.stringify(manifest.testEnvironment?.plugins ?? []) !== JSON.stringify(entry.testEnvironment?.plugins ?? [])
  ) {
    throw new Error(`Local manifest and repository metadata differ for package "${manifest.id}".`);
  }
  const entryPath = entry.path || `${manifest.id}/`;
  const packagePath = entryPath.endsWith('.json') ? dirname(entryPath) : entryPath;
  const repositoryRoot = realpathSync(localRepositoryRoot(options.repositoryPath!));
  const resolvedPackagePath = realpathSync(resolve(repositoryRoot, packagePath));
  const relativePackagePath = relative(repositoryRoot, resolvedPackagePath);
  if (
    relativePackagePath === '' ||
    relativePackagePath.startsWith('..') ||
    isAbsolute(relativePackagePath) ||
    resolvedPackagePath !== realpathSync(options.packageDir)
  ) {
    throw new Error(`Root package "${manifest.id}" does not match the selected local directory.`);
  }
  return entry;
}

function validateLocalCloudPlan(plan: ExecutionPlan, repoSource: LocalRepositorySource): void {
  for (const planned of plan.chains.flat()) {
    const manifest = loadManifestFromDir(dirname(planned.guide.path));
    const entry = repoSource.repository[planned.id];
    if (!manifest || manifest.type !== 'guide' || manifest.id !== planned.id) {
      throw new Error(`Local package manifest is missing or does not match guide "${planned.id}".`);
    }
    if (manifest.testEnvironment?.tier !== 'cloud' || entry?.testEnvironment?.tier !== 'cloud') {
      throw new Error(
        `Required local guide "${planned.id}" must be declared cloud-tier in its manifest and repository.`
      );
    }
    if (
      manifest.testEnvironment?.instance !== entry.testEnvironment?.instance ||
      manifest.testEnvironment?.minVersion !== entry.testEnvironment?.minVersion ||
      JSON.stringify(manifest.testEnvironment?.plugins ?? []) !==
        JSON.stringify(entry.testEnvironment?.plugins ?? []) ||
      JSON.stringify(manifest.depends ?? []) !== JSON.stringify(entry.depends ?? []) ||
      JSON.stringify(manifest.provides ?? []) !== JSON.stringify(entry.provides ?? []) ||
      manifest.startingLocation !== entry.startingLocation
    ) {
      throw new Error(`Local manifest and repository metadata differ for guide "${planned.id}".`);
    }
  }
}

export function resolveLocalCloudGuide(
  options: LocalMetapackageOptions
): Omit<LocalMetapackageResolution, 'selection'> {
  const manifest = loadManifestFromDir(options.packageDir);
  if (!manifest || manifest.type !== 'guide' || manifest.testEnvironment?.tier !== 'cloud') {
    throw new Error('A local cloud package requires a cloud-tier guide manifest.json.');
  }
  if (!options.repositoryPath) {
    throw new Error('A local cloud guide requires --repository <path>.');
  }
  const repoSource = loadLocalRepositorySource(options.repositoryPath, true, true);
  assertUnambiguousLocalCloudGraph(repoSource, [manifest.id]);
  const rootEntry = localPackageEntry(options, repoSource, manifest);
  const rootGuide = repoSource.loadGuideById(manifest.id, rootEntry);
  if (!rootGuide || deriveGuideId(rootGuide) !== manifest.id) {
    throw new Error(`Root guide "${manifest.id}" content is missing or has a different ID.`);
  }
  const packagePlan = planPackageExecution({
    rootIds: [manifest.id],
    repository: repoSource.repository,
    includeSelectedPackageIds: true,
  });
  if (packagePlan.errors.length > 0) {
    throw new Error(`Failed to plan guide execution: ${packagePlan.errors.join('; ')}`);
  }
  assertUnambiguousLocalCloudGraph(repoSource, packagePlan.selectedPackageIds);
  const plan = hydrateExecutionPlan(
    packagePlan,
    new Map([[manifest.id, rootGuide]]),
    repoSource.repository,
    repoSource.loadGuideById
  );
  if (plan.errors.length > 0) {
    throw new Error(`Failed to plan guide execution: ${plan.errors.join('; ')}`);
  }
  validatePlannedGuides(plan, options.verbose);
  validateLocalCloudPlan(plan, repoSource);
  assertSupportedLocalCloudSources(plan);
  const packageMetaById = new Map<string, PackageMeta>();
  for (const planned of plan.chains.flat()) {
    const entry = repoSource.repository[planned.id];
    const target = resolveTarget(entry?.testEnvironment ?? {}, {
      grafanaUrl: options.grafanaUrl,
      currentTier: options.currentTier,
      cloudUrl: options.cloudUrl,
      cloudTargetCapabilities: options.cloudTargetCapabilities,
    });
    if (!target.runnable) {
      throw new Error(`Required guide "${planned.id}" cannot run: ${target.message ?? target.skipReason}`);
    }
    packageMetaById.set(planned.id, {
      packageId: planned.id,
      tier: target.tier,
      instance: target.instance,
      targetUrl: target.targetUrl!,
      sourceUrl: planned.guide.path,
      ...(entry?.startingLocation !== undefined ? { startingLocation: entry.startingLocation } : {}),
      sideEffects: classifyGuideSideEffectsFromString(planned.guide.content),
      ...(entry?.testEnvironment?.plugins?.length ? { plugins: entry.testEnvironment.plugins } : {}),
    });
  }
  return {
    guides: plan.chains.flatMap((chain) => chain.map((planned) => planned.guide)),
    executionPlan: plan,
    repoSource,
    preRunSkipped: [],
    packageMetaById,
    localPackageDir: options.packageDir,
  };
}

function assertSupportedLocalCloudSources(plan: ExecutionPlan): void {
  const plannedGuides = plan.chains.flat();
  for (const planned of plannedGuides) {
    const reference = unsupportedGuideReference(JSON.parse(planned.guide.content));
    if (reference) {
      throw new LocalCloudNonExecutionError(
        planned.guide,
        `Local cloud guide "${planned.id}" uses unsupported ${reference}; refusing published or bundled fallback.`,
        plannedGuides
      );
    }
  }
}

export function assertExecutableLocalCloudSources(plan: ExecutionPlan): void {
  const plannedGuides = plan.chains.flat();
  for (const planned of plannedGuides) {
    if (!hasInteractiveBlocks(JSON.parse(planned.guide.content).blocks)) {
      throw new LocalCloudNonExecutionError(
        planned.guide,
        `Local cloud guide "${planned.id}" has no interactive blocks to test.`,
        plannedGuides
      );
    }
  }
}

function validatePlannedGuides(plan: ExecutionPlan, verbose: boolean, selection?: ExecutionSelection): void {
  const errors: Array<{ file: string; errors: string[] }> = [];
  for (const planned of plan.chains.flat()) {
    const result = validateGuideFromString(planned.guide.content);
    if (verbose && result.isValid && result.warnings.length > 0) {
      console.log(`⚠️  ${planned.guide.path}: ${result.warnings.length} warning(s)`);
    }
    if (!result.isValid) {
      errors.push({ file: planned.guide.path, errors: toLegacyResult(result).errors });
    }
  }
  if (errors.length > 0) {
    const detail = errors
      .map(({ file, errors: fileErrors }) => [`  ${file}:`, ...fileErrors.map((error) => `    - ${error}`)].join('\n'))
      .join('\n');
    throw new LocalMetapackageResolutionError(`Planned guide validation failed:\n${detail}`, selection);
  }
}

function printPlan(plan: ExecutionPlan, verbose: boolean): void {
  if (plan.autoIncludedIds.length > 0) {
    console.log(
      `\n➕ Auto-included ${plan.autoIncludedIds.length} prerequisite guide(s): ${plan.autoIncludedIds.join(', ')}`
    );
  }
  if (verbose) {
    console.log(`\n🔗 Execution plan: ${plan.chains.length} chain(s)`);
    plan.chains.forEach((chain, index) => {
      const names = chain.map((planned) => `${planned.id}${planned.autoIncluded ? ' (auto)' : ''}`).join(' → ');
      console.log(`   Chain ${index + 1}: ${names}`);
    });
  }
}

export function resolveLocalMetapackage(options: LocalMetapackageOptions): LocalMetapackageResolution | undefined {
  let manifest: ManifestJson | null;
  try {
    manifest = loadManifestFromDir(options.packageDir);
  } catch (error) {
    throw new LocalMetapackageResolutionError(
      `Failed to load manifest.json: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
  if (!manifest || (manifest.type !== 'path' && manifest.type !== 'journey')) {
    return undefined;
  }

  const selection: ExecutionSelection = { id: manifest.id, type: manifest.type };
  if (!options.repositoryPath) {
    throw new LocalMetapackageResolutionError(
      `Local ${manifest.type} packages require --repository <path> to resolve milestones.`,
      selection
    );
  }

  try {
    const repoSource = loadLocalRepositorySource(
      options.repositoryPath,
      options.currentTier === 'cloud',
      options.currentTier === 'cloud'
    );
    if (options.currentTier === 'cloud') {
      assertUnambiguousLocalCloudGraph(repoSource, [manifest.id]);
    }
    const rootEntry =
      options.currentTier === 'cloud'
        ? localPackageEntry(options, repoSource, manifest)
        : repoSource.repository[manifest.id];
    if (!rootEntry) {
      throw new Error(`Root package "${manifest.id}" is missing from the repository index.`);
    }
    if (rootEntry.type !== manifest.type) {
      throw new Error(
        `Root package type mismatch: manifest declares "${manifest.type}", repository declares "${rootEntry.type}".`
      );
    }
    const rootOnlySkip = (status: GuideStatus, abortMessage: string, tier?: string): LocalMetapackageResolution => ({
      guides: [],
      selection,
      repoSource,
      preRunSkipped: [
        {
          guide: options.packageDir,
          id: manifest.id,
          status,
          exitCode: ExitCode.SUCCESS,
          autoIncluded: false,
          abortMessage,
          tier,
        },
      ],
      packageMetaById: new Map(),
      localPackageDir: options.packageDir,
    });
    const targetOptions = {
      grafanaUrl: options.grafanaUrl,
      currentTier: options.currentTier,
      cloudUrl: options.cloudUrl,
      cloudTargetCapabilities: options.cloudTargetCapabilities,
    };
    if (options.currentTier === 'cloud' && rootEntry.testEnvironment?.tier !== 'cloud') {
      throw new Error(`Local ${manifest.type} package must declare testEnvironment.tier "cloud".`);
    }
    const rootTarget = resolveTarget(rootEntry.testEnvironment ?? {}, targetOptions);
    if (!rootTarget.runnable) {
      return rootOnlySkip(rootTarget.skipReason!, rootTarget.message ?? 'Package skipped', rootTarget.tier);
    }

    const packagePlan = planPackageExecution({
      rootIds: [manifest.id],
      repository: repoSource.repository,
      ...(options.currentTier === 'cloud' ? { includeSelectedPackageIds: true } : {}),
    });
    if (options.currentTier === 'cloud' && packagePlan.errors.length === 0) {
      assertUnambiguousLocalCloudGraph(repoSource, packagePlan.selectedPackageIds);
    }
    const executionPlan = hydrateExecutionPlan(packagePlan, new Map(), repoSource.repository, repoSource.loadGuideById);
    if (executionPlan.errors.length > 0) {
      throw new Error(`Failed to plan guide execution: ${executionPlan.errors.join('; ')}`);
    }
    validatePlannedGuides(executionPlan, options.verbose, selection);
    if (options.currentTier === 'cloud') {
      validateLocalCloudPlan(executionPlan, repoSource);
      assertSupportedLocalCloudSources(executionPlan);
    }
    printPlan(executionPlan, options.verbose);

    const packageMetaById = new Map<string, PackageMeta>();
    const preRunSkipped: GuideRunResult[] = [];
    let incompatibleGuideId: string | undefined;
    for (const planned of executionPlan.chains.flat()) {
      const entry = repoSource.repository[planned.id];
      const target = resolveTarget(entry?.testEnvironment ?? {}, targetOptions);
      if (!target.runnable) {
        preRunSkipped.push({
          guide: planned.guide.path,
          id: planned.id,
          status: target.skipReason!,
          exitCode: ExitCode.SUCCESS,
          autoIncluded: planned.autoIncluded,
          abortMessage: target.message ?? 'Guide skipped',
          tier: target.tier,
        });
        continue;
      }
      if (
        target.tier !== rootTarget.tier ||
        target.instance !== rootTarget.instance ||
        !sameOrigin(target.targetUrl, rootTarget.targetUrl)
      ) {
        incompatibleGuideId ??= planned.id;
      }
      packageMetaById.set(planned.id, {
        packageId: planned.id,
        tier: target.tier,
        instance: target.instance,
        targetUrl: target.targetUrl!,
        sourceUrl: planned.guide.path,
        ...(entry?.startingLocation !== undefined ? { startingLocation: entry.startingLocation } : {}),
        sideEffects: classifyGuideSideEffectsFromString(planned.guide.content),
        ...(entry?.testEnvironment?.plugins?.length ? { plugins: entry.testEnvironment.plugins } : {}),
      });
    }

    if (preRunSkipped.length > 0) {
      preRunSkipped.push({
        guide: options.packageDir,
        id: manifest.id,
        status: 'prerequisite_failed',
        exitCode: ExitCode.SUCCESS,
        autoIncluded: false,
        abortMessage: `Required guide(s) did not resolve: ${preRunSkipped.map((item) => item.id).join(', ')}`,
        tier: rootEntry.testEnvironment?.tier,
      });
      return {
        guides: [],
        selection,
        repoSource,
        preRunSkipped,
        packageMetaById: new Map(),
        localPackageDir: options.packageDir,
      };
    }
    if (incompatibleGuideId) {
      return rootOnlySkip(
        'resolution_failed',
        `${manifest.type} package mixes incompatible targets at guide "${incompatibleGuideId}"`,
        rootTarget.tier
      );
    }

    return {
      guides: executionPlan.chains.flatMap((chain) => chain.map((planned) => planned.guide)),
      executionPlan,
      selection,
      repoSource,
      preRunSkipped,
      packageMetaById,
      localPackageDir: options.packageDir,
    };
  } catch (error) {
    if (error instanceof LocalMetapackageResolutionError || error instanceof LocalCloudNonExecutionError) {
      throw error;
    }
    throw new LocalMetapackageResolutionError(
      error instanceof Error ? error.message : 'Unknown local metapackage resolution error',
      selection
    );
  }
}
