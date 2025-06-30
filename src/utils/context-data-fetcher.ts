import { getBackendSrv, config } from '@grafana/runtime';
import { getRecommenderServiceUrl } from '../constants';
import { fetchLearningJourneyContent, Milestone } from './docs-fetcher';

// Interfaces extracted from context-panel.tsx
export interface DataSource {
  id: number;
  name: string;
  type: string;
  url?: string;
  isDefault?: boolean;
  access?: string;
}

export interface DashboardInfo {
  id?: number;
  title?: string;
  uid?: string;
  tags?: string[];
  folderId?: number;
  folderTitle?: string;
}

export interface Recommendation {
  title: string;
  url: string;
  type?: string; // 'learning-journey' or 'docs-page'
  milestones?: Milestone[];
  totalSteps?: number;
  isLoadingSteps?: boolean;
  stepsExpanded?: boolean;
  summary?: string; // Journey summary from first 3 paragraphs
  summaryExpanded?: boolean; // Track summary expansion state
  [key: string]: any; // Allow for additional attributes from the server
}

export interface RecommenderResponse {
  recommendations: Recommendation[];
}

export interface ContextPayload {
  path: string;
  datasources: string[];
  tags: string[];
  user_id: string;
  user_role: string;
}

// Data fetching functions extracted from context panel
export async function fetchDataSources(): Promise<DataSource[]> {
  try {
    const dataSources = await getBackendSrv().get('/api/datasources');
    return dataSources || [];
  } catch (error) {
    console.warn('Failed to fetch data sources:', error);
    return [];
  }
}

export async function fetchDashboardInfo(currentPath: string): Promise<DashboardInfo | null> {
  try {
    // Check if we're on a dashboard page
    const pathMatch = currentPath.match(/\/d\/([^\/]+)/);
    if (pathMatch) {
      const dashboardUid = pathMatch[1];
      const dashboardInfo = await getBackendSrv().get(`/api/dashboards/uid/${dashboardUid}`);
      return {
        id: dashboardInfo.dashboard?.id,
        title: dashboardInfo.dashboard?.title,
        uid: dashboardInfo.dashboard?.uid,
        tags: dashboardInfo.dashboard?.tags,
        folderId: dashboardInfo.meta?.folderId,
        folderTitle: dashboardInfo.meta?.folderTitle,
      };
    }
    return null;
  } catch (error) {
    console.warn('Failed to fetch dashboard info:', error);
    return null;
  }
}

export async function fetchGrafanaVersion(): Promise<string> {
  try {
    const health = await getBackendSrv().get('/api/health');
    return health.version || 'Unknown';
  } catch (error) {
    console.warn('Failed to fetch Grafana version:', error);
    return 'Unknown';
  }
}

export async function fetchRecommendations(
  currentPath: string,
  dataSources: DataSource[],
  contextTags: string[]
): Promise<{ 
  recommendations: Recommendation[];
  error: string | null;
}> {
  try {
    // Prepare the payload for the recommender service
    const payload: ContextPayload = {
      path: currentPath,
      datasources: dataSources.map(ds => ds.name),
      tags: contextTags,
      user_id: config.bootData.user.uid,
      user_role: config.bootData.user.orgRole || 'Viewer',
    };

    console.log('Sending context to recommender service:', payload);
    console.log('Generated context tags:', contextTags);

    // Send request to your recommender service
    const response = await fetch(`${getRecommenderServiceUrl()}/recommend`, {
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
    const defaultR: Recommendation = {
      title: 'Product Interactive Tutorial Demo',
      // This will have /unstyled.html added to it.
      url: 'https://raw.githubusercontent.com/moxious/dynamics-test/refs/heads/main/prometheus-datasource',
      type: 'docs-page',
      summary: 'A test of interactive elements.',
    };
    const recommendations = data.recommendations || [];
    recommendations.push(defaultR);
    
    // Only fetch step counts for learning journey recommendations
    console.log('Processing recommendations by type...');
    const processedRecommendations = await Promise.all(
      recommendations.map(async (recommendation) => {
        // Only fetch milestone data for learning journeys
        if (recommendation.type === 'learning-journey' || !recommendation.type) {
          try {
            console.log(`Fetching step counts and summary for learning journey: ${recommendation.title}`);
            const journeyContent = await fetchLearningJourneyContent(recommendation.url);
            return {
              ...recommendation,
              totalSteps: journeyContent?.milestones?.length || 0,
              milestones: journeyContent?.milestones || [],
              summary: journeyContent?.summary || '',
            };
          } catch (error) {
            console.warn(`Failed to fetch steps for learning journey ${recommendation.title}:`, error);
            return {
              ...recommendation,
              totalSteps: 0,
              milestones: [],
              summary: '',
            };
          }
        } else {
          // For docs pages, don't fetch milestone data
          console.log(`Skipping milestone fetch for docs page: ${recommendation.title}`);
          return {
            ...recommendation,
            totalSteps: 0, // Docs pages don't have steps
            milestones: [],
            summary: '',
          };
        }
      })
    );

    console.log('Loaded recommendations with step counts:', processedRecommendations);
    return {
      recommendations: processedRecommendations,
      error: null,
    };
  } catch (error) {
    console.warn('Failed to fetch recommendations:', error);
    return {
      recommendations: [],
      error: error instanceof Error ? error.message : 'Failed to fetch recommendations',
    };
  }
} 
