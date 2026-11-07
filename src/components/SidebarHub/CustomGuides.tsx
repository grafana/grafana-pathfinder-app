import React, { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { Button, Combobox, Text, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { SkeletonLoader } from '../SkeletonLoader';
import { testIds } from '../../constants/testIds';
import type { Milestone } from '../../types/content.types';
import { FOUNDATIONS_TRACK_ID } from '../../types/package.types';
import { journeyMilestonePercentages, resolvePackageMilestones } from '../../docs-retrieval';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { GuideRow } from './GuideRow';
import type { HubExpansion } from './GuideDetails';
import type { CustomHubGuide, CustomPathMembers } from './custom-guides';
import { getSidebarHubStyles } from './sidebar-hub.styles';

const COLLAPSED_COUNT = 3;
const RESOLVE_BATCH_SIZE = 8;

type Launch = (launch: () => void | Promise<void>) => void | Promise<void>;

interface CustomGuidesProps {
  guides: CustomHubGuide[];
  isLoading: boolean;
  onLaunch: Launch;
}

async function resolveInBatches(ids: string[]): Promise<Milestone[]> {
  const milestones: Milestone[] = [];
  for (let offset = 0; offset < ids.length; offset += RESOLVE_BATCH_SIZE) {
    const batch = await resolvePackageMilestones(ids.slice(offset, offset + RESOLVE_BATCH_SIZE));
    milestones.push(...batch.map((milestone, index) => ({ ...milestone, number: offset + index + 1 })));
  }
  return milestones;
}

function defaultTrackId(members: CustomPathMembers | undefined): string {
  if (!members || members.milestoneIds.length > 0) {
    return members?.initialTrackId ?? FOUNDATIONS_TRACK_ID;
  }
  return members.initialTrackId ?? members.tracks[0]?.trackId ?? FOUNDATIONS_TRACK_ID;
}

function sequenceIds(members: CustomPathMembers, trackId: string): string[] {
  return members.tracks.find((track) => track.trackId === trackId)?.guides ?? members.milestoneIds;
}

/** Lazily resolves the selected sequence on first expand; an empty result is a failed load. */
function usePathMilestones(members: CustomPathMembers | undefined, expanded: boolean) {
  // Only an explicit pick is state, so an assignment that loads after the row still selects its track.
  const [picked, setPicked] = useState<string>();
  const trackId = picked ?? defaultTrackId(members);
  const [resolved, setResolved] = useState<Record<string, Milestone[]>>({});
  const key = members ? `${trackId}:${sequenceIds(members, trackId).join('\n')}` : '';
  const sequence = resolved[key];

  useEffect(() => {
    if (!expanded || !members || sequence) {
      return;
    }
    let cancelled = false;
    const settle = (milestones: Milestone[]) => {
      if (!cancelled) {
        setResolved((current) => ({ ...current, [key]: milestones }));
      }
    };
    resolveInBatches(sequenceIds(members, trackId)).then(settle, () => settle([]));
    return () => {
      cancelled = true;
    };
  }, [expanded, members, key, trackId, sequence]);

  const retry = () =>
    setResolved((current) => Object.fromEntries(Object.entries(current).filter(([entry]) => entry !== key)));
  // Unpublished members and a resolver outage both come back locked, so only a re-expand retries them.
  const refreshIfUnavailable = () => {
    if (sequence && !sequence.some((milestone) => !milestone.isLocked)) {
      retry();
    }
  };
  return { trackId, setTrackId: setPicked, sequence, retry, refreshIfUnavailable };
}

function usePathExpansion(members: CustomPathMembers | undefined): HubExpansion | undefined {
  const styles = useStyles2(getSidebarHubStyles);
  const trackFieldId = useId();
  const [expanded, setExpanded] = useState(false);
  const { trackId, setTrackId, sequence, retry, refreshIfUnavailable } = usePathMilestones(members, expanded);
  useSyncExternalStore(subscribeGuideProgressRevision, getGuideProgressRevision, getGuideProgressRevision);
  if (!members) {
    return undefined;
  }

  const modules = sequence ?? [];
  const progress: Record<string, number> = {};
  for (const { milestone, percent } of journeyMilestonePercentages(members.baseUrl, modules)) {
    if (milestone.id && percent !== undefined) {
      progress[milestone.id] = percent;
    }
  }
  const currentIndex = modules.findIndex((milestone) => !milestone.isLocked && progress[milestone.id ?? ''] !== 100);
  const onTrack = members.tracks.some((track) => track.trackId === trackId);

  return {
    expanded,
    hasDetails: true,
    hasModules: true,
    modules,
    isResolving: expanded && !sequence,
    totalSteps: sequenceIds(members, trackId).length,
    progress,
    currentIndex: currentIndex >= 0 ? currentIndex : undefined,
    controls: members.tracks.length > 0 && (
      <div className={styles.detailsField}>
        <label htmlFor={trackFieldId}>{t('sidebarHub.track', 'Track')}</label>
        <Combobox
          id={trackFieldId}
          value={trackId}
          options={[
            ...(members.milestoneIds.length > 0
              ? [{ value: FOUNDATIONS_TRACK_ID, label: t('coverPage.foundationsTab', 'Fundamentals') }]
              : []),
            ...members.tracks.map((track) => ({ value: track.trackId, label: track.label })),
          ]}
          onChange={(option) => setTrackId(option.value)}
        />
      </div>
    ),
    onRetry: sequence?.length === 0 ? retry : undefined,
    onToggle: () => {
      if (!expanded) {
        refreshIfUnavailable();
      }
      setExpanded((value) => !value);
    },
    onOpenModule: (milestone) => members.openMilestone(milestone, modules, onTrack ? trackId : undefined),
  };
}

function CustomGuideRow({ guide, index, onLaunch }: { guide: CustomHubGuide; index: number; onLaunch: Launch }) {
  const expansion = usePathExpansion(guide.members);
  return (
    <GuideRow
      guide={{ ...guide, expansion }}
      testId={testIds.sidebarHub.customRow(index)}
      expansionTestIds={{
        toggle: testIds.sidebarHub.customRowToggle(index),
        details: testIds.sidebarHub.customRowDetails(index),
        loading: testIds.sidebarHub.customRowDetailsLoading(index),
        module: (moduleIndex) => testIds.sidebarHub.customRowModule(index, moduleIndex),
      }}
      onLaunch={() => onLaunch(guide.onLaunch)}
      onOpenModule={expansion && ((milestone) => onLaunch(() => expansion.onOpenModule(milestone)))}
    />
  );
}

export function CustomGuides({ guides, isLoading, onLaunch }: CustomGuidesProps) {
  const styles = useStyles2(getSidebarHubStyles);
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <div data-testid={testIds.sidebarHub.customGuidesLoading}>
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }
  if (guides.length === 0) {
    return null;
  }
  const visible = expanded ? guides : guides.slice(0, COLLAPSED_COUNT);

  return (
    <section aria-label={t('contextPanel.customGuides', 'Custom guides')} data-testid={testIds.sidebarHub.customGuides}>
      <div className={styles.sectionHeader}>
        <Text element="h3" variant="h5">
          {t('contextPanel.customGuides', 'Custom guides')}
        </Text>
        <Text variant="bodySmall" color="secondary">
          {t('contextPanel.items', '{{count}} items', { count: guides.length })}
        </Text>
      </div>
      <ul className={styles.list}>
        {visible.map((guide, index) => (
          <CustomGuideRow key={guide.key} guide={guide} index={index} onLaunch={onLaunch} />
        ))}
      </ul>
      {guides.length > COLLAPSED_COUNT && (
        <Button
          variant="secondary"
          fill="text"
          size="sm"
          icon={expanded ? 'angle-up' : 'angle-down'}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          data-testid={testIds.sidebarHub.customGuidesToggle}
        >
          {expanded
            ? t('learningCard.showLess', 'Show less')
            : t('sidebarHub.showAll', 'Show all {{total}}', { total: guides.length })}
        </Button>
      )}
    </section>
  );
}
