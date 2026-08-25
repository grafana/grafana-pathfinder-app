/**
 * Package context factories for the two manifest-backed My Learning launches:
 * App Platform path members, and Discover More cards.
 *
 * Both derive `PackageOpenInfo` from a catalogue manifest that carries no `id`
 * of its own (the id lives on the entry), so both graft the entry id onto the
 * manifest — `fetchPackageContent` recovers the path cover baseUrl from
 * `packageManifest.id`, and without it "back to cover" breaks.
 *
 * They live here rather than inline in the launch handlers so the launch-path
 * parity matrix can call the same code the UI calls.
 */

import { ManifestJsonObjectSchema } from '../types/package.schema';
import type { PackageOpenInfo } from '../types/content-panel.types';
import type { DiscoverMoreItem, LearningPath } from '../types/learning-paths.types';
import type { ManifestJson } from '../types/package.types';

/** Mirrors online-cdn-resolver.ts's handling of the same OnlinePackageEntry.manifest shape. */
export function parseDiscoverMoreManifest(manifest: Record<string, unknown> | undefined): ManifestJson | undefined {
  if (!manifest) {
    return undefined;
  }
  const parsed = ManifestJsonObjectSchema.loose().safeParse(manifest);
  return parsed.success ? (parsed.data as ManifestJson) : undefined;
}

/**
 * App Platform paths carry a manifest but no cover `url`, so a member launches
 * as `backend-guide:<id>`. Without the PATH manifest as packageInfo the loader
 * falls through to plain fetchContent and the member renders as a standalone
 * guide with no milestone toolbar, next/prev, or cover.
 */
export function packageInfoForPathMember(path: LearningPath | undefined): PackageOpenInfo | undefined {
  if (!path?.manifest) {
    return undefined;
  }
  return { packageId: path.id, packageManifest: { ...path.manifest, id: path.id } };
}

/**
 * `prepareGuideLaunch` backfills packageInfo from the URL when absent, but the
 * Discover More manifest is already inlined — passing it saves that re-fetch.
 */
export function packageInfoForDiscoverItem(item: DiscoverMoreItem): PackageOpenInfo | undefined {
  if (!item.manifest) {
    return undefined;
  }
  return { packageId: item.id, packageManifest: { ...item.manifest, id: item.id } };
}
