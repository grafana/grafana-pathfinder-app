import React, { memo, useEffect, useState } from 'react';
import { cx } from '@emotion/css';

import { SceneComponentProps, SceneObjectBase } from '@grafana/scenes';
import { Icon, useStyles2, Alert, Button } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { SkeletonLoader } from '../SkeletonLoader';
import { Prerequisites } from '../Prerequisites';
import { EnableRecommenderBanner } from '../EnableRecommenderBanner';
import { InteractiveLearningBanner } from '../InteractiveLearningBanner';
import { HelpFooter } from '../HelpFooter';
import { UserProfileBar } from '../UserProfileBar/UserProfileBar';
import { locationService, getAppEvents } from '@grafana/runtime';

// Import refactored context system
import { getStyles } from '../../styles/context-panel.styles';
import { getSkeletonStyles } from '../../styles/skeleton.styles';
import { useContextPanel, Recommendation } from '../../context-engine';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import type { ResolvedNavLink } from '../../types/context.types';
import {
  reportAppInteraction,
  UserInteraction,
  getContentTypeForAnalytics,
  AnalyticsContentType,
} from '../../lib/analytics';
import { logger } from '../../lib/logging';
import { PLUGIN_BASE_URL } from '../../constants';
import { usePathfinderPluginConfig } from '../../hooks';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { testIds } from '../../constants/testIds';
import { CustomGuidesSection } from './CustomGuidesSection';
import { usePublishedGuides, PublishedGuide } from '../../utils/usePublishedGuides';
import { ContextPanelState, PackageOpenInfo } from '../../types/content-panel.types';
import { getPackageRenderType } from '../../types/package.types';
import { useRecommendationsScrollPosition } from './hooks';
import { useLearningPaths, useMyAssignments, type ResolvedAssignment } from '../../learning-paths';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { LearningModuleList } from '../LearningContentCard/LearningModuleList';
import { learningEffort } from '../LearningContentCard/learning-effort';
import { catalogTopic } from '../../lib/catalog-discovery';
import { AssignmentBadges } from '../LearningPaths/AssignmentBadges';

/**
 * Resolve the effective display type for a recommendation.
 * For packages, reads `manifest.type` to determine whether to display as
 * `'interactive'` (guide) or `'learning-journey'` (path/journey).
 * Non-package recommendations pass through unchanged.
 */
const getEffectiveDisplayType = (recommendation: Recommendation): Recommendation['type'] => {
  if (recommendation.type === 'package') {
    return getPackageRenderType(recommendation.manifest);
  }
  return recommendation.type;
};

/** The manifest id of a package-backed recommendation; bundled-catalogue paths have none. */
function recommendationTargetId(recommendation: Recommendation): string | undefined {
  const id = recommendation.manifest?.id;
  return typeof id === 'string' && id.trim() !== '' ? id : undefined;
}

/**
 * Matches a card to its assignment by manifest id; only a card with no id falls back to a unique title.
 * An id that matches nothing or an ambiguous title drops the badge rather than guess.
 */
function assignmentForPath(
  recommendation: Recommendation,
  assignments: ResolvedAssignment[]
): ResolvedAssignment | undefined {
  if (getEffectiveDisplayType(recommendation) !== 'learning-journey') {
    return undefined;
  }

  const targetId = recommendationTargetId(recommendation);
  if (targetId !== undefined) {
    return assignments.find((assignment) => assignment.targetId === targetId);
  }

  const title = recommendation.title.trim().toLowerCase();
  const byTitle = assignments.filter((assignment) => assignment.title.trim().toLowerCase() === title);
  return byTitle.length === 1 ? byTitle[0] : undefined;
}

/** Maps a recommendation's effective display type onto the canonical analytics content_type. */
const getContentTypeForDisplayType = (displayType: Recommendation['type']): AnalyticsContentType => {
  if (displayType === 'docs-page') {
    return AnalyticsContentType.Docs;
  }
  if (displayType === 'interactive') {
    return AnalyticsContentType.InteractiveGuide;
  }
  return AnalyticsContentType.LearningJourney;
};

/** Check if recommendation type is docs-only (static documentation, not action-oriented) */
const isDocsOnlyRecommendation = (type?: string): boolean => type === 'docs-page';

/** Whether unresolved or resolved content exists for the expansion panel. */
function hasExpandableDetails(recommendation: Recommendation): boolean {
  const hasPendingDetails =
    Boolean(recommendation.pendingMilestoneIds?.length) ||
    Boolean(recommendation.pendingRecommendIds?.length) ||
    Boolean(recommendation.pendingSuggestIds?.length);
  const prerequisites = recommendation.manifest?.prerequisites;
  if (
    hasPendingDetails ||
    Boolean(recommendation.milestones?.length) ||
    (Array.isArray(prerequisites) && prerequisites.length > 0)
  ) {
    return true;
  }

  const nav = getManifestNavigation(recommendation);
  return nav.recommends.length > 0 || nav.suggests.length > 0;
}

/**
 * Check if recommendation should use openDocsPage.
 * All packages route through openDocsPage because it handles packageInfo;
 * loadDocsTabContent sets the correct tab type based on the manifest.
 */
const shouldUseDocsPageOpener = (type?: string): boolean =>
  type === 'docs-page' || type === 'interactive' || type === 'package';

/**
 * Return the URL that should be used to open a recommendation's content.
 * Package-backed recommendations carry the content URL in contentUrl (not url,
 * which is left empty in sanitizeV1Recommendation).
 */
const getRecommendationContentUrl = (recommendation: Recommendation): string => {
  if (recommendation.type === 'package') {
    const url = recommendation.contentUrl ?? '';
    if (!url && process.env.NODE_ENV !== 'production') {
      logger.warn('[context-panel] Package recommendation missing contentUrl', { title: recommendation.title });
    }
    return url;
  }
  return recommendation.url;
};

/**
 * Extract resolved navigation links from a package recommendation.
 * Prefers pre-resolved data set by processLearningJourneys; falls back to
 * wrapping raw manifest IDs so the UI still renders (with ID as title).
 */
function getManifestNavigation(recommendation: Recommendation): {
  recommends: ResolvedNavLink[];
  suggests: ResolvedNavLink[];
} {
  if (recommendation.type !== 'package') {
    return { recommends: [], suggests: [] };
  }

  const toFallback = (id: string): ResolvedNavLink => ({ packageId: id, title: id, contentUrl: '' });

  if (recommendation.resolvedRecommends || recommendation.resolvedSuggests) {
    return {
      recommends: recommendation.resolvedRecommends ?? [],
      suggests: recommendation.resolvedSuggests ?? [],
    };
  }

  const manifest = recommendation.manifest as Record<string, unknown> | undefined;
  if (!manifest) {
    return { recommends: [], suggests: [] };
  }
  const recommends = Array.isArray(manifest.recommends)
    ? manifest.recommends.filter((s): s is string => typeof s === 'string').map(toFallback)
    : [];
  const suggests = Array.isArray(manifest.suggests)
    ? manifest.suggests.filter((s): s is string => typeof s === 'string').map(toFallback)
    : [];
  return { recommends, suggests };
}

const getRecommendationPackageInfo = (
  recommendation: Recommendation,
  trackId?: string
): PackageOpenInfo | undefined => {
  if (recommendation.type !== 'package') {
    return undefined;
  }

  const manifest = recommendation.manifest;
  const packageId =
    manifest && typeof manifest === 'object' && typeof manifest.id === 'string' ? manifest.id : undefined;

  return {
    packageId,
    packageManifest: recommendation.manifest,
    repository: recommendation.repository,
    resolvedMilestones: Array.isArray(recommendation.milestones) ? recommendation.milestones : undefined,
    ...(trackId && { trackId }),
  };
};

export class ContextPanel extends SceneObjectBase<ContextPanelState> {
  public static Component = ContextPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(
    onOpenLearningJourney?: (url: string, title: string) => void,
    onOpenDocsPage?: (url: string, title: string, packageInfo?: PackageOpenInfo) => void,
    onOpenEditor?: () => void
  ) {
    super({
      onOpenLearningJourney,
      onOpenDocsPage,
      onOpenEditor,
    });
  }

  public openLearningJourney(url: string, title: string) {
    if (this.state.onOpenLearningJourney) {
      return this.state.onOpenLearningJourney(url, title);
    }
  }

  public openDocsPage(url: string, title: string, packageInfo?: PackageOpenInfo) {
    if (this.state.onOpenDocsPage) {
      return this.state.onOpenDocsPage(url, title, packageInfo);
    } else {
      logger.warn('No onOpenDocsPage callback available');
    }
  }

  public openEditor() {
    if (this.state.onOpenEditor) {
      this.state.onOpenEditor();
    }
  }

  public navigateToPath(path: string) {
    locationService.push(path);
  }
}

interface RecommendationsSectionProps {
  recommendations: Recommendation[];
  featuredRecommendations: Recommendation[];
  customGuides: PublishedGuide[];
  customGuidePaths: PublishedGuide[];
  customGuideOrphans: PublishedGuide[];
  isLoadingCustomGuides: boolean;
  customGuidesExpanded: boolean;
  suggestedGuidesExpanded: boolean;
  isLoadingRecommendations: boolean;
  isLoadingContext: boolean;
  recommendationsError: string | null;
  otherDocsExpanded: boolean;
  showEnableRecommenderBanner: boolean;
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string, packageInfo?: PackageOpenInfo) => void;
  toggleCustomGuidesExpansion: () => void;
  toggleSuggestedGuidesExpansion: () => void;
  toggleSummaryExpansion: (recommendationUrl: string) => void;
  toggleOtherDocsExpansion: () => void;
  assignments?: ResolvedAssignment[];
}

export const RecommendationsSection = memo(function RecommendationsSection({
  recommendations,
  featuredRecommendations,
  customGuides,
  customGuidePaths,
  customGuideOrphans,
  isLoadingCustomGuides,
  customGuidesExpanded,
  suggestedGuidesExpanded,
  isLoadingRecommendations,
  isLoadingContext,
  recommendationsError,
  otherDocsExpanded,
  showEnableRecommenderBanner,
  openLearningJourney,
  openDocsPage,
  toggleCustomGuidesExpansion,
  toggleSuggestedGuidesExpansion,
  toggleSummaryExpansion,
  toggleOtherDocsExpansion,
  assignments = [],
}: RecommendationsSectionProps) {
  const styles = useStyles2(getStyles);
  const skeletonStyles = useStyles2(getSkeletonStyles);
  const hasCustomGuidesContent = isLoadingCustomGuides || customGuides.length > 0;
  const suggestedGuidesCount = recommendations.length + featuredRecommendations.length;

  const renderRecommendation = (recommendation: Recommendation, index: number, featured = false) => {
    const contentUrl = getRecommendationContentUrl(recommendation);
    const assignment = assignmentForPath(recommendation, assignments);
    const packageInfo = getRecommendationPackageInfo(recommendation, assignment?.trackId);
    const displayType = getEffectiveDisplayType(recommendation);
    const kind = displayType === 'docs-page' ? 'docs' : displayType === 'interactive' ? 'guide' : 'path';
    const isExpanded = Boolean(recommendation.summaryExpanded);
    return (
      <LearningContentCard
        key={contentUrl || `${featured ? 'featured' : 'main'}-${index}`}
        title={recommendation.title}
        topic={catalogTopic({
          id: typeof recommendation.manifest?.id === 'string' ? recommendation.manifest.id : contentUrl,
          title: recommendation.title,
          category:
            typeof recommendation.manifest?.category === 'string' ? recommendation.manifest.category : undefined,
        })}
        kind={kind}
        description={recommendation.summary}
        progress={displayType === 'docs-page' ? undefined : recommendation.completionPercentage}
        organization={recommendation.repository === 'app-platform'}
        badges={assignment && <AssignmentBadges assignment={assignment} />}
        effort={learningEffort(recommendation.manifest, kind)}
        testId={featured ? `featured-recommendation-card-${index}` : testIds.contextPanel.recommendationCard(index)}
        titleTestId={!featured ? testIds.contextPanel.recommendationTitle(index) : undefined}
        actionTestId={!featured ? testIds.contextPanel.recommendationStartButton(index) : undefined}
        disclosureTestId={!featured ? testIds.contextPanel.recommendationSummaryButton(index) : undefined}
        detailsTestId={!featured ? testIds.contextPanel.recommendationSummaryContent(index) : undefined}
        disclosureLabel={
          recommendation.pendingMilestoneIds?.length || recommendation.milestones?.length
            ? t('learningCard.showModules', 'Show modules')
            : hasExpandableDetails(recommendation)
              ? t('learningCard.showRelated', 'Related content')
              : undefined
        }
        collapseLabel={
          recommendation.pendingMilestoneIds?.length || recommendation.milestones?.length
            ? t('learningCard.hideModules', 'Hide modules')
            : hasExpandableDetails(recommendation)
              ? t('learningCard.hideRelated', 'Hide related content')
              : undefined
        }
        expanded={isExpanded}
        onToggleDetails={() => {
          reportAppInteraction(UserInteraction.SummaryClick, {
            content_title: recommendation.title,
            content_url: contentUrl,
            content_type: getContentTypeForAnalytics(contentUrl, getContentTypeForDisplayType(displayType)),
            action: isExpanded ? 'collapse' : 'expand',
            match_accuracy: recommendation.matchAccuracy || 0,
            ...(displayType !== 'docs-page' && { total_milestones: recommendation.totalSteps || 0 }),
          });
          toggleSummaryExpansion(contentUrl);
        }}
        onLaunch={() => {
          reportAppInteraction(UserInteraction.OpenResourceClick, {
            content_title: recommendation.title,
            content_url: contentUrl,
            content_type: getContentTypeForAnalytics(contentUrl, getContentTypeForDisplayType(displayType)),
            interaction_location: featured ? 'featured_card_button' : 'main_card_button',
            match_accuracy: recommendation.matchAccuracy || 0,
            ...(displayType !== 'docs-page' && {
              total_milestones: recommendation.totalSteps || 0,
              completion_percentage: recommendation.completionPercentage ?? 0,
            }),
          });
          return shouldUseDocsPageOpener(recommendation.type)
            ? openDocsPage(contentUrl, recommendation.title, packageInfo)
            : openLearningJourney(contentUrl, recommendation.title);
        }}
        details={
          hasExpandableDetails(recommendation) ? (
            <>
              <Prerequisites prerequisites={recommendation.manifest?.prerequisites} />
              {recommendation.isResolvingDeferred && !recommendation.milestones && (
                <div className={cx(skeletonStyles.skeleton, styles.deferredSkeleton)}>
                  {Array.from({
                    length: recommendation.totalSteps ? Math.min(recommendation.totalSteps, 3) : 2,
                  }).map((_, i) => (
                    <div key={i} className={styles.deferredSkeletonRow}>
                      <div className={styles.deferredSkeletonCircle}></div>
                      <div className={styles.deferredSkeletonBar}></div>
                    </div>
                  ))}
                </div>
              )}

              {!isDocsOnlyRecommendation(displayType) && (recommendation.milestones?.length ?? 0) > 0 && (
                <div data-testid={!featured ? testIds.contextPanel.recommendationMilestones(index) : undefined}>
                  <h4>{t('learningCard.modulesTitle', 'Modules')}</h4>
                  <LearningModuleList
                    modules={recommendation.milestones ?? []}
                    itemTestId={
                      !featured
                        ? (stepIndex) => testIds.contextPanel.recommendationMilestoneItem(index, stepIndex)
                        : undefined
                    }
                    onOpen={(milestone) => {
                      reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
                        content_title: recommendation.title,
                        milestone_title: milestone.title,
                        milestone_number: milestone.number,
                        milestone_url: milestone.url,
                        content_url: contentUrl,
                        interaction_location: featured ? 'featured_milestone_list' : 'milestone_list',
                      });
                      return packageInfo
                        ? openDocsPage(milestone.url, recommendation.title, packageInfo)
                        : openLearningJourney(milestone.url, `${recommendation.title} - ${milestone.title}`);
                    }}
                  />
                </div>
              )}
              {(() => {
                const nav = getManifestNavigation(recommendation);
                const hasNav = nav.recommends.length > 0 || nav.suggests.length > 0;
                if (!hasNav) {
                  return null;
                }
                return (
                  <div>
                    {[
                      {
                        links: nav.recommends,
                        title: t('contextPanel.recommendedNext', 'Recommended next'),
                        location: featured ? 'featured_recommends_section' : 'recommends_section',
                      },
                      {
                        links: nav.suggests,
                        title: t('contextPanel.youMightAlsoLike', 'You might also like'),
                        location: featured ? 'featured_suggests_section' : 'suggests_section',
                      },
                    ]
                      .filter((section) => section.links.length)
                      .map((section) => (
                        <div key={section.location}>
                          <h4>{section.title}</h4>
                          <LearningModuleList
                            numbered={false}
                            modules={section.links.map((link, index) => ({
                              id: link.packageId,
                              title: link.title,
                              url: link.contentUrl,
                              number: index + 1,
                              isActive: false,
                            }))}
                            onOpen={(member) => {
                              const link = section.links.find((link) => link.packageId === member.id);
                              if (!link) {
                                return;
                              }
                              reportAppInteraction(UserInteraction.OpenResourceClick, {
                                content_title: link.title,
                                content_url: link.contentUrl,
                                content_type: AnalyticsContentType.PackageNavLink,
                                interaction_location: section.location,
                              });
                              return openDocsPage(link.contentUrl, link.title, {
                                packageId: link.packageId,
                                packageManifest: link.manifest,
                                repository: link.repository,
                              });
                            }}
                          />
                        </div>
                      ))}
                  </div>
                );
              })()}
            </>
          ) : undefined
        }
      />
    );
  };

  const finalPrimaryRecommendations = recommendations.slice(0, 4);

  const secondaryDocs = recommendations.slice(4);

  const isRefreshing = isLoadingRecommendations || isLoadingContext;

  if (
    !isRefreshing &&
    recommendationsError &&
    recommendations.length === 0 &&
    featuredRecommendations.length === 0 &&
    !hasCustomGuidesContent
  ) {
    return (
      <Alert
        severity="warning"
        title={t('contextPanel.recommendationsUnavailable', 'Recommendations unavailable')}
        data-testid={testIds.contextPanel.errorAlert}
      >
        {recommendationsError}
      </Alert>
    );
  }

  if (!isRefreshing && suggestedGuidesCount === 0 && !hasCustomGuidesContent) {
    return (
      <>
        <div className={styles.emptyContainer} data-testid={testIds.contextPanel.emptyState}>
          <Button
            icon="book-open"
            variant="secondary"
            onClick={() => {
              // Empty list: unlike the header/footer "my learning" buttons (which
              // switch to the in-panel recommendations tab), there is nothing to
              // return to in-panel here, so close the sidebar and open the full
              // My Learning page instead.
              const appEvents = getAppEvents();
              appEvents.publish({
                type: 'close-extension-sidebar',
                payload: {},
              });
              locationService.push(PLUGIN_BASE_URL);
            }}
          >
            {t('docsPanel.myLearning', 'My learning')}
          </Button>
        </div>
        {showEnableRecommenderBanner && <EnableRecommenderBanner />}
      </>
    );
  }

  // If we have recommendations (regular or featured, with or without error), render them
  return (
    <>
      {/* Show error banner when using fallback recommendations */}
      {recommendationsError && (
        <Alert
          severity="warning"
          title={t('contextPanel.recommendationsUnavailable', 'Recommendations unavailable')}
          data-testid={testIds.contextPanel.errorAlert}
        >
          {recommendationsError}
        </Alert>
      )}

      <div
        className={styles.recommendationsContainer}
        data-testid={testIds.contextPanel.recommendationsContainer}
        aria-busy={isRefreshing}
      >
        {hasCustomGuidesContent && (
          <CustomGuidesSection
            guides={customGuides}
            paths={customGuidePaths}
            orphanGuides={customGuideOrphans}
            isLoading={isLoadingCustomGuides}
            expanded={customGuidesExpanded}
            onToggleExpanded={toggleCustomGuidesExpansion}
            openDocsPage={openDocsPage}
            assignments={assignments}
          />
        )}

        {isRefreshing && suggestedGuidesCount === 0 && (
          <div data-testid={testIds.contextPanel.recommendationsLoading}>
            <SkeletonLoader type="recommendations" />
          </div>
        )}

        {suggestedGuidesCount > 0 && (
          <div className={styles.suggestedGuidesHeader}>
            <button
              className={styles.suggestedGuidesToggle}
              onClick={toggleSuggestedGuidesExpansion}
              data-testid={testIds.contextPanel.suggestedGuidesToggle}
              aria-expanded={suggestedGuidesExpanded}
            >
              <Icon name="rocket" size="sm" />
              <span>{t('contextPanel.suggestedGuides', 'Suggested guides')}</span>
              <span className={styles.suggestedGuidesCount}>
                <Icon name="list-ul" size="xs" />
                {t('contextPanel.items', '{{count}} items', { count: suggestedGuidesCount })}
              </span>
              <Icon name={suggestedGuidesExpanded ? 'angle-up' : 'angle-down'} size="sm" />
            </button>
          </div>
        )}

        {suggestedGuidesExpanded && featuredRecommendations.length > 0 && (
          <div className={styles.featuredSection} data-testid="featured-section">
            <div className={styles.featuredHeader}>
              <Icon name="star" className={styles.featuredIcon} />
              <h3 className={styles.featuredTitle}>{t('contextPanel.featured', 'Featured')}</h3>
            </div>
            <div className={styles.featuredGrid}>
              {featuredRecommendations.map((recommendation, index) =>
                renderRecommendation(recommendation, index, true)
              )}
            </div>
          </div>
        )}

        {/* Primary Recommendations Section (High-Confidence Items, sorted by accuracy) */}
        {suggestedGuidesExpanded && finalPrimaryRecommendations.length > 0 && (
          <div className={styles.recommendationsGrid} data-testid={testIds.contextPanel.recommendationsGrid}>
            {finalPrimaryRecommendations.map((recommendation, index) => renderRecommendation(recommendation, index))}
          </div>
        )}

        {/* Other Documentation Section - all items beyond top 4, including learning paths */}
        {suggestedGuidesExpanded && secondaryDocs.length > 0 && (
          <div className={styles.otherDocsSection} data-testid={testIds.contextPanel.otherDocsSection}>
            <div className={styles.otherDocsHeader}>
              <button
                onClick={() => toggleOtherDocsExpansion()}
                className={styles.otherDocsToggle}
                data-testid={testIds.contextPanel.otherDocsToggle}
              >
                <Icon name="file-alt" size="sm" />
                <span>{t('contextPanel.otherDocumentation', 'Other documentation')}</span>
                <span className={styles.otherDocsCount}>
                  <Icon name="list-ul" size="xs" />
                  {t('contextPanel.items', '{{count}} items', { count: secondaryDocs.length })}
                </span>
                <Icon name={otherDocsExpanded ? 'angle-up' : 'angle-down'} size="sm" />
              </button>
            </div>

            {otherDocsExpanded && (
              <div className={styles.otherDocsExpansion}>
                <div className={styles.otherDocsList} data-testid={testIds.contextPanel.otherDocsList}>
                  <LearningModuleList
                    numbered={false}
                    itemTestId={(index) => testIds.contextPanel.otherDocItem(index)}
                    modules={secondaryDocs.map((item, index) => ({
                      id: String(index),
                      title: item.title,
                      url: getRecommendationContentUrl(item),
                      number: index + 1,
                      isActive: false,
                    }))}
                    onOpen={(member) => {
                      const item = secondaryDocs[Number(member.id)];
                      if (!item) {
                        return;
                      }
                      const contentUrl = getRecommendationContentUrl(item);
                      const packageInfo = getRecommendationPackageInfo(
                        item,
                        assignmentForPath(item, assignments)?.trackId
                      );
                      const displayType = getEffectiveDisplayType(item);
                      reportAppInteraction(UserInteraction.OpenResourceClick, {
                        content_title: item.title,
                        content_url: contentUrl,
                        content_type: getContentTypeForAnalytics(contentUrl, getContentTypeForDisplayType(displayType)),
                        interaction_location: 'other_docs_list',
                        match_accuracy: item.matchAccuracy || 0,
                        ...(!isDocsOnlyRecommendation(displayType) && {
                          total_milestones: item.totalSteps || 0,
                          completion_percentage: item.completionPercentage ?? 0,
                        }),
                      });
                      return shouldUseDocsPageOpener(item.type)
                        ? openDocsPage(contentUrl, item.title, packageInfo)
                        : openLearningJourney(contentUrl, item.title);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Show Enable Recommender Banner when recommendations exist but recommender is disabled */}
      {showEnableRecommenderBanner && <EnableRecommenderBanner />}
    </>
  );
});

function ContextPanelRenderer({ model }: SceneComponentProps<ContextPanel>) {
  // Get plugin configuration with proper defaults applied
  // Resolved rather than read off `plugin.meta.jsonData`: where the
  // `PathfinderSettings` resource is authoritative, jsonData no longer receives
  // saves, so the terms gate and the dev-mode gate would both read pre-migration
  // values here.
  const { config: configWithDefaults } = usePathfinderPluginConfig();

  const devModeEnabled = isDevModeEnabled(configWithDefaults);

  // Use the simplified context hook
  const {
    contextData,
    isLoadingRecommendations,
    hasFetchedRecommendations,
    otherDocsExpanded,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
    toggleOtherDocsExpansion,
  } = useContextPanel({
    onOpenLearningJourney: model.state.onOpenLearningJourney,
    onOpenDocsPage: model.state.onOpenDocsPage,
  });
  const {
    guides: customGuides,
    paths: customGuidePaths,
    orphanGuides: customGuideOrphans,
    isLoading: isLoadingCustomGuides,
    hasLoaded: hasLoadedCustomGuides,
  } = usePublishedGuides();
  const [customGuidesExpanded, setCustomGuidesExpanded] = useState(true);
  const [suggestedGuidesExpanded, setSuggestedGuidesExpanded] = useState(true);
  const { paths, getPathProgress, getPathGuides, progress } = useLearningPaths();
  const { notDone: assignedNotDone } = useMyAssignments({
    paths,
    getPathProgress,
    getPathGuides,
    completedGuides: progress.completedGuides,
    resolveNavLinks: resolvePackageNavLinks,
  });

  // Note: Auto-open event listener moved to CombinedPanelRenderer to avoid remounting issues
  // ContextPanelRenderer remounts when tabs change, causing listener cleanup

  const { recommendations, recommendationsError } = contextData;

  const styles = useStyles2(getStyles);

  // Determine if we should show the banner
  const showEnableRecommenderBanner =
    !isLoadingRecommendations &&
    !recommendationsError &&
    !devModeEnabled &&
    recommendations.length > 0 &&
    !configWithDefaults.acceptedTermsAndConditions;

  const recommendationsScrollReady =
    !contextData.isLoading && !isLoadingRecommendations && hasFetchedRecommendations && hasLoadedCustomGuides;
  const scrollContainerRef = useRecommendationsScrollPosition(recommendationsScrollReady);

  // Signals docs-panel's panel_lcp_ms that recommendations are actually
  // showing (reuses the same readiness the scroll-position hook uses).
  // Written to scene state — a replayable observable the parent reads on
  // any render, so it survives this renderer remounting on tab changes.
  useEffect(() => {
    if (recommendationsScrollReady && !model.state.recommendationsReady) {
      model.setState({ recommendationsReady: true });
    }
  }, [recommendationsScrollReady, model]);

  return (
    <div className={styles.container} data-testid={testIds.contextPanel.container}>
      <div className={styles.content} ref={scrollContainerRef} data-testid={testIds.contextPanel.scrollContainer}>
        <div className={styles.contextSections}>
          {/* Treatment arm of the interactive-learning banner experiment; renders null otherwise */}
          <InteractiveLearningBanner />

          {/* User profile bar with learning stats and next action */}
          <UserProfileBar onOpenGuide={openLearningJourney} />

          {/* Recommendations Section - Memoized to prevent unnecessary rerenders */}
          <RecommendationsSection
            recommendations={recommendations}
            featuredRecommendations={contextData.featuredRecommendations}
            customGuides={customGuides}
            customGuidePaths={customGuidePaths}
            customGuideOrphans={customGuideOrphans}
            isLoadingCustomGuides={isLoadingCustomGuides}
            customGuidesExpanded={customGuidesExpanded}
            suggestedGuidesExpanded={suggestedGuidesExpanded}
            isLoadingRecommendations={isLoadingRecommendations}
            isLoadingContext={contextData.isLoading}
            recommendationsError={recommendationsError}
            otherDocsExpanded={otherDocsExpanded}
            showEnableRecommenderBanner={showEnableRecommenderBanner}
            openLearningJourney={openLearningJourney}
            openDocsPage={openDocsPage}
            toggleCustomGuidesExpansion={() => setCustomGuidesExpanded((prev) => !prev)}
            toggleSuggestedGuidesExpansion={() => setSuggestedGuidesExpanded((prev) => !prev)}
            toggleSummaryExpansion={toggleSummaryExpansion}
            toggleOtherDocsExpansion={toggleOtherDocsExpansion}
            assignments={assignedNotDone}
          />
        </div>

        {/* Help Footer */}
        <HelpFooter />
      </div>
    </div>
  );
}

// Styles now imported from context-panel.styles.ts
