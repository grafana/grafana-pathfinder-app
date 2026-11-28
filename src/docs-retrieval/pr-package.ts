import { activePrPreview, fetchSnapshotJson, PrSnapshotFetchError } from '../lib/pr-preview-fetch';
import { snapshotFileUrl } from '../lib/pr-preview-core';
import { withPrTestMarker } from '../lib/pr-test-marker';
import { RuntimeManifestJsonObjectSchema } from '../lib/runtime-manifest';
import { ContentJsonSchema } from '../types/package.schema';
import { getManifestMilestoneIds, getManifestTracks } from '../types/package.types';
import type { Milestone } from '../types/content.types';

export async function fetchPrPackageInfo(url: string) {
  const snapshot = activePrPreview(url);
  if (!snapshot || !snapshot.path.endsWith('/content.json')) {
    return undefined;
  }
  const manifestPath = snapshot.path.replace(/content\.json$/, 'manifest.json');
  let value: unknown;
  try {
    value = await fetchSnapshotJson(snapshot, manifestPath);
  } catch (error) {
    if (snapshot.fetchId.startsWith('kiosklegacy') && error instanceof PrSnapshotFetchError && error.status === 404) {
      return undefined;
    }
    throw error;
  }
  const manifest = RuntimeManifestJsonObjectSchema.parse(value);
  return {
    packageId: manifest.id,
    packageManifest: manifest as Record<string, unknown>,
    repository: manifest.repository,
  };
}

async function loadPrPath(url: string, manifest: Record<string, unknown>) {
  const snapshot = activePrPreview(url);
  if (!snapshot) {
    throw new Error('PR preview requires dev mode');
  }
  const members = new Map<string, Promise<Milestone>>();
  const resolveIds = async (ids: string[]): Promise<Milestone[]> =>
    Promise.all(
      ids.map(async (id, index) => {
        let pending = members.get(id);
        if (!pending) {
          pending = (async (): Promise<Milestone> => {
            const [rawManifest, rawContent] = await Promise.all([
              fetchSnapshotJson(snapshot, `${id}/manifest.json`),
              fetchSnapshotJson(snapshot, `${id}/content.json`),
            ]);
            const child = RuntimeManifestJsonObjectSchema.parse(rawManifest);
            const content = ContentJsonSchema.pick({ id: true })
              .extend({ title: ContentJsonSchema.shape.title.optional() })
              .parse(rawContent);
            if (child.id !== id || content.id !== id) {
              throw new Error(`PR package identity does not match ${id}`);
            }
            return {
              id,
              number: 0,
              title: content.title ?? id,
              url: withPrTestMarker(snapshotFileUrl(snapshot, `${id}/content.json`), snapshot.fetchId),
              isActive: false,
              packageManifest: child,
            };
          })();
          members.set(id, pending);
        }
        return { ...(await pending), number: index + 1 };
      })
    );
  const declared = getManifestTracks(manifest);
  const [milestones, resolved] = await Promise.all([
    resolveIds(getManifestMilestoneIds(manifest)),
    Promise.all(
      declared.map(async (track) => ({
        trackId: track.trackId,
        label: track.label,
        milestones: await resolveIds(track.guides),
      }))
    ),
  ]);
  return {
    milestones,
    tracks: { declared, resolved, authoritative: true },
    baseUrl: withPrTestMarker(snapshotFileUrl(snapshot, `${manifest.id}/content.json`), snapshot.fetchId),
  };
}

const pathCache = new Map<string, ReturnType<typeof loadPrPath>>();
export function resolvePrPath(url: string, manifest: Record<string, unknown>) {
  const snapshot = activePrPreview(url);
  if (!snapshot) {
    return Promise.reject(new Error('PR preview requires dev mode'));
  }
  const key = JSON.stringify([snapshot.owner, snapshot.repo, snapshot.sha, snapshot.fetchId, manifest]);
  const existing = pathCache.get(key);
  if (existing) {
    return existing;
  }
  const pending = loadPrPath(url, manifest).catch((error: unknown) => {
    if (pathCache.get(key) === pending) {
      pathCache.delete(key);
    }
    throw error;
  });
  if (pathCache.size >= 20) {
    pathCache.delete(pathCache.keys().next().value!);
  }
  pathCache.set(key, pending);
  return pending;
}
