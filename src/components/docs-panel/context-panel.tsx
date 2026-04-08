import React, { memo, useEffect, useState } from 'react';

import { SceneComponentProps, SceneObjectBase } from '@grafana/scenes';
import { Icon, useStyles2, Card, Alert, Button } from '@grafana/ui';
import { usePluginContext, IconName } from '@grafana/data';
import { t } from '@grafana/i18n';
import { SkeletonLoader } from '../SkeletonLoader';
import { EnableRecommenderBanner } from '../EnableRecommenderBanner';
import { HelpFooter } from '../HelpFooter';
import { UserProfileBar } from '../UserProfileBar/UserProfileBar';
import { locationService, config, getAppEvents } from '@grafana/runtime';

// Import refactored context system
import { getStyles } from '../../styles/context-panel.styles';
import { useContextPanel, Recommendation } from '../../context-engine';
import { reportAppInteraction, UserInteraction, getContentTypeForAnalytics } from '../../lib/analytics';
import { getConfigWithDefaults, PLUGIN_BASE_URL } from '../../constants';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { testIds } from '../../constants/testIds';
import { CustomGuidesSection } from './CustomGuidesSection';
import { usePublishedGuides, PublishedGuide } from '../../utils/usePublishedGuides';
import { ContextPanelState, PackageOpenInfo } from '../../types/content-panel.types';
import { getPackageRenderType } from '../../types/package.types';

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

/** Get icon name based on recommendation type */
const getRecommendationIcon = (type?: string): IconName => {
  if (type === 'docs-page') {
    return 'file-alt';
  }
  return 'rocket';
};

/** Get short button text based on recommendation type and progress */
const getRecommendationButtonText = (type?: string, completionPercentage?: number): string => {
  if (type === 'docs-page') {
    return t('contextPanel.view', 'View');
  }
  if (completionPercentage && completionPercentage > 0 && completionPercentage < 100) {
    return t('contextPanel.resume', 'Resume');
  }
  return t('contextPanel.start', 'Start');
};

/** Get long CTA button text based on recommendation type */
const getRecommendationCtaText = (type?: string): string => {
  if (type === 'docs-page') {
    return t('contextPanel.viewDocumentation', 'View documentation');
  }
  if (type === 'interactive') {
    return t('contextPanel.startInteractiveGuide', 'Start interactive guide');
  }
  return t('contextPanel.startLearningJourney', 'Start learning path');
};

/** Get category label for display as a tag below the title */
const getCategoryLabel = (type?: string): string => {
  if (type === 'interactive') {
    return t('contextPanel.categoryInteractiveGuide', 'Interactive guide');
  }
  if (type === 'docs-page') {
    return t('contextPanel.categoryDocsPage', 'Docs page');
  }
  return t('contextPanel.categoryLearningJourney', 'Learning path');
};

/** Get category tag style class name based on recommendation type */
const getCategoryTagStyle = (styles: ReturnType<typeof getStyles>, type?: string): string => {
  if (type === 'interactive') {
    return styles.categoryTagInteractive;
  }
  if (type === 'docs-page') {
    return styles.categoryTagDocs;
  }
  return styles.categoryTagJourney;
};

/** Check if recommendation type is docs-only (static documentation, not action-oriented) */
const isDocsOnlyRecommendation = (type?: string): boolean => type === 'docs-page';

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
      console.warn('[context-panel] Package recommendation missing contentUrl:', recommendation.title);
    }
    return url;
  }
  return recommendation.url;
};

/**
 * Extract navigation arrays from a package recommendation's manifest.
 * Returns empty arrays for non-package recommendations or missing data.
 */
function getManifestNavigation(recommendation: Recommendation): { recommends: string[]; suggests: string[] } {
  if (recommendation.type !== 'package') {
    return { recommends: [], suggests: [] };
  }
  const manifest = recommendation.manifest as Record<string, unknown> | undefined;
  if (!manifest) {
    return { recommends: [], suggests: [] };
  }
  const recommends = Array.isArray(manifest.recommends)
    ? manifest.recommends.filter((s): s is string => typeof s === 'string')
    : [];
  const suggests = Array.isArray(manifest.suggests)
    ? manifest.suggests.filter((s): s is string => typeof s === 'string')
    : [];
  return { recommends, suggests };
}

const getRecommendationPackageInfo = (recommendation: Recommendation): PackageOpenInfo | undefined => {
  if (recommendation.type !== 'package') {
    return undefined;
  }

  const manifest = recommendation.manifest;
  const packageId =
    manifest && typeof manifest === 'object' && typeof manifest.id === 'string' ? manifest.id : undefined;

  return {
    packageId,
    packageManifest: recommendation.manifest,
    resolvedMilestones: Array.isArray(recommendation.milestones) ? recommendation.milestones : undefined,
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
    onOpenDevTools?: () => void
  ) {
    super({
      onOpenLearningJourney,
      onOpenDocsPage,
      onOpenDevTools,
    });
  }

  public openLearningJourney(url: string, title: string) {
    if (this.state.onOpenLearningJourney) {
      this.state.onOpenLearningJourney(url, title);
    }
  }

  public openDocsPage(url: string, title: string, packageInfo?: PackageOpenInfo) {
    if (this.state.onOpenDocsPage) {
      this.state.onOpenDocsPage(url, title, packageInfo);
    } else {
      console.warn('No onOpenDocsPage callback available');
    }
  }

  public openDevTools() {
    if (this.state.onOpenDevTools) {
      this.state.onOpenDevTools();
    }
  }

  public navigateToPath(path: string) {
    locationService.push(path);
  }
}

// Memoized recommendations section to prevent unnecessary rerenders
interface RecommendationsSectionProps {
  recommendations: Recommendation[];
  featuredRecommendations: Recommendation[];
  customGuides: PublishedGuide[];
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
}

export const RecommendationsSection = memo(function RecommendationsSection({
  recommendations,
  featuredRecommendations,
  customGuides,
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
}: RecommendationsSectionProps) {
  const styles = useStyles2(getStyles);
  const hasCustomGuidesContent = isLoadingCustomGuides || customGuides.length > 0;
  const suggestedGuidesCount = recommendations.length + featuredRecommendations.length;

  // All recommendations are now >= 0.5 confidence and pre-sorted by service
  // Primary recommendations: maximum of 4 items with highest confidence
  const finalPrimaryRecommendations = recommendations.slice(0, 4);

  // Secondary recommendations: all remaining items go to "Other Documentation"
  const secondaryDocs = recommendations.slice(4);

  // Show loading state while context is loading OR recommendations are loading
  if (isLoadingRecommendations || isLoadingContext) {
    return (
      <div className={styles.recommendationsContainer} data-testid={testIds.contextPanel.recommendationsContainer}>
        <SkeletonLoader type="recommendations" />
      </div>
    );
  }

  // If there's an error but no recommendations (regular or featured), show only the error
  if (
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

  // If there are no recommendations (regular or featured) and no error, show empty state
  if (recommendations.length === 0 && featuredRecommendations.length === 0 && !hasCustomGuidesContent) {
    return (
      <>
        <div className={styles.emptyContainer} data-testid={testIds.contextPanel.emptyState}>
          <Button
            icon="book-open"
            variant="secondary"
            onClick={() => {
              // Close the extension sidebar
              const appEvents = getAppEvents();
              appEvents.publish({
                type: 'close-extension-sidebar',
                payload: {},
              });
              // Navigate to the home page
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

      <div className={styles.recommendationsContainer} data-testid={testIds.contextPanel.recommendationsContainer}>
        {hasCustomGuidesContent && (
          <CustomGuidesSection
            guides={customGuides}
            isLoading={isLoadingCustomGuides}
            expanded={customGuidesExpanded}
            onToggleExpanded={toggleCustomGuidesExpansion}
            openDocsPage={openDocsPage}
          />
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
                {t('contextPanel.items', '{{count}} item', { count: suggestedGuidesCount })}
              </span>
              <Icon name={suggestedGuidesExpanded ? 'angle-up' : 'angle-down'} size="sm" />
            </button>
          </div>
        )}

        {/* Featured Recommendations Section - Time-based featured content */}
        {suggestedGuidesExpanded && featuredRecommendations.length > 0 && (
          <div className={styles.featuredSection} data-testid="featured-section">
            <div className={styles.featuredHeader}>
              <Icon name="star" className={styles.featuredIcon} />
              <h3 className={styles.featuredTitle}>{t('contextPanel.featured', 'Featured')}</h3>
            </div>
            <div className={styles.featuredGrid}>
              {featuredRecommendations.map((recommendation, index) => {
                const contentUrl = getRecommendationContentUrl(recommendation);
                const packageInfo = getRecommendationPackageInfo(recommendation);
                const displayType = getEffectiveDisplayType(recommendation);
                return (
                  <Card
                    key={`featured-${index}`}
                    className={`${styles.recommendationCard} ${styles.featuredCard} ${
                      displayType === 'docs-page' ? styles.compactCard : ''
                    }`}
                    data-testid={`featured-recommendation-card-${index}`}
                  >
                    <div
                      className={`${styles.recommendationCardContent} ${
                        displayType === 'docs-page' ? styles.compactCardContent : ''
                      }`}
                    >
                      <div
                        className={`${styles.cardHeader} ${displayType === 'docs-page' ? styles.compactHeader : ''}`}
                      >
                        <div className={styles.cardTitleSection}>
                          <h3 className={styles.recommendationCardTitle}>{recommendation.title}</h3>
                          <span className={getCategoryTagStyle(styles, displayType)}>
                            {recommendation.type === 'package' && <span className={styles.packagePillIcon}>📦</span>}
                            {getCategoryLabel(displayType)}
                          </span>
                        </div>
                        <div
                          className={`${styles.cardActions} ${recommendation.summaryExpanded ? styles.hiddenActions : ''}`}
                        >
                          <button
                            onClick={() => {
                              reportAppInteraction(UserInteraction.OpenResourceClick, {
                                content_title: recommendation.title,
                                content_url: contentUrl,
                                content_type: getContentTypeForAnalytics(
                                  contentUrl,
                                  displayType === 'docs-page' ? 'docs' : 'learning-journey'
                                ),
                                interaction_location: 'featured_card_button',
                                match_accuracy: recommendation.matchAccuracy || 0,
                                ...(displayType !== 'docs-page' && {
                                  total_milestones: recommendation.totalSteps || 0,
                                  completion_percentage: recommendation.completionPercentage ?? 0,
                                }),
                              });

                              if (shouldUseDocsPageOpener(recommendation.type)) {
                                openDocsPage(contentUrl, recommendation.title, packageInfo);
                              } else {
                                openLearningJourney(contentUrl, recommendation.title);
                              }
                            }}
                            className={styles.startButton}
                          >
                            <Icon name={getRecommendationIcon(displayType)} size="sm" />
                            {getRecommendationButtonText(displayType, recommendation.completionPercentage)}
                          </button>
                        </div>
                      </div>

                      {(!isDocsOnlyRecommendation(displayType) || recommendation.summary) && (
                        <>
                          <div className={styles.cardMetadata}>
                            <div className={styles.summaryInfo}>
                              <button
                                onClick={() => {
                                  reportAppInteraction(UserInteraction.SummaryClick, {
                                    content_title: recommendation.title,
                                    content_url: contentUrl,
                                    content_type: getContentTypeForAnalytics(
                                      contentUrl,
                                      displayType === 'docs-page' ? 'docs' : 'learning-journey'
                                    ),
                                    action: recommendation.summaryExpanded ? 'collapse' : 'expand',
                                    match_accuracy: recommendation.matchAccuracy || 0,
                                    ...(displayType !== 'docs-page' && {
                                      total_milestones: recommendation.totalSteps || 0,
                                    }),
                                  });

                                  toggleSummaryExpansion(contentUrl);
                                }}
                                className={styles.summaryButton}
                              >
                                <Icon name="info-circle" size="sm" />
                                <span>{t('contextPanel.summary', 'Summary')}</span>
                                <Icon name={recommendation.summaryExpanded ? 'angle-up' : 'angle-down'} size="sm" />
                              </button>
                              {!isDocsOnlyRecommendation(displayType) &&
                                typeof recommendation.completionPercentage === 'number' && (
                                  <div className={styles.completionInfo}>
                                    <div
                                      className={styles.completionPercentage}
                                      data-completion={recommendation.completionPercentage}
                                    >
                                      {t('contextPanel.percentComplete', '{{percent}}% complete', {
                                        percent: recommendation.completionPercentage,
                                      })}
                                    </div>
                                  </div>
                                )}
                            </div>
                          </div>

                          {recommendation.summaryExpanded && (
                            <div className={styles.summaryExpansion}>
                              {recommendation.summary && (
                                <div className={styles.summaryContent}>
                                  <p className={styles.summaryText}>{recommendation.summary}</p>
                                </div>
                              )}

                              {!isDocsOnlyRecommendation(displayType) &&
                                (recommendation.totalSteps ?? 0) > 0 &&
                                recommendation.milestones && (
                                  <div className={styles.milestonesSection}>
                                    <div className={styles.milestonesHeader}>
                                      <h4 className={styles.milestonesTitle}>
                                        {t('contextPanel.milestones', 'Milestones:')}
                                      </h4>
                                    </div>
                                    <div className={styles.milestonesList}>
                                      {recommendation.milestones.map((milestone, stepIndex) => (
                                        <button
                                          key={stepIndex}
                                          onClick={() => {
                                            reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
                                              content_title: recommendation.title,
                                              milestone_title: milestone.title,
                                              milestone_number: milestone.number,
                                              milestone_url: milestone.url,
                                              content_url: contentUrl,
                                              interaction_location: 'featured_milestone_list',
                                            });
                                            if (packageInfo) {
                                              openDocsPage(milestone.url, recommendation.title, packageInfo);
                                            } else {
                                              openLearningJourney(
                                                milestone.url,
                                                `${recommendation.title} - ${milestone.title}`
                                              );
                                            }
                                          }}
                                          className={styles.milestoneItem}
                                        >
                                          <div className={styles.milestoneNumber}>{milestone.number}</div>
                                          <div className={styles.milestoneContent}>
                                            <div className={styles.milestoneTitle}>{milestone.title}</div>
                                          </div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}

                              {(() => {
                                const nav = getManifestNavigation(recommendation);
                                const hasNav = nav.recommends.length > 0 || nav.suggests.length > 0;
                                if (!hasNav) {
                                  return null;
                                }
                                return (
                                  <div className={styles.milestonesSection}>
                                    {nav.recommends.length > 0 && (
                                      <>
                                        <div className={styles.milestonesHeader}>
                                          <h4 className={styles.milestonesTitle}>
                                            {t('contextPanel.recommendedNext', 'Recommended next')}
                                          </h4>
                                        </div>
                                        <div className={styles.milestonesList}>
                                          {nav.recommends.map((pkgId) => (
                                            <button
                                              key={pkgId}
                                              onClick={() => {
                                                reportAppInteraction(UserInteraction.OpenResourceClick, {
                                                  content_title: pkgId,
                                                  content_url: '',
                                                  content_type: 'package-nav-link',
                                                  interaction_location: 'featured_recommends_section',
                                                });
                                                openDocsPage('', pkgId, { packageId: pkgId });
                                              }}
                                              className={styles.milestoneItem}
                                            >
                                              <Icon name="arrow-right" size="sm" />
                                              <div className={styles.milestoneContent}>
                                                <div className={styles.milestoneTitle}>{pkgId}</div>
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                    {nav.suggests.length > 0 && (
                                      <>
                                        <div className={styles.milestonesHeader}>
                                          <h4 className={styles.milestonesTitle}>
                                            {t('contextPanel.youMightAlsoLike', 'You might also like')}
                                          </h4>
                                        </div>
                                        <div className={styles.milestonesList}>
                                          {nav.suggests.map((pkgId) => (
                                            <button
                                              key={pkgId}
                                              onClick={() => {
                                                reportAppInteraction(UserInteraction.OpenResourceClick, {
                                                  content_title: pkgId,
                                                  content_url: '',
                                                  content_type: 'package-nav-link',
                                                  interaction_location: 'featured_suggests_section',
                                                });
                                                openDocsPage('', pkgId, { packageId: pkgId });
                                              }}
                                              className={styles.milestoneItem}
                                            >
                                              <Icon name="link" size="sm" />
                                              <div className={styles.milestoneContent}>
                                                <div className={styles.milestoneTitle}>{pkgId}</div>
                                              </div>
                                            </button>
                                          ))}
                                        </div>
                                      </>
                                    )}
                                  </div>
                                );
                              })()}

                              <div className={styles.summaryCta}>
                                <button
                                  onClick={() => {
                                    reportAppInteraction(UserInteraction.OpenResourceClick, {
                                      content_title: recommendation.title,
                                      content_url: contentUrl,
                                      content_type: getContentTypeForAnalytics(
                                        contentUrl,
                                        displayType === 'docs-page' ? 'docs' : 'learning-journey'
                                      ),
                                      interaction_location: 'featured_summary_cta_button',
                                      match_accuracy: recommendation.matchAccuracy || 0,
                                      ...(displayType !== 'docs-page' && {
                                        total_milestones: recommendation.totalSteps || 0,
                                        completion_percentage: recommendation.completionPercentage ?? 0,
                                      }),
                                    });

                                    if (shouldUseDocsPageOpener(recommendation.type)) {
                                      openDocsPage(contentUrl, recommendation.title, packageInfo);
                                    } else {
                                      openLearningJourney(contentUrl, recommendation.title);
                                    }
                                  }}
                                  className={styles.summaryCtaButton}
                                >
                                  <Icon name={getRecommendationIcon(displayType)} size="sm" />
                                  {getRecommendationCtaText(displayType)}
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary Recommendations Section (High-Confidence Items, sorted by accuracy) */}
        {suggestedGuidesExpanded && finalPrimaryRecommendations.length > 0 && (
          <div className={styles.recommendationsGrid} data-testid={testIds.contextPanel.recommendationsGrid}>
            {finalPrimaryRecommendations.map((recommendation, index) => {
              const contentUrl = getRecommendationContentUrl(recommendation);
              const packageInfo = getRecommendationPackageInfo(recommendation);
              const displayType = getEffectiveDisplayType(recommendation);
              return (
                <Card
                  key={contentUrl || `rec-${index}`}
                  className={`${styles.recommendationCard} ${
                    isDocsOnlyRecommendation(displayType) ? styles.compactCard : ''
                  }`}
                  data-testid={testIds.contextPanel.recommendationCard(index)}
                >
                  <div
                    className={`${styles.recommendationCardContent} ${
                      isDocsOnlyRecommendation(displayType) ? styles.compactCardContent : ''
                    }`}
                  >
                    <div
                      className={`${styles.cardHeader} ${
                        isDocsOnlyRecommendation(displayType) ? styles.compactHeader : ''
                      }`}
                    >
                      <div className={styles.cardTitleSection}>
                        <h3
                          className={styles.recommendationCardTitle}
                          data-testid={testIds.contextPanel.recommendationTitle(index)}
                        >
                          {recommendation.title}
                        </h3>
                        <span className={getCategoryTagStyle(styles, displayType)}>
                          {recommendation.type === 'package' && <span className={styles.packagePillIcon}>📦</span>}
                          {getCategoryLabel(displayType)}
                        </span>
                      </div>
                      <div
                        className={`${styles.cardActions} ${recommendation.summaryExpanded ? styles.hiddenActions : ''}`}
                      >
                        <button
                          onClick={() => {
                            reportAppInteraction(UserInteraction.OpenResourceClick, {
                              content_title: recommendation.title,
                              content_url: contentUrl,
                              content_type: getContentTypeForAnalytics(
                                contentUrl,
                                displayType === 'docs-page' ? 'docs' : 'learning-journey'
                              ),
                              interaction_location: 'main_card_button',
                              match_accuracy: recommendation.matchAccuracy || 0,
                              ...(displayType !== 'docs-page' && {
                                total_milestones: recommendation.totalSteps || 0,
                                completion_percentage: recommendation.completionPercentage ?? 0,
                              }),
                            });

                            if (shouldUseDocsPageOpener(recommendation.type)) {
                              openDocsPage(contentUrl, recommendation.title, packageInfo);
                            } else {
                              openLearningJourney(contentUrl, recommendation.title);
                            }
                          }}
                          className={styles.startButton}
                          data-testid={testIds.contextPanel.recommendationStartButton(index)}
                        >
                          <Icon name={getRecommendationIcon(displayType)} size="sm" />
                          {getRecommendationButtonText(displayType, recommendation.completionPercentage)}
                        </button>
                      </div>
                    </div>

                    {(!isDocsOnlyRecommendation(displayType) || recommendation.summary) && (
                      <>
                        <div className={styles.cardMetadata}>
                          <div className={styles.summaryInfo}>
                            <button
                              onClick={() => {
                                reportAppInteraction(UserInteraction.SummaryClick, {
                                  content_title: recommendation.title,
                                  content_url: contentUrl,
                                  content_type: getContentTypeForAnalytics(
                                    contentUrl,
                                    displayType === 'docs-page' ? 'docs' : 'learning-journey'
                                  ),
                                  action: recommendation.summaryExpanded ? 'collapse' : 'expand',
                                  match_accuracy: recommendation.matchAccuracy || 0,
                                  ...(displayType !== 'docs-page' && {
                                    total_milestones: recommendation.totalSteps || 0,
                                  }),
                                });

                                toggleSummaryExpansion(contentUrl);
                              }}
                              className={styles.summaryButton}
                              data-testid={testIds.contextPanel.recommendationSummaryButton(index)}
                            >
                              <Icon name="info-circle" size="sm" />
                              <span>{t('contextPanel.summary', 'Summary')}</span>
                              <Icon name={recommendation.summaryExpanded ? 'angle-up' : 'angle-down'} size="sm" />
                            </button>
                            {!isDocsOnlyRecommendation(displayType) &&
                              typeof recommendation.completionPercentage === 'number' && (
                                <div className={styles.completionInfo}>
                                  <div
                                    className={styles.completionPercentage}
                                    data-completion={recommendation.completionPercentage}
                                  >
                                    {t('contextPanel.percentComplete', '{{percent}}% complete', {
                                      percent: recommendation.completionPercentage,
                                    })}
                                  </div>
                                </div>
                              )}
                          </div>
                        </div>

                        {recommendation.summaryExpanded && (
                          <div
                            className={styles.summaryExpansion}
                            data-testid={testIds.contextPanel.recommendationSummaryContent(index)}
                          >
                            {recommendation.summary && (
                              <div className={styles.summaryContent}>
                                <p className={styles.summaryText}>{recommendation.summary}</p>
                              </div>
                            )}

                            {!isDocsOnlyRecommendation(displayType) &&
                              (recommendation.totalSteps ?? 0) > 0 &&
                              recommendation.milestones && (
                                <div
                                  className={styles.milestonesSection}
                                  data-testid={testIds.contextPanel.recommendationMilestones(index)}
                                >
                                  <div className={styles.milestonesHeader}>
                                    <h4 className={styles.milestonesTitle}>
                                      {t('contextPanel.milestones', 'Milestones:')}
                                    </h4>
                                  </div>
                                  <div className={styles.milestonesList}>
                                    {recommendation.milestones.map((milestone, stepIndex) => (
                                      <button
                                        key={stepIndex}
                                        onClick={() => {
                                          reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
                                            content_title: recommendation.title,
                                            milestone_title: milestone.title,
                                            milestone_number: milestone.number,
                                            milestone_url: milestone.url,
                                            content_url: contentUrl,
                                            interaction_location: 'milestone_list',
                                          });
                                          if (packageInfo) {
                                            openDocsPage(milestone.url, recommendation.title, packageInfo);
                                          } else {
                                            openLearningJourney(
                                              milestone.url,
                                              `${recommendation.title} - ${milestone.title}`
                                            );
                                          }
                                        }}
                                        className={styles.milestoneItem}
                                        data-testid={testIds.contextPanel.recommendationMilestoneItem(index, stepIndex)}
                                      >
                                        <div className={styles.milestoneNumber}>{milestone.number}</div>
                                        <div className={styles.milestoneContent}>
                                          <div className={styles.milestoneTitle}>
                                            {milestone.title}
                                            <span className={styles.milestoneDuration}>({milestone.duration})</span>
                                          </div>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                            {(() => {
                              const nav = getManifestNavigation(recommendation);
                              const hasNav = nav.recommends.length > 0 || nav.suggests.length > 0;
                              if (!hasNav) {
                                return null;
                              }
                              return (
                                <div className={styles.milestonesSection}>
                                  {nav.recommends.length > 0 && (
                                    <>
                                      <div className={styles.milestonesHeader}>
                                        <h4 className={styles.milestonesTitle}>
                                          {t('contextPanel.recommendedNext', 'Recommended next')}
                                        </h4>
                                      </div>
                                      <div className={styles.milestonesList}>
                                        {nav.recommends.map((pkgId) => (
                                          <button
                                            key={pkgId}
                                            onClick={() => {
                                              reportAppInteraction(UserInteraction.OpenResourceClick, {
                                                content_title: pkgId,
                                                content_url: '',
                                                content_type: 'package-nav-link',
                                                interaction_location: 'recommends_section',
                                              });
                                              openDocsPage('', pkgId, { packageId: pkgId });
                                            }}
                                            className={styles.milestoneItem}
                                          >
                                            <Icon name="arrow-right" size="sm" />
                                            <div className={styles.milestoneContent}>
                                              <div className={styles.milestoneTitle}>{pkgId}</div>
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                  {nav.suggests.length > 0 && (
                                    <>
                                      <div className={styles.milestonesHeader}>
                                        <h4 className={styles.milestonesTitle}>
                                          {t('contextPanel.youMightAlsoLike', 'You might also like')}
                                        </h4>
                                      </div>
                                      <div className={styles.milestonesList}>
                                        {nav.suggests.map((pkgId) => (
                                          <button
                                            key={pkgId}
                                            onClick={() => {
                                              reportAppInteraction(UserInteraction.OpenResourceClick, {
                                                content_title: pkgId,
                                                content_url: '',
                                                content_type: 'package-nav-link',
                                                interaction_location: 'suggests_section',
                                              });
                                              openDocsPage('', pkgId, { packageId: pkgId });
                                            }}
                                            className={styles.milestoneItem}
                                          >
                                            <Icon name="link" size="sm" />
                                            <div className={styles.milestoneContent}>
                                              <div className={styles.milestoneTitle}>{pkgId}</div>
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    </>
                                  )}
                                </div>
                              );
                            })()}

                            <div className={styles.summaryCta}>
                              <button
                                onClick={() => {
                                  reportAppInteraction(UserInteraction.OpenResourceClick, {
                                    content_title: recommendation.title,
                                    content_url: contentUrl,
                                    content_type: getContentTypeForAnalytics(
                                      contentUrl,
                                      displayType === 'docs-page' ? 'docs' : 'learning-journey'
                                    ),
                                    interaction_location: 'summary_cta_button',
                                    match_accuracy: recommendation.matchAccuracy || 0,
                                    ...(displayType !== 'docs-page' && {
                                      total_milestones: recommendation.totalSteps || 0,
                                      completion_percentage: recommendation.completionPercentage ?? 0,
                                    }),
                                  });

                                  if (shouldUseDocsPageOpener(recommendation.type)) {
                                    openDocsPage(contentUrl, recommendation.title, packageInfo);
                                  } else {
                                    openLearningJourney(contentUrl, recommendation.title);
                                  }
                                }}
                                className={styles.summaryCtaButton}
                              >
                                <Icon name={getRecommendationIcon(displayType)} size="sm" />
                                {getRecommendationCtaText(displayType)}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              );
            })}
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
                <span>{t('contextPanel.otherDocumentation', 'Other Documentation')}</span>
                <span className={styles.otherDocsCount}>
                  <Icon name="list-ul" size="xs" />
                  {t('contextPanel.items', '{{count}} item', { count: secondaryDocs.length })}
                </span>
                <Icon name={otherDocsExpanded ? 'angle-up' : 'angle-down'} size="sm" />
              </button>
            </div>

            {otherDocsExpanded && (
              <div className={styles.otherDocsExpansion}>
                <div className={styles.otherDocsList} data-testid={testIds.contextPanel.otherDocsList}>
                  {secondaryDocs.map((item, index) => {
                    const contentUrl = getRecommendationContentUrl(item);
                    const packageInfo = getRecommendationPackageInfo(item);
                    const displayType = getEffectiveDisplayType(item);
                    return (
                      <div
                        key={contentUrl || `other-${index}`}
                        className={styles.otherDocItem}
                        data-testid={testIds.contextPanel.otherDocItem(index)}
                      >
                        <div className={styles.docIcon}>
                          <Icon name={getRecommendationIcon(displayType)} size="sm" />
                        </div>
                        <div className={styles.docContent}>
                          <button
                            onClick={() => {
                              reportAppInteraction(UserInteraction.OpenResourceClick, {
                                content_title: item.title,
                                content_url: contentUrl,
                                content_type: getContentTypeForAnalytics(
                                  contentUrl,
                                  displayType === 'docs-page'
                                    ? 'docs'
                                    : displayType === 'interactive'
                                      ? 'interactive'
                                      : 'learning-journey'
                                ),
                                interaction_location: 'other_docs_list',
                                match_accuracy: item.matchAccuracy || 0,
                                ...(!isDocsOnlyRecommendation(displayType) && {
                                  total_milestones: item.totalSteps || 0,
                                  completion_percentage: item.completionPercentage ?? 0,
                                }),
                              });

                              if (shouldUseDocsPageOpener(item.type)) {
                                openDocsPage(contentUrl, item.title, packageInfo);
                              } else {
                                openLearningJourney(contentUrl, item.title);
                              }
                            }}
                            className={styles.docLink}
                          >
                            {item.title}
                          </button>
                        </div>
                      </div>
                    );
                  })}
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
  const pluginContext = usePluginContext();
  const configWithDefaults = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});

  // SECURITY: Dev mode - hybrid approach (synchronous check with user ID scoping)
  const currentUserId = config.bootData.user?.id;
  const devModeEnabled = isDevModeEnabled(configWithDefaults, currentUserId);

  // REACT HOOKS v7: Set global config in useEffect to avoid modifying globals during render
  useEffect(() => {
    (window as any).__pathfinderPluginConfig = configWithDefaults;
  }, [configWithDefaults]);

  // Use the simplified context hook
  const {
    contextData,
    isLoadingRecommendations,
    otherDocsExpanded,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
    toggleOtherDocsExpansion,
  } = useContextPanel({
    onOpenLearningJourney: model.state.onOpenLearningJourney,
    onOpenDocsPage: model.state.onOpenDocsPage,
  });
  const { guides: customGuides, isLoading: isLoadingCustomGuides } = usePublishedGuides();
  const [customGuidesExpanded, setCustomGuidesExpanded] = useState(true);
  const [suggestedGuidesExpanded, setSuggestedGuidesExpanded] = useState(true);

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

  return (
    <div className={styles.container} data-testid={testIds.contextPanel.container}>
      <div className={styles.content}>
        <div className={styles.contextSections}>
          {/* User profile bar with learning stats and next action */}
          <UserProfileBar onOpenGuide={openLearningJourney} />

          {/* Recommendations Section - Memoized to prevent unnecessary rerenders */}
          <RecommendationsSection
            recommendations={recommendations}
            featuredRecommendations={contextData.featuredRecommendations}
            customGuides={customGuides}
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
          />
        </div>

        {/* Help Footer */}
        <HelpFooter />
      </div>
    </div>
  );
}

// Styles now imported from context-panel.styles.ts
