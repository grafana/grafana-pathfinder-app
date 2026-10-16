import { resolvePackageMilestones } from '../../docs-retrieval';
import { AppPlatformPackageResolver } from '../../package-engine';
import type { Milestone } from '../../types/content.types';
import type { CatalogPackage } from '../../types/package-catalog.types';

const slots = Array.from({ length: 8 }, () => Promise.resolve());
let nextSlot = 0;
let cacheScope = '';
const cache = new Map<string, { member: Milestone; at: number }>();

function schedule<T>(work: () => Promise<T>): Promise<T> {
  const index = nextSlot++ % slots.length;
  const result = slots[index]!.then(work);
  slots[index] = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function loadCatalogMembers(
  item: CatalogPackage,
  known: CatalogPackage[],
  scope: string,
  signal: AbortSignal
): Promise<Milestone[]> {
  if (cacheScope !== scope) {
    cache.clear();
    cacheScope = scope;
  }
  return Promise.all(
    (item.memberIds ?? []).map((id, index) =>
      schedule(async () => {
        if (signal.aborted) {
          throw new Error('cancelled');
        }
        const local = known.find((candidate) => candidate.id === id && candidate.source === item.source);
        if (local) {
          return { id, number: index + 1, title: local.title, url: local.url, isActive: false };
        }
        const key = `${item.source}:${id}`;
        const cached = cache.get(key);
        if (cached && Date.now() - cached.at < 30_000) {
          return { ...cached.member, number: index + 1 };
        }
        let member: Milestone | undefined;
        if (item.source === 'organization') {
          const resolution = await new AppPlatformPackageResolver().resolve(id, { loadContent: 'metadata-only' });
          member = resolution.ok
            ? { id, number: index + 1, title: resolution.entryTitle || id, url: resolution.contentUrl, isActive: false }
            : { id, number: index + 1, title: id, url: '', isActive: false, isLocked: true };
        } else {
          member = (await resolvePackageMilestones([id]))[0];
        }
        if (!member) {
          throw new Error('unavailable');
        }
        if (!signal.aborted && cacheScope === scope && !member.isLocked) {
          cache.set(key, { member, at: Date.now() });
        }
        return { ...member, id, number: index + 1 };
      })
    )
  );
}
