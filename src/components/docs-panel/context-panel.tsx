import React, { memo, useEffect, Suspense, lazy } from 'react';

import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, useStyles2, Card, Badge, Alert } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';
import { t } from '@grafana/i18n';
import { SkeletonLoader } from '../SkeletonLoader';
import { FeedbackButton } from '../FeedbackButton/FeedbackButton';
import { EnableRecommenderBanner } from '../EnableRecommenderBanner';
import { HelpFooter } from '../HelpFooter';
import { locationService, config } from '@grafana/runtime';

// Lazy load dev tools to keep them out of production bundles
// This component is only loaded when dev mode is enabled
// Webpack will create a separate chunk for this import, which is only downloaded when dev mode is active
const SelectorDebugPanel = lazy(() =>
  import('../SelectorDebugPanel').then((module) => ({
    default: module.SelectorDebugPanel,
  }))
);

// Import refactored context system
import { getStyles } from '../../styles/context-panel.styles';
import { useContextPanel, Recommendation } from '../../context-engine';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getConfigWithDefaults } from '../../constants';
import { isDevModeEnabled } from '../../utils/dev-mode';
import { testIds } from '../testIds';

interface ContextPanelState extends SceneObjectState {
  onOpenLearningJourney?: (url: string, title: string) => void;
  onOpenDocsPage?: (url: string, title: string) => void;
}

export class ContextPanel extends SceneObjectBase<ContextPanelState> {
  public static Component = ContextPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(
    onOpenLearningJourney?: (url: string, title: string) => void,
    onOpenDocsPage?: (url: string, title: string) => void
  ) {
    super({
      onOpenLearningJourney,
      onOpenDocsPage,
    });
  }

  public openLearningJourney(url: string, title: string) {
    if (this.state.onOpenLearningJourney) {
      this.state.onOpenLearningJourney(url, title);
    }
  }

  public openDocsPage(url: string, title: string) {
    if (this.state.onOpenDocsPage) {
      this.state.onOpenDocsPage(url, title);
    } else {
      console.warn('No onOpenDocsPage callback available');
    }
  }

  public navigateToPath(path: string) {
    locationService.push(path);
  }
}

// Memoized recommendations section to prevent unnecessary rerenders
interface RecommendationsSectionProps {
  recommendations: Recommendation[];
  isLoadingRecommendations: boolean;
  isLoadingContext: boolean;
  recommendationsError: string | null;
  otherDocsExpanded: boolean;
  showEnableRecommenderBanner: boolean;
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string) => void;
  toggleSummaryExpansion: (recommendationUrl: string) => void;
  toggleOtherDocsExpansion: () => void;
}

const RecommendationsSection = memo(function RecommendationsSection({
  recommendations,
  isLoadingRecommendations,
  isLoadingContext,
  recommendationsError,
  otherDocsExpanded,
  showEnableRecommenderBanner,
  openLearningJourney,
  openDocsPage,
  toggleSummaryExpansion,
  toggleOtherDocsExpansion,
}: RecommendationsSectionProps) {
  const styles = useStyles2(getStyles);

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

  // If there's an error but no recommendations, show only the error
  if (recommendationsError && recommendations.length === 0) {
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

  // If there are no recommendations and no error, show empty state
  if (recommendations.length === 0) {
    return (
      <>
        <div className={styles.emptyContainer} data-testid={testIds.contextPanel.emptyState}>
          <Icon name="info-circle" />
          <span>No recommendations available for your current context.</span>
        </div>
        {showEnableRecommenderBanner && <EnableRecommenderBanner />}
      </>
    );
  }

  // If we have recommendations (with or without error), render them
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
        {/* Primary Recommendations Section (High-Confidence Items, sorted by accuracy) */}
        {finalPrimaryRecommendations.length > 0 && (
          <div className={styles.recommendationsGrid} data-testid={testIds.contextPanel.recommendationsGrid}>
            {finalPrimaryRecommendations.map((recommendation, index) => (
              <Card
                key={index}
                className={`${styles.recommendationCard} ${
                  recommendation.type === 'docs-page' ? styles.compactCard : ''
                }`}
                data-testid={testIds.contextPanel.recommendationCard(index)}
              >
                <div
                  className={`${styles.recommendationCardContent} ${
                    recommendation.type === 'docs-page' ? styles.compactCardContent : ''
                  }`}
                >
                  <div
                    className={`${styles.cardHeader} ${
                      recommendation.type === 'docs-page' ? styles.compactHeader : ''
                    }`}
                  >
                    <h3
                      className={styles.recommendationCardTitle}
                      data-testid={testIds.contextPanel.recommendationTitle(index)}
                    >
                      {recommendation.title}
                    </h3>
                    <div
                      className={`${styles.cardActions} ${recommendation.summaryExpanded ? styles.hiddenActions : ''}`}
                    >
                      <button
                        onClick={() => {
                          // Track analytics - unified event for opening any resource
                          reportAppInteraction(UserInteraction.OpenResourceClick, {
                            content_title: recommendation.title,
                            content_url: recommendation.url,
                            content_type: recommendation.type === 'docs-page' ? 'docs' : 'learning-journey',
                            interaction_location: 'main_card_button',
                            match_accuracy: recommendation.matchAccuracy || 0,
                            ...(recommendation.type !== 'docs-page' && {
                              total_milestones: recommendation.totalSteps || 0,
                              completion_percentage: recommendation.completionPercentage ?? 0,
                            }),
                          });

                          // Open the appropriate content type
                          if (recommendation.type === 'docs-page') {
                            openDocsPage(recommendation.url, recommendation.title);
                          } else {
                            openLearningJourney(recommendation.url, recommendation.title);
                          }
                        }}
                        className={recommendation.type === 'docs-page' ? styles.secondaryButton : styles.startButton}
                        data-testid={testIds.contextPanel.recommendationStartButton(index)}
                      >
                        <Icon name={recommendation.type === 'docs-page' ? 'file-alt' : 'play'} size="sm" />
                        {recommendation.type === 'docs-page'
                          ? t('contextPanel.view', 'View')
                          : t('contextPanel.start', 'Start')}
                      </button>
                    </div>
                  </div>

                  {/* Only show summary/milestones for learning journeys or docs with summaries */}
                  {(recommendation.type !== 'docs-page' || recommendation.summary) && (
                    <>
                      <div className={styles.cardMetadata}>
                        <div className={styles.summaryInfo}>
                          <button
                            onClick={() => {
                              // Track summary click analytics (for both LJ and docs)
                              reportAppInteraction(UserInteraction.SummaryClick, {
                                content_title: recommendation.title,
                                content_url: recommendation.url,
                                content_type: recommendation.type === 'docs-page' ? 'docs' : 'learning-journey',
                                action: recommendation.summaryExpanded ? 'collapse' : 'expand',
                                match_accuracy: recommendation.matchAccuracy || 0,
                                ...(recommendation.type !== 'docs-page' && {
                                  total_milestones: recommendation.totalSteps || 0,
                                }),
                              });

                              toggleSummaryExpansion(recommendation.url);
                            }}
                            className={styles.summaryButton}
                            data-testid={testIds.contextPanel.recommendationSummaryButton(index)}
                          >
                            <Icon name="info-circle" size="sm" />
                            <span>{t('contextPanel.summary', 'Summary')}</span>
                            <Icon name={recommendation.summaryExpanded ? 'angle-up' : 'angle-down'} size="sm" />
                          </button>
                          {/* Show completion percentage for learning journeys */}
                          {recommendation.type !== 'docs-page' &&
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

                          {/* Only show milestones for learning journeys */}
                          {recommendation.type !== 'docs-page' &&
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
                                        // Track milestone click analytics
                                        reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
                                          content_title: recommendation.title,
                                          milestone_title: milestone.title,
                                          milestone_number: milestone.number,
                                          milestone_url: milestone.url,
                                          content_url: recommendation.url,
                                          interaction_location: 'milestone_list',
                                        });
                                        openLearningJourney(
                                          milestone.url,
                                          `${recommendation.title} - ${milestone.title}`
                                        );
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

                          {/* Sticky CTA button at bottom of summary */}
                          <div className={styles.summaryCta}>
                            <button
                              onClick={() => {
                                // Track analytics - unified event for opening any resource
                                reportAppInteraction(UserInteraction.OpenResourceClick, {
                                  content_title: recommendation.title,
                                  content_url: recommendation.url,
                                  content_type: recommendation.type === 'docs-page' ? 'docs' : 'learning-journey',
                                  interaction_location: 'summary_cta_button',
                                  match_accuracy: recommendation.matchAccuracy || 0,
                                  ...(recommendation.type !== 'docs-page' && {
                                    total_milestones: recommendation.totalSteps || 0,
                                    completion_percentage: recommendation.completionPercentage ?? 0,
                                  }),
                                });

                                // Open the appropriate content type
                                if (recommendation.type === 'docs-page') {
                                  openDocsPage(recommendation.url, recommendation.title);
                                } else {
                                  openLearningJourney(recommendation.url, recommendation.title);
                                }
                              }}
                              className={styles.summaryCtaButton}
                            >
                              <Icon name={recommendation.type === 'docs-page' ? 'file-alt' : 'play'} size="sm" />
                              {recommendation.type === 'docs-page'
                                ? t('contextPanel.viewDocumentation', 'View Documentation')
                                : t('contextPanel.startLearningJourney', 'Start Learning Journey')}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Other Documentation Section - all items beyond top 4, including learning journeys */}
        {secondaryDocs.length > 0 && (
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
                  {secondaryDocs.map((item, index) => (
                    <div
                      key={index}
                      className={styles.otherDocItem}
                      data-testid={testIds.contextPanel.otherDocItem(index)}
                    >
                      <div className={styles.docIcon}>
                        <Icon name={item.type === 'docs-page' ? 'file-alt' : 'play'} size="sm" />
                      </div>
                      <div className={styles.docContent}>
                        <button
                          onClick={() => {
                            // Track analytics - unified event for opening any resource
                            reportAppInteraction(UserInteraction.OpenResourceClick, {
                              content_title: item.title,
                              content_url: item.url,
                              content_type: item.type === 'docs-page' ? 'docs' : 'learning-journey',
                              interaction_location: 'other_docs_list',
                              match_accuracy: item.matchAccuracy || 0,
                              ...(item.type !== 'docs-page' && {
                                total_milestones: item.totalSteps || 0,
                                completion_percentage: item.completionPercentage ?? 0,
                              }),
                            });

                            // Open the appropriate content type
                            if (item.type === 'docs-page') {
                              openDocsPage(item.url, item.title);
                            } else {
                              openLearningJourney(item.url, item.title);
                            }
                          }}
                          className={styles.docLink}
                        >
                          {item.title}
                        </button>
                      </div>
                    </div>
                  ))}
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

  // Note: Auto-open event listener moved to CombinedPanelRenderer to avoid remounting issues
  // ContextPanelRenderer remounts when tabs change, causing listener cleanup

  const { recommendations, recommendationsError } = contextData;

  const styles = useStyles2(getStyles);

  // Determine if we should show the banner
  const showEnableRecommenderBanner =
    !isLoadingRecommendations &&
    !recommendationsError &&
    !isDevModeEnabled && 
    recommendations.length > 0 &&
    !configWithDefaults.acceptedTermsAndConditions;

  return (
    <div className={styles.container} data-testid={testIds.contextPanel.container}>
      <div className={styles.content}>
        <div className={styles.contextSections}>
          {/* Header Section - Always Visible */}
          <div className={styles.sectionHeader}>
            <div className={styles.titleContainer}>
              <h2 className={styles.sectionTitle} data-testid={testIds.contextPanel.heading}>
                {t('contextPanel.recommendedDocumentation', 'Recommended Documentation')}
              </h2>
              <Badge text="Beta" color="blue" className={styles.betaBadge} />
            </div>
            <p className={styles.sectionSubtitle}>
              {t(
                'contextPanel.subtitle',
                'Based on your current context, here are some learning journeys and documentation that may be beneficial.'
              )}
            </p>
            <div>
              <FeedbackButton variant="secondary" interactionLocation="context_panel_feedback_button" />
            </div>
          </div>

          {/* Recommendations Section - Memoized to prevent unnecessary rerenders */}
          <RecommendationsSection
            recommendations={recommendations}
            isLoadingRecommendations={isLoadingRecommendations}
            isLoadingContext={contextData.isLoading}
            recommendationsError={recommendationsError}
            otherDocsExpanded={otherDocsExpanded}
            showEnableRecommenderBanner={showEnableRecommenderBanner}
            openLearningJourney={openLearningJourney}
            openDocsPage={openDocsPage}
            toggleSummaryExpansion={toggleSummaryExpansion}
            toggleOtherDocsExpansion={toggleOtherDocsExpansion}
          />
        </div>

        {/* Debug Panel - only shown when dev mode is enabled (hybrid: server-side storage, per-user scoping) */}
        {devModeEnabled && (
          <div className={styles.debugSection}>
            <Suspense fallback={<SkeletonLoader type="recommendations" />}>
              <SelectorDebugPanel onOpenDocsPage={openDocsPage} />
            </Suspense>
          </div>
        )}

        {/* Help Footer */}
        <HelpFooter />
      </div>
    </div>
  );
}

// Styles now imported from context-panel.styles.ts
