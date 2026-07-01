/**
 * Assemble a `PackageOpenInfo` for a path/journey package by overlaying the
 * PR's changed files on top of the published CDN catalog.
 *
 * Changed milestones (content.json in the diff) win; unchanged milestones are
 * served from the CDN. The result mirrors the recommender's package shape so
 * the existing `fetchPackageContent` pipeline renders the cover page, milestone
 * toolbar, and Alt+arrow navigation unchanged.
 */

import type { Milestone } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import { buildPackageFileUrl, type OnlinePackageEntry } from '../../lib/package-recommendations-client';
import type { PrJsonFile } from './github-api';

/** Where a single milestone's content comes from. */
export type MilestoneSource = 'pr' | 'cdn';

/** A content.json found in the PR, paired with its parsed metadata. */
export interface PrContentEntry {
  file: PrJsonFile;
  title?: string;
}

export interface PathPackageBuildInputs {
  /** Canonical package ID of the path/journey. */
  pathId: string;
  /** Author-provided description, used as the tab title when present. */
  description?: string;
  /** Ordered milestone package IDs (from the PR manifest, else the catalog). */
  milestoneIds: string[];
  /** The path's own content.json when it is in the diff (the cover page). */
  coverFromPr?: PrJsonFile;
  /** Manifest to hand the docs panel (PR manifest or the catalog entry's). */
  packageManifest?: Record<string, unknown>;
  /** PR content.json files keyed by their own package ID. */
  prContentById: ReadonlyMap<string, PrContentEntry>;
  /** Published catalog entries keyed by package ID. */
  catalogById: ReadonlyMap<string, OnlinePackageEntry>;
  /** Catalog `baseUrl` for building CDN file URLs. */
  catalogBaseUrl: string;
}

/** A milestone row for the path-mode preview, annotated with its source. */
export interface PathMilestonePreview {
  id: string;
  title: string;
  source: MilestoneSource;
}

export type PathPackageBuildResult =
  | {
      ok: true;
      coverUrl: string;
      title: string;
      packageInfo: PackageOpenInfo;
      preview: PathMilestonePreview[];
    }
  | {
      ok: false;
      reason: 'no_milestones' | 'missing_cover' | 'missing_milestones';
      /** IDs present in neither the PR nor the CDN catalog. */
      missingMilestones?: string[];
    };

/**
 * Format a package ID slug like `pathfinder-roadmap-2026` into a tab-friendly
 * title `Pathfinder Roadmap 2026`. Mirrors `formatSlug` in
 * `src/utils/find-doc-page.ts` so PR-tester tabs and deep-link tabs read alike.
 */
function formatPackageIdAsTitle(id: string): string {
  return id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read the milestone package IDs from a catalog entry's inlined manifest. */
export function getCatalogMilestoneIds(entry: OnlinePackageEntry): string[] {
  const milestones = entry.manifest?.milestones;
  return Array.isArray(milestones) ? milestones.filter((id): id is string => typeof id === 'string') : [];
}

/** Whether a catalog entry is a path or journey (top-level type, else manifest type). */
export function isCatalogPathEntry(entry: OnlinePackageEntry): boolean {
  const manifestType = typeof entry.manifest?.type === 'string' ? (entry.manifest.type as string) : undefined;
  const type = entry.type ?? manifestType;
  return type === 'path' || type === 'journey';
}

/**
 * Find published path/journey entries whose milestones include any of the IDs
 * changed in the PR — so a path is testable even when its own manifest.json
 * isn't in the diff.
 */
export function discoverCatalogPaths(
  catalog: readonly OnlinePackageEntry[],
  changedIds: ReadonlySet<string>
): OnlinePackageEntry[] {
  if (changedIds.size === 0) {
    return [];
  }
  return catalog.filter(
    (entry) => isCatalogPathEntry(entry) && getCatalogMilestoneIds(entry).some((id) => changedIds.has(id))
  );
}

/**
 * Resolve a single milestone to a URL + title, preferring the PR's changed
 * content over the published catalog. Returns `undefined` when the ID is in
 * neither source.
 */
function resolveMilestone(
  id: string,
  inputs: Pick<PathPackageBuildInputs, 'prContentById' | 'catalogById' | 'catalogBaseUrl'>
): { url: string; title: string; source: MilestoneSource } | undefined {
  const pr = inputs.prContentById.get(id);
  const catalogEntry = inputs.catalogById.get(id);
  if (pr) {
    return { url: pr.file.rawUrl, title: pr.title ?? catalogEntry?.title ?? id, source: 'pr' };
  }
  if (catalogEntry) {
    const url = buildPackageFileUrl(inputs.catalogBaseUrl, catalogEntry.path, 'content.json');
    if (url) {
      return { url, title: catalogEntry.title ?? id, source: 'cdn' };
    }
  }
  return undefined;
}

/**
 * Build milestones + packageInfo for a path/journey, overlaying PR-changed
 * content on the published catalog. Fails only when a milestone (or the cover)
 * is resolvable from neither source.
 */
export function buildPathPackageInfo(inputs: PathPackageBuildInputs): PathPackageBuildResult {
  const { pathId, description, milestoneIds, coverFromPr, packageManifest, catalogById, catalogBaseUrl } = inputs;

  if (milestoneIds.length === 0) {
    return { ok: false, reason: 'no_milestones' };
  }

  const catalogCover = catalogById.get(pathId);
  const coverUrl = coverFromPr
    ? coverFromPr.rawUrl
    : catalogCover
      ? buildPackageFileUrl(catalogBaseUrl, catalogCover.path, 'content.json')
      : '';
  if (!coverUrl) {
    return { ok: false, reason: 'missing_cover' };
  }

  const missingMilestones: string[] = [];
  const milestones: Milestone[] = [];
  const preview: PathMilestonePreview[] = [];

  milestoneIds.forEach((id, index) => {
    const resolved = resolveMilestone(id, inputs);
    if (!resolved) {
      missingMilestones.push(id);
      return;
    }
    milestones.push({
      number: index + 1,
      title: resolved.title,
      duration: '',
      url: resolved.url,
      isActive: false,
    });
    preview.push({ id, title: resolved.title, source: resolved.source });
  });

  if (missingMilestones.length > 0) {
    return { ok: false, reason: 'missing_milestones', missingMilestones };
  }

  const trimmedDescription = typeof description === 'string' ? description.trim() : '';
  const title = trimmedDescription || formatPackageIdAsTitle(pathId);

  const packageInfo: PackageOpenInfo = {
    packageId: pathId,
    packageManifest,
    resolvedMilestones: milestones,
  };

  return { ok: true, coverUrl, title, packageInfo, preview };
}
