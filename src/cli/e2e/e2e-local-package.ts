import { existsSync } from 'fs';
import { dirname, isAbsolute, join, resolve } from 'path';

import { toLegacyResult, validateGuideFromString } from '../../validation';
import type { ManifestJson, RepositoryEntry, RepositoryJson } from '../../types/package.types';
import { bundledRepositoryPath, loadGuideFiles, loadRepositoryIndex, type LoadedGuide } from '../utils/file-loader';
import { classifyGuideSideEffectsFromString } from './side-effects';
import { resolveTarget, sameOrigin } from './e2e-targets';
import { ExitCode } from './exit-codes';
import { hydrateExecutionPlan, planPackageExecution, type ExecutionPlan } from './guide-chains';
import { loadManifestFromDir, type CurrentTier } from './manifest-preflight';
import type { GuideRunResult, GuideStatus, PackageMeta } from './e2e-results';
import type { ExecutionSelection } from './schemas/e2e-report.schema';

export interface LocalRepositorySource {
  repository: RepositoryJson;
  loadGuideById: (id: string, entry: RepositoryEntry) => LoadedGuide | null;
}

export interface LocalMetapackageOptions {
  packageDir: string;
  repositoryPath?: string;
  grafanaUrl: string;
  currentTier: CurrentTier;
  cloudUrl: string;
  verbose: boolean;
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

export function loadLocalRepositorySource(repositoryPath?: string): LocalRepositorySource {
  const resolvedPath = repositoryPath
    ? isAbsolute(repositoryPath)
      ? repositoryPath
      : resolve(process.cwd(), repositoryPath)
    : bundledRepositoryPath();

  if (repositoryPath && !existsSync(resolvedPath)) {
    throw new Error(`Repository index not found: ${resolvedPath}`);
  }

  let repository: RepositoryJson = {};
  if (existsSync(resolvedPath)) {
    const loaded = loadRepositoryIndex(resolvedPath);
    if (loaded.error) {
      if (repositoryPath) {
        throw new Error(`Failed to load repository index (${resolvedPath}): ${loaded.error}`);
      }
      console.warn(`⚠️  Ignoring default repository index (${resolvedPath}): ${loaded.error}`);
    }
    repository = loaded.repository ?? {};
  }

  const repoBaseDir = dirname(resolvedPath);
  return {
    repository,
    loadGuideById(id: string, entry: RepositoryEntry): LoadedGuide | null {
      const rel = entry.path || `${id}/`;
      const contentPath = rel.endsWith('.json') ? join(repoBaseDir, rel) : join(repoBaseDir, rel, 'content.json');
      return loadGuideFiles([contentPath])[0] ?? null;
    },
  };
}

function validatePlannedGuides(plan: ExecutionPlan, verbose: boolean, selection: ExecutionSelection): void {
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
    const repoSource = loadLocalRepositorySource(options.repositoryPath);
    const rootEntry = repoSource.repository[manifest.id];
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
    };
    const rootTarget = resolveTarget(rootEntry.testEnvironment ?? {}, targetOptions);
    if (!rootTarget.runnable) {
      return rootOnlySkip(rootTarget.skipReason!, rootTarget.message ?? 'Package skipped', rootTarget.tier);
    }

    const packagePlan = planPackageExecution({ rootIds: [manifest.id], repository: repoSource.repository });
    const executionPlan = hydrateExecutionPlan(packagePlan, new Map(), repoSource.repository, repoSource.loadGuideById);
    if (executionPlan.errors.length > 0) {
      throw new Error(`Failed to plan guide execution: ${executionPlan.errors.join('; ')}`);
    }
    validatePlannedGuides(executionPlan, options.verbose, selection);
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
    if (error instanceof LocalMetapackageResolutionError) {
      throw error;
    }
    throw new LocalMetapackageResolutionError(
      error instanceof Error ? error.message : 'Unknown local metapackage resolution error',
      selection
    );
  }
}
