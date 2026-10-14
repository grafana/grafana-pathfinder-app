import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, useStyles2 } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { getStyles } from '../../styles/context-panel.styles';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { testIds } from '../../constants/testIds';
import { resolvePackageMilestones } from '../../docs-retrieval';
import type { Milestone } from '../../types/content.types';
import type { PackageOpenInfo } from '../../types/content-panel.types';
import type { ResolvedAssignment } from '../../types/learning-paths.types';
import type { PublishedGuide } from '../../utils/usePublishedGuides';
import { AssignmentBadges } from '../LearningPaths/AssignmentBadges';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { LearningModuleList } from '../LearningContentCard/LearningModuleList';
import { learningEffort } from '../LearningContentCard/learning-effort';
import { catalogTopic } from '../../lib/catalog-discovery';

interface CustomGuidesSectionProps {
  guides: PublishedGuide[];
  paths: PublishedGuide[];
  orphanGuides: PublishedGuide[];
  isLoading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void | Promise<void>;
  assignments?: ResolvedAssignment[];
}

function packageInfoForPath(path: PublishedGuide, resolvedMilestones?: Milestone[], trackId?: string): PackageOpenInfo {
  return {
    packageId: path.id,
    // The cover loader needs the entry ID on its slim manifest.
    packageManifest: { ...(path.manifest as unknown as Record<string, unknown>), id: path.id },
    resolvedMilestones,
    launchSource: 'custom_guide',
    ...(trackId && { trackId }),
  };
}

function pathTitle(path: PublishedGuide): string {
  return path.title || path.manifest?.description || path.id;
}

function CustomGuideCard({
  guide,
  index,
  path = false,
  assignment,
  openDocsPage,
}: {
  guide: PublishedGuide;
  index: number;
  path?: boolean;
  assignment?: ResolvedAssignment;
  openDocsPage: CustomGuidesSectionProps['openDocsPage'];
}) {
  const styles = useStyles2(getStyles);
  const [expanded, setExpanded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [response, setResponse] = useState<{ key: string; members: Milestone[]; error?: boolean }>();
  const ids = useMemo(() => guide.manifest?.milestones ?? [], [guide.manifest?.milestones]);
  const requestKey = `${guide.id}:${JSON.stringify(ids)}:${revision}`;
  const cache = useRef<{ key: string; members: Milestone[]; at: number } | undefined>(undefined);
  useEffect(() => {
    if (!expanded || !path || !ids.length) {
      return;
    }
    let cancelled = false;
    const request =
      cache.current?.key === requestKey && Date.now() - cache.current.at < 30_000
        ? Promise.resolve(cache.current.members)
        : (async () => {
            const members: Milestone[] = [];
            for (let offset = 0; offset < ids.length && !cancelled; offset += 8) {
              const batch = await resolvePackageMilestones(ids.slice(offset, offset + 8));
              members.push(...batch.map((member, index) => ({ ...member, number: offset + index + 1 })));
            }
            return members;
          })();
    void request
      .then((members) => {
        if (!cancelled) {
          cache.current = { key: requestKey, members, at: Date.now() };
          setResponse({ key: requestKey, members });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResponse({ key: requestKey, members: [], error: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, path, ids, requestKey]);
  const members = response?.key === requestKey ? response.members : undefined;
  const title = pathTitle(guide);
  const open = () => {
    const guideUrl = `backend-guide:${guide.id}`;
    reportAppInteraction(UserInteraction.OpenResourceClick, {
      content_title: title,
      content_url: guideUrl,
      content_type: getContentTypeForAnalytics(guideUrl, AnalyticsContentType.InteractiveGuide),
      interaction_location: 'custom_guides_section',
    });
    return openDocsPage(guideUrl, title, path ? packageInfoForPath(guide, undefined, assignment?.trackId) : undefined);
  };
  const openMember = (member: Milestone) => {
    if (member.isLocked) {
      return;
    }
    const packageInfo = packageInfoForPath(guide, members);
    // The cover fields must not replace the member's own starting location.
    const {
      startingLocation: _startingLocation,
      additionalFields: _additionalFields,
      ...memberManifest
    } = packageInfo.packageManifest ?? {};
    reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
      content_title: title,
      milestone_title: member.title,
      milestone_number: member.number,
      milestone_url: member.url,
      content_url: `backend-guide:${guide.id}`,
      interaction_location: 'custom_guides_path_members',
    });
    return openDocsPage(member.url, title, { ...packageInfo, packageManifest: memberManifest });
  };
  return (
    <LearningContentCard
      title={title}
      topic={catalogTopic({ id: guide.id, title, category: guide.manifest?.category })}
      kind={path ? 'path' : 'guide'}
      organization
      description={guide.manifest?.description}
      effort={learningEffort(guide.manifest as unknown as Record<string, unknown>, path ? 'path' : 'guide')}
      badges={assignment && <AssignmentBadges assignment={assignment} />}
      onLaunch={open}
      disclosureLabel={path && ids.length ? t('learningCard.showModules', 'Show milestones') : undefined}
      collapseLabel={path && ids.length ? t('learningCard.hideModules', 'Hide milestones') : undefined}
      expanded={expanded}
      onToggleDetails={() => setExpanded((value) => !value)}
      testId={path ? testIds.contextPanel.customGuidePathCard(index) : testIds.contextPanel.customGuideItem(index)}
      actionTestId={
        path
          ? testIds.contextPanel.customGuidePathStartButton(index)
          : testIds.contextPanel.customGuideStartButton(index)
      }
      disclosureTestId={path ? testIds.contextPanel.customGuidePathDrillInButton(index) : undefined}
      details={
        path && ids.length ? (
          <div data-testid={testIds.contextPanel.customGuidePathMembers(index)}>
            {!members && <p role="status">{t('contextPanel.loadingMembers', 'Loading milestones…')}</p>}
            {response?.key === requestKey && response.error ? (
              <div role="alert">
                <p>{t('learningCard.membersError', 'Could not load milestone details.')}</p>
                <button className={styles.summaryButton} onClick={() => setRevision((value) => value + 1)}>
                  {t('learningCard.retry', 'Retry')}
                </button>
              </div>
            ) : (
              <LearningModuleList
                modules={members ?? []}
                onOpen={openMember}
                itemTestId={(memberIndex) => testIds.contextPanel.customGuidePathMemberItem(index, memberIndex)}
              />
            )}
          </div>
        ) : undefined
      }
    />
  );
}

export function CustomGuidesSection({
  guides,
  paths,
  orphanGuides,
  isLoading,
  expanded,
  onToggleExpanded,
  openDocsPage,
  assignments = [],
}: CustomGuidesSectionProps) {
  const styles = useStyles2(getStyles);
  const normalizedGuides = useMemo(() => guides.filter((guide) => guide.id && guide.title), [guides]);
  const hasPaths = paths.length > 0;
  const totalCount = hasPaths ? paths.length + orphanGuides.length : normalizedGuides.length;
  const scope = `${config.namespace || ''}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
  if (!isLoading && totalCount === 0) {
    return null;
  }
  const renderGuide = (guide: PublishedGuide, index: number) => (
    <CustomGuideCard key={`${scope}:${guide.id}`} guide={guide} index={index} openDocsPage={openDocsPage} />
  );
  return (
    <div className={styles.customGuidesSection} data-testid={testIds.contextPanel.customGuidesSection}>
      <div className={styles.customGuidesHeader}>
        <button
          onClick={onToggleExpanded}
          className={styles.customGuidesToggle}
          data-testid={testIds.contextPanel.customGuidesToggle}
          aria-expanded={expanded}
        >
          <Icon name="rocket" size="sm" />
          <span>{t('contextPanel.customGuides', 'Custom guides')}</span>
          <span className={styles.customGuidesCount}>
            <Icon name="list-ul" size="xs" />
            {t('contextPanel.items', '{{count}} items', { count: totalCount })}
          </span>
          <Icon name={expanded ? 'angle-up' : 'angle-down'} size="sm" />
        </button>
      </div>
      {expanded && (
        <div className={styles.customGuidesExpansion}>
          {isLoading ? (
            <div className={styles.customGuidesLoading}>{t('contextPanel.loadingCustomGuides', 'Loading guides…')}</div>
          ) : hasPaths ? (
            <>
              <div
                className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}
                data-testid={testIds.contextPanel.customGuidesList}
              >
                {paths.map((guide, index) => (
                  <CustomGuideCard
                    key={`${scope}:${guide.id}`}
                    guide={guide}
                    index={index}
                    path
                    assignment={assignments.find((assignment) => assignment.targetId === guide.id)}
                    openDocsPage={openDocsPage}
                  />
                ))}
              </div>
              {orphanGuides.length > 0 && (
                <div data-testid={testIds.contextPanel.customGuideOrphanSection}>
                  <h4 className={styles.orphanGuidesHeading}>{t('contextPanel.otherGuides', 'Other guides')}</h4>
                  <div className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}>
                    {orphanGuides.map(renderGuide)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}
              data-testid={testIds.contextPanel.customGuidesList}
            >
              {normalizedGuides.map(renderGuide)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
