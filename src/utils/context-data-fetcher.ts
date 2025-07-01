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
  matchAccuracy?: number; // Scale of 0 to 1, where 1 = 100% accurate match
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

/**
 * Filter out unhelpful recommendations that point to generic landing pages
 */
function filterUsefulRecommendations(recommendations: Recommendation[]): Recommendation[] {
  return recommendations.filter(recommendation => {
    const url = recommendation.url;
    
    // Remove generic learning journeys landing page (no specific journey)
    if (url === 'https://grafana.com/docs/learning-journeys' || 
        url === 'https://grafana.com/docs/learning-journeys/') {
      console.log(`🗑️ Filtering out generic landing page: ${url}`);
      return false;
    }
    
    // Remove URLs that are just the base with query parameters but no journey path
    if (url.match(/^https:\/\/grafana\.com\/docs\/learning-journeys\/?\?/)) {
      console.log(`🗑️ Filtering out landing page with query params: ${url}`);
      return false;
    }
    
    // Keep recommendations that point to specific learning journeys or docs pages
    return true;
  });
}

/**
 * Sort recommendations by type and match accuracy
 * Learning journeys always come first, then docs pages
 * Within each type, sort by matchAccuracy (highest first)
 */
function sortRecommendationsByAccuracy(recommendations: Recommendation[]): Recommendation[] {
  // Separate learning journeys from docs pages
  const learningJourneys = recommendations.filter(rec => 
    rec.type === 'learning-journey' || !rec.type // Default to learning-journey if no type
  );
  const docsPages = recommendations.filter(rec => 
    rec.type === 'docs-page'
  );
  
  // Sort by matchAccuracy (highest first), treating undefined as 0
  const sortByAccuracy = (a: Recommendation, b: Recommendation) => {
    const accuracyA = a.matchAccuracy ?? 0;
    const accuracyB = b.matchAccuracy ?? 0;
    return accuracyB - accuracyA; // Descending order (highest first)
  };
  
  // Sort each group by accuracy
  const sortedLearningJourneys = learningJourneys.sort(sortByAccuracy);
  const sortedDocsPages = docsPages.sort(sortByAccuracy);
  
  console.log(`Sorted ${sortedLearningJourneys.length} learning journeys and ${sortedDocsPages.length} docs pages by match accuracy`);
  
  // Return learning journeys first, then docs pages
  return [...sortedLearningJourneys, ...sortedDocsPages];
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
    
    // Filter out unhelpful recommendations
    const filteredRecommendations = filterUsefulRecommendations(processedRecommendations);
    
    // Sort recommendations by type and matchAccuracy
    // Learning journeys always come first, then docs pages
    // Within each type, sort by matchAccuracy (highest first)
    const sortedRecommendations = sortRecommendationsByAccuracy(filteredRecommendations);
    
    console.log('Sorted recommendations by match accuracy:', sortedRecommendations);
    return {
      recommendations: sortedRecommendations,
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
