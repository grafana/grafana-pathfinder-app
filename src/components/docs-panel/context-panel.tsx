import React from 'react';

import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, useStyles2, Card } from '@grafana/ui';
import { locationService } from '@grafana/runtime';

// Import refactored context system
import { getStyles } from '../../styles/context-panel.styles';
import { useContextPanel, Recommendation } from '../../utils/context';
import { reportAppInteraction, UserInteraction } from '../../lib/analytics';

interface ContextPanelState extends SceneObjectState {
  onOpenLearningJourney?: (url: string, title: string) => void;
  onOpenDocsPage?: (url: string, title: string) => void;
}

export class ContextPanel extends SceneObjectBase<ContextPanelState> {
  public static Component = ContextPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(onOpenLearningJourney?: (url: string, title: string) => void, onOpenDocsPage?: (url: string, title: string) => void) {
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

function ContextPanelRenderer({ model }: SceneComponentProps<ContextPanel>) {
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
  
  const {
    recommendations,
    isLoading,
    recommendationsError,
  } = contextData;
  
  const styles = useStyles2(getStyles);

  // Group recommendations by match accuracy, regardless of content type
  const learningJourneys = recommendations.filter((rec: Recommendation) => rec.type === 'learning-journey' || !rec.type);
  const allDocs = recommendations.filter((rec: Recommendation) => rec.type === 'docs-page');
  
  // Primary recommendations: high-confidence items get prominent display
  const highConfidenceLearningJourneys = learningJourneys.filter((rec: Recommendation) => (rec.matchAccuracy ?? 0) >= 0.5);
  const perfectMatchDocs = allDocs.filter((rec: Recommendation) => rec.matchAccuracy === 1);
  
  // Secondary recommendations: low-confidence learning journeys + imperfect docs
  const lowConfidenceLearningJourneys = learningJourneys.filter((rec: Recommendation) => (rec.matchAccuracy ?? 0) < 0.5);
  const imperfectDocs = allDocs.filter((rec: Recommendation) => rec.matchAccuracy !== 1);
  
  // Primary section: sort by match accuracy descending (best matches first, regardless of type)
  const primaryRecommendations = [...highConfidenceLearningJourneys, ...perfectMatchDocs]
    .sort((a, b) => (b.matchAccuracy ?? 0) - (a.matchAccuracy ?? 0));
  
  // Secondary section: sort by match accuracy descending
  const secondaryRecommendations = [...lowConfidenceLearningJourneys, ...imperfectDocs]
    .sort((a, b) => (b.matchAccuracy ?? 0) - (a.matchAccuracy ?? 0));
  
  // Fallback: if we have no primary recommendations but have secondary items, promote all to primary
  const shouldPromoteAllAsPrimary = primaryRecommendations.length === 0 && secondaryRecommendations.length > 0;
  const finalPrimaryRecommendations = shouldPromoteAllAsPrimary ? secondaryRecommendations : primaryRecommendations;
  const secondaryDocs = shouldPromoteAllAsPrimary ? [] : secondaryRecommendations;

  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {isLoading && (
          <div className={styles.loadingContainer}>
            <Icon name="sync" />
            <span>Loading context...</span>
          </div>
        )}

        {!isLoading && (
          <div className={styles.contextSections}>
            <div className={styles.sectionHeader}>
              <Icon name="question-circle" size="lg" className={styles.headerIcon} />
              <h2 className={styles.sectionTitle}>Recommended Documentation</h2>
              <p className={styles.sectionSubtitle}>
                Based on your current context, here are some learning journeys and documentation that may be beneficial.
              </p>
            </div>

            {isLoadingRecommendations && (
              <div className={styles.loadingContainer}>
                <Icon name="sync" />
                <span>Loading recommendations...</span>
              </div>
            )}
            
            {recommendationsError && !isLoadingRecommendations && (
              <div className={styles.errorContainer}>
                <Icon name="exclamation-triangle" />
                <span>Failed to load recommendations: {recommendationsError}</span>
              </div>
            )}
            
            {!isLoadingRecommendations && !recommendationsError && recommendations.length === 0 && (
              <div className={styles.emptyContainer}>
                <Icon name="info-circle" />
                <span>No recommendations available for your current context</span>
              </div>
            )}
            
            {!isLoadingRecommendations && recommendations.length > 0 && (
              <div className={styles.recommendationsContainer}>
                {/* Primary Recommendations Section (High-Confidence Items, sorted by accuracy) */}
                {finalPrimaryRecommendations.length > 0 && (
                  <div className={styles.recommendationsGrid}>
                    {finalPrimaryRecommendations.map((recommendation, index) => (
                      <Card key={index} className={`${styles.recommendationCard} ${recommendation.type === 'docs-page' ? styles.compactCard : ''}`}>
                        <div className={`${styles.recommendationCardContent} ${recommendation.type === 'docs-page' ? styles.compactCardContent : ''}`}>
                          <div className={`${styles.cardHeader} ${recommendation.type === 'docs-page' ? styles.compactHeader : ''}`}>
                            <h3 className={styles.recommendationCardTitle}>{recommendation.title}</h3>
                            <div className={`${styles.cardActions} ${recommendation.summaryExpanded ? styles.hiddenActions : ''}`}>
                              <button 
                                onClick={() => {
                                  // Track analytics based on content type
                                  if (recommendation.type === 'docs-page') {
                                    reportAppInteraction(UserInteraction.ViewDocumentationClick, {
                                      content_title: recommendation.title,
                                      content_url: recommendation.url,
                                      interaction_location: 'main_card_button',
                                      match_accuracy: recommendation.matchAccuracy || 0
                                    });
                                    openDocsPage(recommendation.url, recommendation.title);
                                  } else {
                                    reportAppInteraction(UserInteraction.StartLearningJourneyClick, {
                                      journey_title: recommendation.title,
                                      journey_url: recommendation.url,
                                      interaction_location: 'main_card_button',
                                      total_milestones: recommendation.totalSteps || 0,
                                      match_accuracy: recommendation.matchAccuracy || 0
                                    });
                                    openLearningJourney(recommendation.url, recommendation.title);
                                  }
                                }}
                                className={styles.startButton}
                              >
                                <Icon name={recommendation.type === 'docs-page' ? 'file-alt' : 'play'} size="sm" />
                                {recommendation.type === 'docs-page' ? 'View' : 'Start'}
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
                                      // Track learning journey summary click analytics
                                      reportAppInteraction(UserInteraction.LearningJourneySummaryClick, {
                                        journey_title: recommendation.title,
                                        journey_url: recommendation.url,
                                        content_type: recommendation.type || 'learning-journey',
                                        action: recommendation.summaryExpanded ? 'collapse' : 'expand',
                                        match_accuracy: recommendation.matchAccuracy || 0,
                                        total_milestones: recommendation.totalSteps || 0
                                      });
                                      
                                      toggleSummaryExpansion(recommendation.url);
                                    }}
                                    className={styles.summaryButton}
                                  >
                                    <Icon name="info-circle" size="sm" />
                                    <span>Summary</span>
                                    <Icon name={recommendation.summaryExpanded ? "angle-up" : "angle-down"} size="sm" />
                                  </button>
                                  {/* Show completion percentage for learning journeys */}
                                  {(recommendation.type !== 'docs-page') && typeof recommendation.completionPercentage === 'number' && (
                                    <div className={styles.completionInfo}>
                                      <div 
                                        className={styles.completionPercentage}
                                        data-completion={recommendation.completionPercentage}
                                      >
                                        {recommendation.completionPercentage}% complete
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
                                  
                                  {/* Only show milestones for learning journeys */}
                                  {recommendation.type !== 'docs-page' && (recommendation.totalSteps ?? 0) > 0 && recommendation.milestones && (
                                    <div className={styles.milestonesSection}>
                                      <div className={styles.milestonesHeader}>
                                        <h4 className={styles.milestonesTitle}>Milestones:</h4>
                                      </div>
                                      <div className={styles.milestonesList}>
                                        {recommendation.milestones.map((milestone, stepIndex) => (
                                                                      <button
                              key={stepIndex}
                              onClick={() => {
                                // Track milestone click analytics
                                reportAppInteraction(UserInteraction.JumpIntoMilestoneClick, {
                                  journey_title: recommendation.title,
                                  milestone_title: milestone.title,
                                  milestone_number: milestone.number,
                                  milestone_url: milestone.url,
                                  journey_url: recommendation.url,
                                  interaction_location: 'milestone_list'
                                });
                                openLearningJourney(milestone.url, `${recommendation.title} - ${milestone.title}`);
                              }}
                              className={styles.milestoneItem}
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
                                        // Track analytics for summary CTA buttons
                                        if (recommendation.type === 'docs-page') {
                                          reportAppInteraction(UserInteraction.ViewDocumentationClick, {
                                            content_title: recommendation.title,
                                            content_url: recommendation.url,
                                            interaction_location: 'summary_cta_button',
                                            match_accuracy: recommendation.matchAccuracy || 0
                                          });
                                          openDocsPage(recommendation.url, recommendation.title);
                                        } else {
                                          reportAppInteraction(UserInteraction.StartLearningJourneyClick, {
                                            journey_title: recommendation.title,
                                            journey_url: recommendation.url,
                                            interaction_location: 'summary_cta_button',
                                            total_milestones: recommendation.totalSteps || 0,
                                            match_accuracy: recommendation.matchAccuracy || 0
                                          });
                                          openLearningJourney(recommendation.url, recommendation.title);
                                        }
                                      }}
                                      className={styles.summaryCtaButton}
                                    >
                                      <Icon name={recommendation.type === 'docs-page' ? 'file-alt' : 'play'} size="sm" />
                                      {recommendation.type === 'docs-page' ? 'View Documentation' : 'Start Learning Journey'}
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

                {/* Other Relevant Docs Section - low-confidence items */}
                {secondaryDocs.length > 0 && (
                  <div className={styles.otherDocsSection}>
                    <div className={styles.otherDocsHeader}>
                      <button
                        onClick={() => toggleOtherDocsExpansion()}
                        className={styles.otherDocsToggle}
                      >
                        <Icon name="file-alt" size="sm" />
                        <span>Other Relevant Docs</span>
                        <span className={styles.otherDocsCount}>
                          <Icon name="list-ul" size="xs" />
                          {secondaryDocs.length} doc{secondaryDocs.length !== 1 ? 's' : ''}
                        </span>
                        <Icon name={otherDocsExpanded ? "angle-up" : "angle-down"} size="sm" />
                      </button>
                    </div>
                    
                    {otherDocsExpanded && (
                      <div className={styles.otherDocsExpansion}>
                        <div className={styles.otherDocsList}>
                          {secondaryDocs.map((doc, index) => (
                            <div key={index} className={styles.otherDocItem}>
                              <div className={styles.docIcon}>
                                <Icon name="file-alt" size="sm" />
                              </div>
                              <div className={styles.docContent}>
                                <button
                                  onClick={() => {
                                    // Track analytics for other docs links
                                    reportAppInteraction(UserInteraction.ViewDocumentationClick, {
                                      content_title: doc.title,
                                      content_url: doc.url,
                                      interaction_location: 'other_docs_list',
                                      match_accuracy: doc.matchAccuracy || 0
                                    });
                                    openDocsPage(doc.url, doc.title);
                                  }}
                                  className={styles.docLink}
                                >
                                  {doc.title}
                                </button>
                              </div>
                              {/* No external icon needed - these docs open in app tabs */}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Styles now imported from context-panel.styles.ts 
