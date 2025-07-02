import React from 'react';

import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, useStyles2, Card } from '@grafana/ui';
import { locationService } from '@grafana/runtime';

// Import refactored utilities
import { getStyles } from '../../styles/context-panel.styles';
import { 
  Recommendation, 
} from '../../utils/context-data-fetcher';
import { useContextPanel } from '../../utils/context-panel.hook';

// Interfaces now imported from context-data-fetcher.ts

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
  // Use the context panel hook for all logic
  const contextPanelState = useContextPanel({
    onOpenLearningJourney: model.state.onOpenLearningJourney,
    onOpenDocsPage: model.state.onOpenDocsPage,
  });
  
  const {
    recommendations,
    isLoadingRecommendations,
    recommendationsError,
    isLoading,
    otherDocsExpanded,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
    toggleOtherDocsExpansion,
  } = contextPanelState;
  
  const styles = useStyles2(getStyles);

  // Group recommendations by type
  const learningJourneys = recommendations.filter((rec: Recommendation) => rec.type === 'learning-journey' || !rec.type);
  const otherDocs = recommendations.filter((rec: Recommendation) => rec.type === 'docs-page');
  
  // If there are no learning journeys but there are docs, promote docs to primary display
  const shouldPromoteDocsAsPrimary = learningJourneys.length === 0 && otherDocs.length > 0;
  const primaryRecommendations = shouldPromoteDocsAsPrimary ? otherDocs : learningJourneys;
  const secondaryDocs = shouldPromoteDocsAsPrimary ? [] : otherDocs;

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
                {/* Primary Recommendations Section (Learning Journeys or Docs if no journeys) */}
                {primaryRecommendations.length > 0 && (
                  <div className={styles.recommendationsGrid}>
                    {primaryRecommendations.map((recommendation, index) => (
                      <Card key={index} className={`${styles.recommendationCard} ${recommendation.type === 'docs-page' ? styles.compactCard : ''}`}>
                        <div className={`${styles.recommendationCardContent} ${recommendation.type === 'docs-page' ? styles.compactCardContent : ''}`}>
                          <div className={`${styles.cardHeader} ${recommendation.type === 'docs-page' ? styles.compactHeader : ''}`}>
                            <h3 className={styles.recommendationCardTitle}>{recommendation.title}</h3>
                            <div className={styles.cardActions}>
                              <button 
                                onClick={() => {
                                  if (recommendation.type === 'docs-page') {
                                    openDocsPage(recommendation.url, recommendation.title);
                                  } else {
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
                                    onClick={() => toggleSummaryExpansion(index)}
                                    className={styles.summaryButton}
                                  >
                                    <Icon name="info-circle" size="sm" />
                                    <span>Summary</span>
                                    <Icon name={recommendation.summaryExpanded ? "angle-up" : "angle-down"} size="sm" />
                                  </button>
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
                              onClick={() => openLearningJourney(milestone.url, `${recommendation.title} - ${milestone.title}`)}
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
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Other Relevant Docs Section - only show when there are secondary docs */}
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
                                    console.log('Docs button clicked!', doc.title, doc.url);
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
