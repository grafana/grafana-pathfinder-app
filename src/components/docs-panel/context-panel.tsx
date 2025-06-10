import { css } from '@emotion/css';
import React, { useEffect, useState } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, useStyles2, Card } from '@grafana/ui';
import { getBackendSrv, locationService } from '@grafana/runtime';
import { RECOMMENDER_SERVICE_URL } from '../../constants';
import { fetchLearningJourneyContent, Milestone } from '../../utils/docs-fetcher';

interface DataSource {
  id: number;
  name: string;
  type: string;
  url?: string;
  isDefault?: boolean;
  access?: string;
}

interface DashboardInfo {
  id?: number;
  title?: string;
  uid?: string;
  tags?: string[];
  folderId?: number;
  folderTitle?: string;
}

interface Recommendation {
  title: string;
  url: string;
  type?: string; // 'learning-journeys' or 'docs-page'
  milestones?: Milestone[];
  totalSteps?: number;
  isLoadingSteps?: boolean;
  stepsExpanded?: boolean;
  [key: string]: any; // Allow for additional attributes from the server
}

interface RecommenderResponse {
  recommendations: Recommendation[];
}

interface ContextPayload {
  path: string;
  datasources: string[];
}

interface ContextPanelState extends SceneObjectState {
  currentPath: string;
  currentUrl: string;
  pathSegments: string[];
  timestamp: string;
  dataSources: DataSource[];
  dashboardInfo: DashboardInfo | null;
  isLoading: boolean;
  searchParams: Record<string, string>;
  grafanaVersion: string;
  theme: string;
  recommendations: Recommendation[];
  isLoadingRecommendations: boolean;
  recommendationsError: string | null;
  otherDocsExpanded: boolean;
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
      currentPath: '',
      currentUrl: '',
      pathSegments: [],
      timestamp: '',
      dataSources: [],
      dashboardInfo: null,
      isLoading: false,
      searchParams: {},
      grafanaVersion: '',
      theme: '',
      recommendations: [],
      isLoadingRecommendations: false,
      recommendationsError: null,
      otherDocsExpanded: false,
      onOpenLearningJourney,
      onOpenDocsPage,
    });

    this.updateContext();
  }

  private async updateContext() {
    this.setState({ isLoading: true });

    const currentPath = window.location.pathname;
    const currentUrl = window.location.href;
    const pathSegments = currentPath.split('/').filter(Boolean);
    const timestamp = new Date().toISOString();
    
    // Parse search parameters
    const searchParams: Record<string, string> = {};
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach((value, key) => {
      searchParams[key] = value;
    });

    // Get theme from body class or localStorage
    const theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';

    this.setState({
      currentPath,
      currentUrl,
      pathSegments,
      timestamp,
      searchParams,
      theme,
    });

    // Fetch additional context data
    await Promise.all([
      this.fetchDataSources(),
      this.fetchDashboardInfo(),
      this.fetchGrafanaVersion(),
    ]);

    // Fetch recommendations after we have the data sources
    await this.fetchRecommendations();

    this.setState({ isLoading: false });
  }

  private async fetchDataSources() {
    try {
      const dataSources = await getBackendSrv().get('/api/datasources');
      this.setState({ dataSources: dataSources || [] });
    } catch (error) {
      console.warn('Failed to fetch data sources:', error);
      this.setState({ dataSources: [] });
    }
  }

  private async fetchDashboardInfo() {
    try {
      // Check if we're on a dashboard page
      const pathMatch = this.state.currentPath.match(/\/d\/([^\/]+)/);
      if (pathMatch) {
        const dashboardUid = pathMatch[1];
        const dashboardInfo = await getBackendSrv().get(`/api/dashboards/uid/${dashboardUid}`);
        this.setState({ 
          dashboardInfo: {
            id: dashboardInfo.dashboard?.id,
            title: dashboardInfo.dashboard?.title,
            uid: dashboardInfo.dashboard?.uid,
            tags: dashboardInfo.dashboard?.tags,
            folderId: dashboardInfo.meta?.folderId,
            folderTitle: dashboardInfo.meta?.folderTitle,
          }
        });
      } else {
        this.setState({ dashboardInfo: null });
      }
    } catch (error) {
      console.warn('Failed to fetch dashboard info:', error);
      this.setState({ dashboardInfo: null });
    }
  }

  private async fetchGrafanaVersion() {
    try {
      const health = await getBackendSrv().get('/api/health');
      this.setState({ grafanaVersion: health.version || 'Unknown' });
    } catch (error) {
      console.warn('Failed to fetch Grafana version:', error);
      this.setState({ grafanaVersion: 'Unknown' });
    }
  }

  private async fetchRecommendations() {
    this.setState({ isLoadingRecommendations: true, recommendationsError: null });

    try {
      // Prepare the payload for the recommender service
      const payload: ContextPayload = {
        path: this.state.currentPath,
        datasources: this.state.dataSources.map(ds => ds.name),
      };

      console.log('Sending context to recommender service:', payload);

      // Send request to your recommender service
      const response = await fetch(`${RECOMMENDER_SERVICE_URL}/recommend`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: RecommenderResponse = await response.json();
      const recommendations = data.recommendations || [];
      
      // Only fetch step counts for learning journey recommendations
      console.log('Processing recommendations by type...');
      const processedRecommendations = await Promise.all(
        recommendations.map(async (recommendation) => {
          // Only fetch milestone data for learning journeys
          if (recommendation.type === 'learning-journeys' || !recommendation.type) {
            try {
              console.log(`Fetching step counts for learning journey: ${recommendation.title}`);
              const journeyContent = await fetchLearningJourneyContent(recommendation.url);
              return {
                ...recommendation,
                totalSteps: journeyContent?.milestones?.length || 0,
                milestones: journeyContent?.milestones || [],
              };
            } catch (error) {
              console.warn(`Failed to fetch steps for learning journey ${recommendation.title}:`, error);
              return {
                ...recommendation,
                totalSteps: 0,
                milestones: [],
              };
            }
          } else {
            // For docs pages, don't fetch milestone data
            console.log(`Skipping milestone fetch for docs page: ${recommendation.title}`);
            return {
              ...recommendation,
              totalSteps: 0, // Docs pages don't have steps
              milestones: [],
            };
          }
        })
      );

      this.setState({ 
        recommendations: processedRecommendations,
        isLoadingRecommendations: false,
        recommendationsError: null,
      });

      console.log('Loaded recommendations with step counts:', processedRecommendations);
    } catch (error) {
      console.warn('Failed to fetch recommendations:', error);
      this.setState({ 
        recommendations: [],
        isLoadingRecommendations: false,
        recommendationsError: error instanceof Error ? error.message : 'Failed to fetch recommendations',
      });
    }
  }

  public refreshContext() {
    this.updateContext();
  }

  public refreshRecommendations() {
    this.fetchRecommendations();
  }

  public openLearningJourney(url: string, title: string) {
    if (this.state.onOpenLearningJourney) {
      this.state.onOpenLearningJourney(url, title);
    }
  }

  public openDocsPage(url: string, title: string) {
    console.log('ContextPanel.openDocsPage called with:', { url, title, hasCallback: !!this.state.onOpenDocsPage });
    if (this.state.onOpenDocsPage) {
      this.state.onOpenDocsPage(url, title);
    } else {
      console.warn('No onOpenDocsPage callback available');
    }
  }

  public async toggleStepsExpansion(index: number) {
    const recommendations = [...this.state.recommendations];
    const recommendation = recommendations[index];
    
    // Simply toggle expansion state since milestones are already loaded
    recommendations[index] = {
      ...recommendation,
      stepsExpanded: !recommendation.stepsExpanded,
    };
    
    this.setState({ recommendations });
  }

  public navigateToPath(path: string) {
    locationService.push(path);
  }

  public toggleOtherDocsExpansion() {
    this.setState({ otherDocsExpanded: !this.state.otherDocsExpanded });
  }
}

function ContextPanelRenderer({ model }: SceneComponentProps<ContextPanel>) {
  const {
    recommendations,
    isLoadingRecommendations,
    recommendationsError,
    isLoading,
    otherDocsExpanded,
  } = model.useState();
  
  const styles = useStyles2(getStyles);

  // Group recommendations by type
  const learningJourneys = recommendations.filter(rec => rec.type === 'learning-journeys' || !rec.type);
  const otherDocs = recommendations.filter(rec => rec.type === 'docs-page');

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
              <h2 className={styles.sectionTitle}>Stuck on what to do next?</h2>
              <p className={styles.sectionSubtitle}>
                Here are some learning journeys that might help based on your current context
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
                {/* Learning Journeys Section */}
                {learningJourneys.length > 0 && (
                  <div className={styles.recommendationsGrid}>
                    {learningJourneys.map((recommendation, index) => (
                      <Card key={index} className={styles.recommendationCard}>
                        <div className={styles.recommendationCardContent}>
                          <div className={styles.cardHeader}>
                            <h3 className={styles.recommendationCardTitle}>{recommendation.title}</h3>
                            <div className={styles.cardActions}>
                              <button 
                                onClick={() => model.openLearningJourney(recommendation.url, recommendation.title)}
                                className={styles.startButton}
                              >
                                <Icon name="play" size="sm" />
                                Start Journey
                              </button>
                            </div>
                          </div>
                          
                          <div className={styles.cardMetadata}>
                            <div className={styles.stepsInfo}>
                              {(recommendation.totalSteps ?? 0) > 0 ? (
                                <span className={styles.stepsCount}>
                                  <Icon name="list-ul" size="xs" />
                                  {recommendation.totalSteps} step{recommendation.totalSteps !== 1 ? 's' : ''}
                                </span>
                              ) : (
                                <span className={styles.stepsCount}>
                                  <Icon name="list-ul" size="xs" />
                                  Multiple steps
                                </span>
                              )}
                              
                              {(recommendation.totalSteps ?? 0) > 0 && (
                                <button
                                  onClick={() => model.toggleStepsExpansion(index)}
                                  className={styles.viewStepsButton}
                                >
                                  {recommendation.stepsExpanded ? (
                                    <>
                                      <Icon name="angle-up" size="sm" />
                                      Hide steps
                                    </>
                                  ) : (
                                    <>
                                      <Icon name="angle-down" size="sm" />
                                      View steps
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                          
                          {recommendation.stepsExpanded && recommendation.milestones && (
                            <div className={styles.stepsExpansion}>
                              <div className={styles.stepsList}>
                                {recommendation.milestones.map((milestone, stepIndex) => (
                                  <div key={stepIndex} className={styles.stepItem}>
                                    <div className={styles.stepNumber}>{milestone.number}</div>
                                    <div className={styles.stepContent}>
                                      <div className={styles.stepTitle}>{milestone.title}</div>
                                      <div className={styles.stepDuration}>{milestone.duration}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Other Relevant Docs Section */}
                {otherDocs.length > 0 && (
                  <div className={styles.otherDocsSection}>
                    <div className={styles.otherDocsHeader}>
                      <button
                        onClick={() => model.toggleOtherDocsExpansion()}
                        className={styles.otherDocsToggle}
                      >
                        <Icon name="file-alt" size="sm" />
                        <span>Other Relevant Docs</span>
                        <span className={styles.otherDocsCount}>
                          <Icon name="list-ul" size="xs" />
                          {otherDocs.length} doc{otherDocs.length !== 1 ? 's' : ''}
                        </span>
                        <Icon name={otherDocsExpanded ? "angle-up" : "angle-down"} size="sm" />
                      </button>
                    </div>
                    
                    {otherDocsExpanded && (
                      <div className={styles.otherDocsExpansion}>
                        <div className={styles.otherDocsList}>
                          {otherDocs.map((doc, index) => (
                            <div key={index} className={styles.otherDocItem}>
                              <div className={styles.docIcon}>
                                <Icon name="file-alt" size="sm" />
                              </div>
                              <div className={styles.docContent}>
                                <button
                                  onClick={() => {
                                    console.log('Docs button clicked!', doc.title, doc.url);
                                    model.openDocsPage(doc.url, doc.title);
                                  }}
                                  className={styles.docLink}
                                >
                                  {doc.title}
                                </button>
                              </div>
                              <div className={styles.docActions}>
                                <Icon name="external-link-alt" size="xs" />
                              </div>
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

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    label: 'context-container',
    backgroundColor: theme.colors.background.primary,
    borderRadius: '0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: `1px solid ${theme.colors.border.weak}`,
    borderTop: 'none',
    borderBottom: 'none',
    margin: theme.spacing(-1),
    height: `calc(100% + ${theme.spacing(2)})`,
    width: `calc(100% + ${theme.spacing(2)})`,
  }),
  content: css({
    label: 'context-content',
    flex: 1,
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
  }),
  loadingContainer: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2),
    justifyContent: 'center',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
    margin: theme.spacing(2),
  }),
  contextSections: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
    padding: theme.spacing(2),
  }),
  errorContainer: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  emptyContainer: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: theme.spacing(2),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  recommendationCard: css({
    padding: theme.spacing(2),
  }),
  recommendationCardContent: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
  }),
  recommendationCardTitle: css({
    margin: 0,
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    lineHeight: 1.3,
    wordBreak: 'break-word',
    flex: 1,
    minWidth: 0,
  }),
  startButton: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    padding: `${theme.spacing(0.75)} ${theme.spacing(1.5)}`,
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    border: 'none',
    borderRadius: theme.shape.radius.default,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.primary.shade,
      transform: 'translateY(-1px)',
      boxShadow: theme.shadows.z1,
    },
  }),
  cardHeader: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1.5),
    marginBottom: theme.spacing(2),
    
    // For larger screens, use row layout
    '@media (min-width: 600px)': {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: theme.spacing(2),
    },
  }),
  cardActions: css({
    display: 'flex',
    gap: theme.spacing(1),
    justifyContent: 'flex-start',
    flexShrink: 0,
    
    // For larger screens, align to the right
    '@media (min-width: 600px)': {
      justifyContent: 'flex-end',
    },
  }),
  cardMetadata: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: theme.spacing(1),
    borderTop: `1px solid ${theme.colors.border.weak}`,
  }),
  stepsInfo: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
    width: '100%',
  }),
  stepsCount: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
    backgroundColor: theme.colors.background.secondary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  viewStepsButton: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    backgroundColor: 'transparent',
    border: 'none',
    padding: theme.spacing(0.25),
    cursor: 'pointer',
    color: theme.colors.text.link,
    fontSize: theme.typography.bodySmall.fontSize,
    borderRadius: theme.shape.radius.default,
    transition: 'all 0.2s ease',
    '&:hover:not(:disabled)': {
      backgroundColor: theme.colors.action.hover,
      textDecoration: 'none',
    },
    '&:disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
  }),
  stepsExpansion: css({
    marginTop: theme.spacing(1.5),
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  stepsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  }),
  stepItem: css({
    display: 'flex',
    alignItems: 'flex-start',
    gap: theme.spacing(1),
    padding: theme.spacing(0.5),
    borderRadius: theme.shape.radius.default,
    transition: 'background-color 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  stepNumber: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    backgroundColor: theme.colors.primary.main,
    color: theme.colors.primary.contrastText,
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: theme.typography.fontWeightBold,
    flexShrink: 0,
  }),
  stepContent: css({
    flex: 1,
    minWidth: 0,
  }),
  stepTitle: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    marginBottom: theme.spacing(0.25),
    lineHeight: 1.3,
  }),
  stepDuration: css({
    fontSize: '11px',
    color: theme.colors.text.secondary,
    fontStyle: 'italic',
  }),
  sectionHeader: css({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(3, 2),
    textAlign: 'center',
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    marginBottom: theme.spacing(2),
  }),
  headerIcon: css({
    color: theme.colors.primary.main,
    marginBottom: theme.spacing(1),
  }),
  sectionTitle: css({
    margin: 0,
    fontSize: theme.typography.h4.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.primary,
  }),
  sectionSubtitle: css({
    margin: 0,
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.text.secondary,
    maxWidth: '400px',
  }),
  recommendationsGrid: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  }),
  recommendationsContainer: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  }),
  otherDocsSection: css({
    backgroundColor: theme.colors.background.secondary,
    border: `1px solid ${theme.colors.border.weak}`,
    borderRadius: theme.shape.radius.default,
    overflow: 'hidden',
  }),
  otherDocsHeader: css({
    backgroundColor: theme.colors.background.canvas,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    padding: theme.spacing(1),
  }),
  otherDocsToggle: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    width: '100%',
    padding: `${theme.spacing(1)} ${theme.spacing(1.5)}`,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: theme.shape.radius.default,
    color: theme.colors.text.primary,
    cursor: 'pointer',
    fontSize: theme.typography.body.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  otherDocsCount: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    marginLeft: 'auto',
    marginRight: theme.spacing(1),
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightBold,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.primary,
    padding: `${theme.spacing(0.5)} ${theme.spacing(1)}`,
    borderRadius: theme.shape.radius.default,
    border: `1px solid ${theme.colors.border.weak}`,
  }),
  otherDocsExpansion: css({
    padding: theme.spacing(1.5),
    backgroundColor: theme.colors.background.secondary,
  }),
  otherDocsList: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.75),
  }),
  otherDocItem: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    borderRadius: theme.shape.radius.default,
    transition: 'background-color 0.2s ease',
    '&:hover': {
      backgroundColor: theme.colors.action.hover,
    },
  }),
  docIcon: css({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
  docContent: css({
    flex: 1,
    minWidth: 0,
  }),
  docLink: css({
    color: theme.colors.primary.main,
    textDecoration: 'none',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    lineHeight: 1.3,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    textAlign: 'left',
    width: '100%',
    '&:hover': {
      textDecoration: 'underline',
      color: theme.colors.primary.shade,
    },
  }),
  docActions: css({
    display: 'flex',
    alignItems: 'center',
    color: theme.colors.text.secondary,
    flexShrink: 0,
  }),
}); 