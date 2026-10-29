import { useEffect, useMemo, useState } from 'react';
import { currentPlatform } from '../../lib/platform';
import { getUserScope } from '../../lib/user-scope';
import type { RawContent } from '../../types/content.types';
import type { AnalyticsCompletionIdentity } from '../../docs-retrieval';
import type { CatalogPackage } from '../../types/package-catalog.types';
import type { DependencyList, PackageResolutionSuccess } from '../../types/package.types';
import { DependencyListSchema, packageIdSchema } from '../../types/package.schema';
import { guideIdentityAnalyticsProperties } from '../../completion-records';
import type { CompletionSuggestionContext } from '../../lib/completion-suggestions';
import { isAllowedContentUrl } from '../../security';
import { createBundledResolver, OnlineCdnPackageResolver, AppPlatformPackageResolver } from '../../package-engine';
import { usePackageCatalog } from '../../learning-paths';

type Manifest = Record<string, unknown>;
const RESOLUTION_LIMIT = 8;
const RESOLUTION_TIMEOUT_MS = 4000;

function relations(manifest: Manifest | undefined): DependencyList {
  const parsed = DependencyListSchema.safeParse(manifest?.suggests);
  return parsed.success ? parsed.data : [];
}

function isOwnManifest(manifest: Manifest | undefined, id: string | undefined): boolean {
  return Boolean(id && manifest?.id === id && manifest.type === 'guide');
}

function catalogItem(resolved: PackageResolutionSuccess, source: 'grafana' | 'organization'): CatalogPackage | null {
  const manifest = resolved.manifest;
  if (!manifest || !['guide', 'path', 'journey'].includes(manifest.type) || manifest.id !== resolved.id) {
    return null;
  }
  const privatePackage = source === 'organization';
  if (
    privatePackage ? resolved.repository !== 'app-platform' : !['bundled', 'online-cdn'].includes(resolved.repository)
  ) {
    return null;
  }
  if (privatePackage && resolved.contentUrl !== `backend-guide:${resolved.id}`) {
    return null;
  }
  const publicUrl =
    resolved.repository === 'bundled'
      ? resolved.contentUrl.startsWith('bundled:')
      : (() => {
          try {
            return ['https:', 'http:'].includes(new URL(resolved.contentUrl).protocol);
          } catch {
            return false;
          }
        })();
  if (!privatePackage && (!publicUrl || !isAllowedContentUrl(resolved.contentUrl))) {
    return null;
  }
  const title = resolved.entryTitle ?? (typeof manifest.title === 'string' ? manifest.title : undefined);
  if (!title) {
    return null;
  }
  return {
    key: `${resolved.repository}:${resolved.id}`,
    id: resolved.id,
    title,
    description: manifest.description,
    category: manifest.category,
    format: manifest.type === 'guide' ? 'guide' : 'path',
    source,
    url: resolved.contentUrl,
    targeting: manifest.targeting,
    estimatedMinutes: manifest.estimatedMinutes,
    memberIds: manifest.type === 'guide' ? undefined : manifest.milestones,
    packageInfo: { packageId: resolved.id, repository: resolved.repository, packageManifest: { ...manifest } },
  };
}

export function useCompletionRecommendations(
  content: RawContent,
  identity?: AnalyticsCompletionIdentity,
  inPath = false
): { items: CatalogPackage[]; scope: string; loading: boolean; context: CompletionSuggestionContext } {
  const visibility = identity && guideIdentityAnalyticsProperties({ kind: 'guide', ...identity }).guide_visibility;
  const isPublic = visibility === 'public';
  const isPrivate = identity?.sourceConfirmed === true && identity.guideSource === 'app-platform';
  const catalog = usePackageCatalog({ enabled: isPublic, publicOnly: true });
  const scope = catalog.scope;
  const pathIdentity = identity?.pathIdentity;
  const parent = content.metadata.packageManifest;
  const own = useMemo(() => {
    if (isOwnManifest(parent, identity?.guideId)) {
      return parent;
    }
    const candidate = catalog.items.find(
      (item) =>
        item.source === 'grafana' &&
        item.id === identity?.guideId &&
        (item.url === content.url || item.packageInfo?.repository === identity?.guideSource)
    )?.packageInfo?.packageManifest;
    return isOwnManifest(candidate, identity?.guideId) ? candidate : undefined;
  }, [parent, identity?.guideId, identity?.guideSource, catalog.items, content.url]);
  const parentManifest =
    inPath &&
    pathIdentity?.sourceConfirmed &&
    (isPublic
      ? guideIdentityAnalyticsProperties({ kind: 'journey', ...pathIdentity }).guide_visibility === 'public'
      : isPrivate && pathIdentity.guideSource === 'app-platform') &&
    parent?.id === pathIdentity.guideId &&
    parent.id !== identity?.guideId
      ? parent
      : undefined;
  const initialContext = useMemo<CompletionSuggestionContext>(
    () => ({
      url: content.url,
      id: identity?.guideId,
      public: isPublic,
      source: isPrivate ? 'organization' : 'grafana',
      inPath,
      pathUrl: content.metadata.learningJourney?.baseUrl ?? content.metadata.trackMemberBaseUrl,
      pathId: pathIdentity?.sourceConfirmed ? pathIdentity.guideId : undefined,
      category: typeof own?.category === 'string' ? own.category : undefined,
      suggests: [...relations(parentManifest), ...relations(own)],
      platform: currentPlatform(),
    }),
    [content.url, content.metadata, identity?.guideId, isPublic, isPrivate, inPath, pathIdentity, own, parentManifest]
  );
  const requestKey = JSON.stringify([scope, initialContext, identity?.guideSource, own]);
  const [resolved, setResolved] = useState<{
    key: string;
    items: CatalogPackage[];
    context: CompletionSuggestionContext;
  } | null>(null);

  useEffect(() => {
    if (resolved?.key === requestKey || (!isPublic && !isPrivate) || (isPublic && catalog.loading)) {
      return;
    }
    let cancelled = false;
    let count = 0;
    const valid = () => !cancelled && getUserScope() === scope;
    const extra: CatalogPackage[] = [];
    let context = initialContext;
    const finish = () => {
      if (valid()) {
        setResolved((previous) =>
          previous?.key === requestKey ? previous : { key: requestKey, items: extra.filter(Boolean), context }
        );
      }
    };
    const timer = setTimeout(() => {
      finish();
      cancelled = true;
    }, RESOLUTION_TIMEOUT_MS);
    const resolve = async (id: string, currentGuide = false): Promise<PackageResolutionSuccess | undefined> => {
      if (!valid() || count >= RESOLUTION_LIMIT || !packageIdSchema.safeParse(id).success) {
        return undefined;
      }
      count++;
      try {
        if (isPrivate) {
          const result = await new AppPlatformPackageResolver().resolve(id, {
            loadContent: 'metadata-only',
            verifyPublished: true,
          });
          return valid() && result.ok && result.id === id && result.repository === 'app-platform' ? result : undefined;
        }
        if (currentGuide && identity?.guideSource !== 'bundled') {
          const online = await new OnlineCdnPackageResolver().resolve(id, { loadContent: 'metadata-only' });
          return valid() && online.ok && online.id === id && online.repository === 'online-cdn' ? online : undefined;
        }
        const bundled = await createBundledResolver().resolve(id, { loadContent: 'metadata-only' });
        if (!valid()) {
          return undefined;
        }
        if (bundled.ok && bundled.id === id && bundled.repository === 'bundled') {
          return bundled;
        }
        if (currentGuide) {
          return undefined;
        }
        const online = await new OnlineCdnPackageResolver().resolve(id, { loadContent: 'metadata-only' });
        return valid() && online.ok && online.id === id && online.repository === 'online-cdn' ? online : undefined;
      } catch {
        return undefined;
      }
    };
    void (async () => {
      let actualOwn = own;
      if (!isOwnManifest(actualOwn, identity?.guideId) && identity?.guideId) {
        actualOwn = (await resolve(identity.guideId, true))?.manifest as Manifest | undefined;
      }
      if (!valid()) {
        return;
      }
      if (!isOwnManifest(actualOwn, identity?.guideId)) {
        actualOwn = undefined;
      }
      context = {
        ...initialContext,
        category: typeof actualOwn?.category === 'string' ? actualOwn.category : undefined,
        suggests: [...relations(parentManifest), ...relations(actualOwn)],
      };
      const ids = [
        ...new Set((context.suggests ?? []).flatMap((clause) => (typeof clause === 'string' ? [clause] : clause))),
      ];
      const pending = ids
        .filter((id) => packageIdSchema.safeParse(id).success)
        .filter((id) => !catalog.items.some((item) => item.id === id && item.source === 'grafana'))
        .slice(0, RESOLUTION_LIMIT - count);
      await Promise.all(
        pending.map(async (id, index) => {
          const result = await resolve(id);
          const item = result ? catalogItem(result, isPrivate ? 'organization' : 'grafana') : null;
          if (valid() && item) {
            extra[index] = item;
          }
        })
      );
      finish();
      clearTimeout(timer);
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    requestKey,
    resolved?.key,
    scope,
    isPublic,
    isPrivate,
    catalog.loading,
    catalog.items,
    identity?.guideId,
    identity?.guideSource,
    own,
    initialContext,
    parentManifest,
  ]);

  const active = resolved?.key === requestKey ? resolved : null;
  const items = useMemo(() => [...catalog.items, ...(active?.items ?? [])], [catalog.items, active?.items]);
  return {
    items,
    scope,
    loading: (isPublic && catalog.loading) || ((isPublic || isPrivate) && !active),
    context: active?.context ?? initialContext,
  };
}
