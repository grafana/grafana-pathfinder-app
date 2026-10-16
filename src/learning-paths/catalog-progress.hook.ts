import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CatalogPackage } from '../types/package-catalog.types';
import { interactiveCompletionStorage, journeyCompletionStorage, learningProgressStorage } from '../lib/user-storage';
import { meanOfMemberPercentages } from '../lib/guide-stats/rollup';
import { sanitizeContentKey } from '../global-state/content-key';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../global-state/progress-events';
import bundledRepository from '../bundled-interactives/repository.json';
import type { RepositoryJson } from '../types/package.types';

export interface CatalogProgress {
  percent: number;
  nextId?: string;
}

function readGuidePercent(id: string, url: string, record: Record<string, number>): number {
  const urls = url.startsWith('bundled:') ? [`bundled:${id}`, `bundled:${id}/content.json`] : [url];
  return Math.max(
    0,
    ...urls
      .map((key) => record[sanitizeContentKey(key)])
      .filter(
        (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
      )
  );
}

function isBundledGuide(item: CatalogPackage): boolean {
  return (
    item.source === 'grafana' &&
    item.key === `bundled:${item.id}` &&
    (item.url === `bundled:${item.id}` || item.url === `bundled:${item.id}/content.json`) &&
    (bundledRepository as RepositoryJson)[item.id]?.type === 'guide'
  );
}

export function useCatalogProgress(items: CatalogPackage[], scope: string): Map<string, CatalogProgress> {
  const revision = useSyncExternalStore(
    subscribeGuideProgressRevision,
    getGuideProgressRevision,
    getGuideProgressRevision
  );
  const [snapshot, setSnapshot] = useState<{ scope: string; values: Map<string, CatalogProgress> }>({
    scope,
    values: new Map(),
  });
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      interactiveCompletionStorage.getAll(),
      journeyCompletionStorage.getAll(),
      learningProgressStorage.get(),
    ])
      .then(([guides, journeys, progress]) => {
        if (cancelled) {
          return;
        }
        const values = new Map<string, CatalogProgress>();
        for (const item of items) {
          if (item.curatedPath && !item.curatedPath.url) {
            const percentages = item.curatedPath.guides.map((id) =>
              progress.completedGuides.includes(id) ? 100 : readGuidePercent(id, `bundled:${id}`, guides)
            );
            const rollup = meanOfMemberPercentages(percentages);
            values.set(item.key, {
              percent: rollup.percent,
              nextId:
                item.curatedPath.guides[percentages.findIndex((value) => value < 100)] ?? item.curatedPath.guides[0],
            });
          } else {
            const percent =
              item.format === 'guide'
                ? isBundledGuide(item) && progress.completedGuides.includes(item.id)
                  ? 100
                  : readGuidePercent(item.id, item.url, guides)
                : journeys[sanitizeContentKey(item.url)];
            values.set(item.key, {
              percent:
                typeof percent === 'number' && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : 0,
            });
          }
        }
        setSnapshot({ scope, values });
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot({ scope, values: new Map() });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [items, scope, revision]);
  return snapshot.scope === scope ? snapshot.values : new Map();
}
