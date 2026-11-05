import { useEffect, useState } from 'react';
import { currentPlatform } from '../../lib/platform';
import { usePathfinderPluginConfig } from '../../hooks';
import { loadMyCompletions } from '../../completion-records/completion-read-client';
import { hasEmittedGuideCompletion, onCompletionRecorded } from '../../completion-records/completion-recorder';
import { resolveOrganizationGuide, type OrganizationGuide } from '../../integrations/organization-guide/resolve';
import { getJourneyCompletionPercentageAsync } from '../../docs-retrieval';

export interface OrganizationGuideEntry {
  guide: OrganizationGuide;
  progress: number;
  completed: boolean;
}

export function useOrganizationGuide(): OrganizationGuideEntry | null {
  const { config, isResolved, hasError } = usePathfinderPluginConfig();
  const id = config.organizationGuideId;
  const [entry, setEntry] = useState<OrganizationGuideEntry | null>(null);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe = () => {};
    if (!isResolved || hasError || !id || currentPlatform() !== 'cloud') {
      return;
    }
    void Promise.all([resolveOrganizationGuide(id), loadMyCompletions()])
      .then(async ([guide, result]) => {
        if (cancelled) {
          return;
        }
        if (!guide) {
          setEntry(null);
          return;
        }
        const local = await getJourneyCompletionPercentageAsync(guide.url);
        if (cancelled) {
          return;
        }
        const matches = (row: { guideId: string; guideSource: string }) =>
          row.guideId === guide.guideId && row.guideSource === 'app-platform';
        const completed =
          hasEmittedGuideCompletion('app-platform', guide.guideId) ||
          local >= 100 ||
          (result.kind === 'ok' &&
            result.data.completions.some((row) => matches(row) && row.maxCompletionPercent >= 100));
        const remote = result.kind === 'ok' ? (result.data.inProgress.find(matches)?.completionPercent ?? 0) : 0;
        setEntry({ guide, completed, progress: completed ? 100 : Math.max(local, remote) });
        unsubscribe = onCompletionRecorded((fact) => {
          if (matches(fact)) {
            setEntry({ guide, completed: true, progress: 100 });
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          setEntry(null);
        }
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [id, isResolved, hasError]);
  return isResolved && !hasError && entry?.guide.resourceName === id ? entry : null;
}
