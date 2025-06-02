import { css } from '@emotion/css';
import React, { useEffect, useState } from 'react';

import { GrafanaTheme2 } from '@grafana/data';
import { SceneComponentProps, SceneObjectBase, SceneObjectState } from '@grafana/scenes';
import { Icon, IconButton, useStyles2, Card } from '@grafana/ui';
import { getBackendSrv, locationService } from '@grafana/runtime';
import { RECOMMENDER_SERVICE_URL } from '../../constants';

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
  onOpenLearningJourney?: (url: string, title: string) => void;
}

export class ContextPanel extends SceneObjectBase<ContextPanelState> {
  public static Component = ContextPanelRenderer;

  public get renderBeforeActivation(): boolean {
    return true;
  }

  public constructor(onOpenLearningJourney?: (url: string, title: string) => void) {
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
      onOpenLearningJourney,
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
      this.setState({ 
        recommendations: data.recommendations || [],
        isLoadingRecommendations: false,
        recommendationsError: null,
      });

      console.log('Received recommendations:', data.recommendations);
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

  public navigateToPath(path: string) {
    locationService.push(path);
  }
}

function ContextPanelRenderer({ model }: SceneComponentProps<ContextPanel>) {
  const {
    recommendations,
    isLoadingRecommendations,
    recommendationsError,
    isLoading,
  } = model.useState();
  
  const styles = useStyles2(getStyles);

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.title}>
          <div className={styles.titleContent}>
            <div className={styles.appIcon}>
              <Icon name="info-circle" size="lg" />
            </div>
            <div className={styles.titleText}>
              Learning Journeys
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <IconButton
            name="sync"
            aria-label="Refresh learning journeys"
            onClick={() => model.refreshRecommendations()}
            tooltip="Refresh learning journeys"
            tooltipPlacement="left"
          />
        </div>
      </div>

      <div className={styles.content}>
        {isLoading && (
          <div className={styles.loadingContainer}>
            <Icon name="sync" />
            <span>Loading context...</span>
          </div>
        )}

        {!isLoading && (
          <div className={styles.contextSections}>
            {isLoadingRecommendations && (
              <div className={styles.loadingContainer}>
                <Icon name="sync" />
                <span>Loading learning journeys...</span>
              </div>
            )}
            
            {recommendationsError && !isLoadingRecommendations && (
              <div className={styles.errorContainer}>
                <Icon name="exclamation-triangle" />
                <span>Failed to load learning journeys: {recommendationsError}</span>
              </div>
            )}
            
            {!isLoadingRecommendations && !recommendationsError && recommendations.length === 0 && (
              <div className={styles.emptyContainer}>
                <Icon name="info-circle" />
                <span>No learning journeys available</span>
              </div>
            )}
            
            {!isLoadingRecommendations && recommendations.length > 0 && (
              <>
                {recommendations.map((recommendation, index) => (
                  <Card key={index} className={styles.recommendationCard}>
                    <div className={styles.recommendationCardContent}>
                      <h3 className={styles.recommendationCardTitle}>{recommendation.title}</h3>
                      <button 
                        onClick={() => model.openLearningJourney(recommendation.url, recommendation.title)}
                        className={styles.recommendationCardButton}
                      >
                        <Icon name="book" size="sm" />
                        Start Learning Journey
                      </button>
                    </div>
                  </Card>
                ))}
              </>
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
  topBar: css({
    label: 'context-top-bar',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    backgroundColor: theme.colors.background.canvas,
  }),
  title: css({
    label: 'context-title',
    flex: 1,
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    fontWeight: theme.typography.fontWeightBold,
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(2),
  }),
  appIcon: css({
    label: 'context-icon',
    fontSize: '7px',
    color: theme.colors.text.primary,
    letterSpacing: '0.1em',
    opacity: 0.75,
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  titleContent: css({
    label: 'context-title-content',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(1),
  }),
  titleText: css({
    fontSize: theme.typography.h5.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
  }),
  actions: css({
    label: 'context-actions',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.spacing(1),
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
  }),
  recommendationCardButton: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    color: theme.colors.text.link,
    backgroundColor: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    '&:hover': {
      textDecoration: 'underline',
    },
  }),
}); 