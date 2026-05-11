/**
 * Build a `PackageOpenInfo` for a path/journey package found in a PR.
 *
 * Mirrors the recommender's `getRecommendationPackageInfo` shape so the PR
 * tester can hand the docs panel a manifest plus pre-resolved milestones, and
 * the existing `fetchPackageContent` pipeline takes care of the cover page,
 * milestone toolbar, and Alt+arrow navigation. No synthetic mega-guide, no
 * sessionStorage round-trips.
 */

import type { Milestone } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { ManifestJson } from '../../types/package.types';
import type { PrJsonFile } from './github-api';

export interface PathPackageBuildInputs {
  /**
   * Content files indexed by directory name — used to locate the path
   * package's own `content.json` (the cover page).
   *
   * The caller computes this once via {@link indexPrFiles} and shares it
   * with {@link indexContentByPackageId}, avoiding a second iteration over
   * the full `files` array per build.
   */
  contentByDir: ReadonlyMap<string, PrJsonFile>;
  /** A loaded path/journey manifest (one entry from the PR). */
  manifest: ManifestJson;
  /** Directory name of the package the manifest belongs to. */
  manifestDirectory: string;
  /**
   * Resolves a milestone package ID (from `manifest.milestones[]`) to its
   * `content.json` file in the PR.
   *
   * Built by the caller from sibling `manifest.json` files: each child
   * package's `manifest.id` is the canonical key, *not* its directory name.
   * Production behaves the same way — directory layout is storage, package ID
   * is identity (see `package.schema.ts` `PACKAGE_ID_REGEX` notes).
   */
  contentByPackageId: ReadonlyMap<string, PrJsonFile>;
}

export type PathPackageBuildResult =
  | {
      ok: true;
      /** URL of the path package's own content.json — opens as the cover page. */
      coverUrl: string;
      /** Title to display on the tab. */
      title: string;
      /** Manifest + pre-resolved milestones to feed straight into openDocsPage. */
      packageInfo: PackageOpenInfo;
      /** Manifest milestone IDs that have no matching content.json in the PR. */
      missingMilestones: string[];
    }
  | {
      ok: false;
      reason: 'not_path_package' | 'no_milestones' | 'missing_cover' | 'missing_milestones';
      missingMilestones?: string[];
    };

/**
 * Index PR JSON files by `(directoryName, kind)` for O(1) lookup during
 * milestone resolution.
 */
export function indexPrFiles(files: readonly PrJsonFile[]): {
  contentByDir: Map<string, PrJsonFile>;
  manifestByDir: Map<string, PrJsonFile>;
} {
  const contentByDir = new Map<string, PrJsonFile>();
  const manifestByDir = new Map<string, PrJsonFile>();
  for (const file of files) {
    if (file.kind === 'content') {
      contentByDir.set(file.directoryName, file);
    } else {
      manifestByDir.set(file.directoryName, file);
    }
  }
  return { contentByDir, manifestByDir };
}

/**
 * Build a `(packageId -> contentFile)` index by joining sibling
 * `manifest.json` and `content.json` files in the PR.
 *
 * Critical: `manifest.milestones` lists **package IDs**, not directory names.
 * In production the resolver maps IDs to paths via `repository.json`; for
 * the PR tester we read each child package's own manifest to recover that
 * mapping locally. (Without this we'd silently fail when authors organise
 * packages under numbered/prefixed directories like `01-where-we-are/`
 * while the manifest declares `id: "pathfinder-roadmap-where-we-are"`.)
 *
 * Manifests without a sibling `content.json` are skipped (no file to index);
 * orphan content files (no sibling manifest) are also skipped because their
 * canonical package ID is unknown.
 *
 * Takes a pre-computed `contentByDir` map so the caller can share one
 * {@link indexPrFiles} iteration across this function and
 * {@link buildPathPackageInfo}.
 */
export function indexContentByPackageId(
  contentByDir: ReadonlyMap<string, PrJsonFile>,
  manifestsByDirectory: ReadonlyMap<string, ManifestJson>
): Map<string, PrJsonFile> {
  const result = new Map<string, PrJsonFile>();
  for (const [directory, manifest] of manifestsByDirectory) {
    const contentFile = contentByDir.get(directory);
    if (!contentFile) {
      continue;
    }
    if (typeof manifest.id === 'string' && manifest.id.length > 0) {
      result.set(manifest.id, contentFile);
    }
  }
  return result;
}

/**
 * Build milestones + packageInfo for a single path/journey manifest in the PR.
 *
 * Each milestone ID in `manifest.milestones` is resolved through
 * `contentByPackageId` (built by {@link indexContentByPackageId} from sibling
 * manifests). Missing milestones are reported but do not silently fail —
 * callers decide how to surface them.
 */
export function buildPathPackageInfo(inputs: PathPackageBuildInputs): PathPackageBuildResult {
  const { contentByDir, manifest, manifestDirectory, contentByPackageId } = inputs;

  if (manifest.type !== 'path' && manifest.type !== 'journey') {
    return { ok: false, reason: 'not_path_package' };
  }

  const milestoneIds = Array.isArray(manifest.milestones) ? manifest.milestones : [];
  if (milestoneIds.length === 0) {
    return { ok: false, reason: 'no_milestones' };
  }

  const cover = contentByDir.get(manifestDirectory);
  if (!cover) {
    // The path package's own content.json is the cover page; without it
    // fetchPackageContent has nothing to render at currentMilestone === 0.
    return { ok: false, reason: 'missing_cover' };
  }

  const missingMilestones: string[] = [];
  const milestones: Milestone[] = milestoneIds.map((id, index) => {
    const file = contentByPackageId.get(id);
    if (!file) {
      missingMilestones.push(id);
    }
    return {
      number: index + 1,
      title: id,
      duration: '',
      // Empty URL signals "unresolved" to the milestone navigator; the caller
      // gates the open action when missingMilestones is non-empty so this
      // never reaches the runtime in practice.
      url: file ? file.rawUrl : '',
      isActive: false,
    };
  });

  if (missingMilestones.length > 0) {
    return { ok: false, reason: 'missing_milestones', missingMilestones };
  }

  const title = manifest.id;

  const packageInfo: PackageOpenInfo = {
    packageId: manifest.id,
    packageManifest: manifest as unknown as Record<string, unknown>,
    resolvedMilestones: milestones,
  };

  return {
    ok: true,
    coverUrl: cover.rawUrl,
    title,
    packageInfo,
    missingMilestones,
  };
}
