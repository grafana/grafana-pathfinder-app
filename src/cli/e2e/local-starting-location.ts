import { resolveCliPath } from '../utils/file-loader';
import type { ManifestJson } from '../../types/package.types';
import type { LocalRepositorySource } from './e2e-local-package';
import type { PackageMeta } from './e2e-results';
import type { ExecutionPlan } from './guide-chains';

function sameGuideFile(left: string, right: string): boolean {
  return resolveCliPath(left) === resolveCliPath(right);
}

export function applyLocalRepositoryStartingLocations(
  plan: ExecutionPlan,
  repoSource: LocalRepositorySource,
  packageMetaById: Map<string, PackageMeta>
): void {
  for (const planned of plan.chains.flat()) {
    const entry = repoSource.repository[planned.id];
    if (entry?.startingLocation === undefined) {
      continue;
    }
    const repositoryGuide = repoSource.loadGuideById(planned.id, entry);
    if (!repositoryGuide || !sameGuideFile(repositoryGuide.path, planned.guide.path)) {
      continue;
    }
    const current = packageMetaById.get(planned.id);
    packageMetaById.set(planned.id, {
      ...current,
      packageId: current?.packageId ?? planned.id,
      startingLocation: entry.startingLocation,
    });
  }
}

export function applyLocalManifestStartingLocation(
  manifest: Pick<ManifestJson, 'id' | 'startingLocation'>,
  packageMetaById: Map<string, PackageMeta>
): void {
  const current = packageMetaById.get(manifest.id);
  packageMetaById.set(manifest.id, {
    ...current,
    packageId: manifest.id,
    ...(manifest.startingLocation !== undefined ? { startingLocation: manifest.startingLocation } : {}),
  });
}
