import React, { useMemo, useState } from 'react';
import { Card, Icon, useStyles2 } from '@grafana/ui';
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
import type { PublishedGuide } from '../../utils/usePublishedGuides';

interface CustomGuidesSectionProps {
  /** Full flat list — rendered unchanged when no path/journey manifests exist (RFC §7.3). */
  guides: PublishedGuide[];
  /** Published `path`/`journey` packages, shown as cards ahead of loose guides. */
  paths: PublishedGuide[];
  /** Published `guide`-type entries not referenced as any path's member. */
  orphanGuides: PublishedGuide[];
  isLoading: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
}

function packageInfoForPath(path: PublishedGuide, resolvedMilestones?: Milestone[]): PackageOpenInfo {
  return {
    packageId: path.id,
    packageManifest: path.manifest as unknown as Record<string, unknown>,
    resolvedMilestones,
  };
}

function pathTitle(path: PublishedGuide): string {
  return path.manifest?.description || path.title || path.id;
}

export function CustomGuidesSection({
  guides,
  paths,
  orphanGuides,
  isLoading,
  expanded,
  onToggleExpanded,
  openDocsPage,
}: CustomGuidesSectionProps) {
  const styles = useStyles2(getStyles);
  const [expandedMembers, setExpandedMembers] = useState<Record<string, Milestone[] | 'loading' | undefined>>({});

  const normalizedGuides = useMemo(() => guides.filter((guide) => guide.id && guide.title), [guides]);
  const hasPaths = paths.length > 0;
  const totalCount = hasPaths ? paths.length + orphanGuides.length : normalizedGuides.length;

  const openCustomGuide = (guide: PublishedGuide, title: string, packageInfo?: PackageOpenInfo) => {
    const guideUrl = `backend-guide:${guide.id}`;

    reportAppInteraction(UserInteraction.OpenResourceClick, {
      content_title: title,
      content_url: guideUrl,
      content_type: getContentTypeForAnalytics(guideUrl, AnalyticsContentType.InteractiveGuide),
      interaction_location: 'custom_guides_section',
    });

    openDocsPage(guideUrl, title, packageInfo);
  };

  const toggleMembers = async (path: PublishedGuide) => {
    const current = expandedMembers[path.id];
    if (current !== undefined) {
      // Collapse — clear so a re-expand re-resolves fresh (paths are mutable, §6.8).
      setExpandedMembers((prev) => {
        const next = { ...prev };
        delete next[path.id];
        return next;
      });
      return;
    }

    setExpandedMembers((prev) => ({ ...prev, [path.id]: 'loading' }));
    const milestoneIds = path.manifest?.milestones ?? [];
    const resolved = await resolvePackageMilestones(milestoneIds);
    setExpandedMembers((prev) => ({ ...prev, [path.id]: resolved }));
  };

  const openMember = (path: PublishedGuide, member: Milestone) => {
    if (member.isLocked) {
      return;
    }
    const title = pathTitle(path);
    const resolvedMembers = expandedMembers[path.id];
    const packageInfo = packageInfoForPath(path, Array.isArray(resolvedMembers) ? resolvedMembers : undefined);

    reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
      content_title: title,
      milestone_title: member.title,
      milestone_number: member.number,
      milestone_url: member.url,
      content_url: `backend-guide:${path.id}`,
      interaction_location: 'custom_guides_path_members',
    });

    openDocsPage(member.url, title, packageInfo);
  };

  if (!isLoading && totalCount === 0) {
    return null;
  }

  return (
    <div className={styles.customGuidesSection} data-testid={testIds.contextPanel.customGuidesSection}>
      <div className={styles.customGuidesHeader}>
        <button
          onClick={onToggleExpanded}
          className={styles.customGuidesToggle}
          data-testid={testIds.contextPanel.customGuidesToggle}
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
            <div className={styles.customGuidesLoading}>
              {t('contextPanel.loadingCustomGuides', 'Loading guides...')}
            </div>
          ) : hasPaths ? (
            <>
              <div
                className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}
                data-testid={testIds.contextPanel.customGuidesList}
              >
                {paths.map((path, index) => {
                  const members = expandedMembers[path.id];
                  const isMembersExpanded = members !== undefined;
                  const title = pathTitle(path);
                  const isJourney = path.manifest?.type === 'journey';

                  return (
                    <Card
                      key={path.id}
                      className={`${styles.recommendationCard} ${styles.customGuideCard}`}
                      data-testid={testIds.contextPanel.customGuidePathCard(index)}
                    >
                      <div className={styles.recommendationCardContent}>
                        <div className={styles.cardHeader}>
                          <div className={styles.cardTitleSection}>
                            <h3 className={styles.recommendationCardTitle}>{title}</h3>
                            <span className={styles.customGuideTag}>
                              {isJourney
                                ? t('contextPanel.customJourneyTag', 'Journey')
                                : t('contextPanel.customPathTag', 'Path')}
                            </span>
                          </div>
                          <div className={styles.cardActions}>
                            <button
                              onClick={() => openCustomGuide(path, title, packageInfoForPath(path))}
                              className={styles.startButton}
                              data-testid={testIds.contextPanel.customGuidePathStartButton(index)}
                            >
                              <Icon name="rocket" size="sm" />
                              {t('contextPanel.start', 'Start')}
                            </button>
                          </div>
                        </div>
                        <button
                          onClick={() => toggleMembers(path)}
                          className={styles.summaryButton}
                          data-testid={testIds.contextPanel.customGuidePathDrillInButton(index)}
                        >
                          <Icon name="list-ul" size="sm" />
                          <span>{t('contextPanel.viewMembers', 'View members')}</span>
                          <Icon name={isMembersExpanded ? 'angle-up' : 'angle-down'} size="sm" />
                        </button>

                        {isMembersExpanded && (
                          <div
                            className={styles.milestonesSection}
                            data-testid={testIds.contextPanel.customGuidePathMembers(index)}
                          >
                            {members === 'loading' ? (
                              <div className={styles.customGuidesLoading}>
                                {t('contextPanel.loadingMembers', 'Loading members...')}
                              </div>
                            ) : (
                              <div className={styles.milestonesList}>
                                {members!.map((member, memberIndex) => (
                                  <button
                                    key={`${member.number}-${member.title}`}
                                    onClick={() => openMember(path, member)}
                                    disabled={member.isLocked}
                                    className={`${styles.milestoneItem} ${member.isLocked ? styles.milestoneItemLocked : ''}`}
                                    data-testid={testIds.contextPanel.customGuidePathMemberItem(index, memberIndex)}
                                  >
                                    <div className={styles.milestoneNumber}>{member.number}</div>
                                    <div className={styles.milestoneContent}>
                                      <div className={styles.milestoneTitle}>
                                        {member.title}
                                        {member.isLocked && (
                                          <span className={styles.milestoneDuration}>
                                            {t('contextPanel.notYetAvailable', '(not yet available)')}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    {member.isLocked && <Icon name="lock" size="sm" />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>

              {orphanGuides.length > 0 && (
                <div data-testid={testIds.contextPanel.customGuideOrphanSection}>
                  <h4 className={styles.orphanGuidesHeading}>{t('contextPanel.otherGuides', 'Other guides')}</h4>
                  <div className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}>
                    {orphanGuides.map((guide, index) => (
                      <Card
                        key={guide.id}
                        className={`${styles.recommendationCard} ${styles.customGuideCard}`}
                        data-testid={testIds.contextPanel.customGuideItem(index)}
                      >
                        <div className={styles.recommendationCardContent}>
                          <div className={styles.cardHeader}>
                            <div className={styles.cardTitleSection}>
                              <h3 className={styles.recommendationCardTitle}>{guide.title}</h3>
                              <span className={styles.customGuideTag}>
                                {t('contextPanel.customGuideTag', 'Custom guide')}
                              </span>
                            </div>
                            <div className={styles.cardActions}>
                              <button
                                onClick={() => openCustomGuide(guide, guide.title || guide.id)}
                                className={styles.startButton}
                                data-testid={testIds.contextPanel.customGuideStartButton(index)}
                              >
                                <Icon name="rocket" size="sm" />
                                {t('contextPanel.start', 'Start')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div
              className={`${styles.customGuidesList} ${styles.recommendationsGrid}`}
              data-testid={testIds.contextPanel.customGuidesList}
            >
              {normalizedGuides.map((guide, index) => (
                <Card
                  key={guide.id}
                  className={`${styles.recommendationCard} ${styles.customGuideCard}`}
                  data-testid={testIds.contextPanel.customGuideItem(index)}
                >
                  <div className={styles.recommendationCardContent}>
                    <div className={styles.cardHeader}>
                      <div className={styles.cardTitleSection}>
                        <h3 className={styles.recommendationCardTitle}>{guide.title}</h3>
                        <span className={styles.customGuideTag}>
                          {t('contextPanel.customGuideTag', 'Custom guide')}
                        </span>
                      </div>
                      <div className={styles.cardActions}>
                        <button
                          onClick={() => openCustomGuide(guide, guide.title || guide.id)}
                          className={styles.startButton}
                          data-testid={testIds.contextPanel.customGuideStartButton(index)}
                        >
                          <Icon name="rocket" size="sm" />
                          {t('contextPanel.start', 'Start')}
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
