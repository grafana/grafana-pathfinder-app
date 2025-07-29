import { getBackendSrv, config, locationService } from '@grafana/runtime';
import { getRecommenderServiceUrl } from '../../constants';
import { fetchContent, getJourneyCompletionPercentage } from '../docs-retrieval';
import { 
  ContextData, 
  DataSource, 
  Plugin,
  DashboardSearchResult,
  DashboardInfo, 
  Recommendation, 
  ContextPayload, 
  RecommenderResponse 
} from './context.types';

export class ContextService {
  /**
   * Main method to get all context data
   */
  static async getContextData(): Promise<ContextData> {
    const location = locationService.getLocation();
    const currentPath = location.pathname || window.location.pathname || '';
    const currentUrl = window.location.href;
    const pathSegments = currentPath.split('/').filter(Boolean);
    
    // Parse search parameters
    const searchParams: Record<string, string> = {};
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.forEach((value, key) => {
      searchParams[key] = value;
    });

    // Fetch data in parallel
    const [dataSources, dashboardInfo] = await Promise.all([
      this.fetchDataSources(),
      this.fetchDashboardInfo(currentPath)
    ]);

    // Generate context tags
    const tags = this.generateContextTags(pathSegments, searchParams, dataSources, dashboardInfo);

    return {
      currentPath,
      currentUrl,
      pathSegments,
      dataSources,
      dashboardInfo,
      recommendations: [], // Will be populated by fetchRecommendations
      tags,
      isLoading: false,
      recommendationsError: null,
      visualizationType: this.detectVisualizationType(),
      grafanaVersion: this.getGrafanaVersion(),
      theme: config.theme2.isDark ? 'dark' : 'light',
      timestamp: new Date().toISOString(),
      searchParams,
    };
  }

  /**
   * Fetch recommendations based on context
   */
  static async fetchRecommendations(contextData: ContextData): Promise<{
    recommendations: Recommendation[];
    error: string | null;
  }> {
    try {
      if (!contextData.currentPath) {
        return {
          recommendations: [],
          error: 'No path provided for recommendations',
        };
      }

      const payload: ContextPayload = {
        path: contextData.currentPath,
        datasources: contextData.dataSources.map(ds => ds.name),
        tags: contextData.tags,
        user_id: config.bootData.user.analytics.identifier,
        user_role: config.bootData.user.orgRole || 'Viewer',
        platform: config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud') ? 'cloud' : 'oss',
      };

      const response = await fetch(`${getRecommenderServiceUrl()}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: RecommenderResponse = await response.json();
      
      // Add bundled interactive recommendations (contextual based on current URL)
      const bundledRecommendations: Recommendation[] = this.getBundledInteractiveRecommendations(contextData);
      
      // Add default recommendations for testing
      const defaultRecommendations: Recommendation[] = [

        {
          title: 'Product Interactive Tutorial Demo',
          url: 'https://raw.githubusercontent.com/moxious/dynamics-test/refs/heads/main/prometheus-datasource',
          type: 'docs-page',
          summary: 'A test of interactive elements.',
        },
        {
          title: 'Tutorial Environment Demo',
          url: 'https://raw.githubusercontent.com/Jayclifford345/tutorial-environment/refs/heads/master/',
          type: 'docs-page',
          summary: 'Additional tutorial environment for testing interactive elements.',
        },
      ];

      const allRecommendations = [...(data.recommendations || []), ...bundledRecommendations, ...defaultRecommendations];

      console.warn('allRecommendations', allRecommendations);
      
      // Process recommendations
      const processedRecommendations = await Promise.all(
        allRecommendations.map(async (rec) => {
          if (rec.type === 'learning-journey' || !rec.type) {
            try {
              const result = await fetchContent(rec.url);
              const completionPercentage = getJourneyCompletionPercentage(rec.url);
              
              // Extract learning journey data from the unified content
              const milestones = result.content?.metadata.learningJourney?.milestones || [];
              const summary = result.content?.metadata.learningJourney?.summary || rec.summary || '';
              
              return {
                ...rec,
                totalSteps: milestones.length,
                milestones: milestones,
                summary: summary,
                completionPercentage,
              };
            } catch (error) {
              console.warn(`Failed to fetch journey data for ${rec.title}:`, error);
              return {
                ...rec,
                totalSteps: 0,
                milestones: [],
                summary: rec.summary || '',
                completionPercentage: getJourneyCompletionPercentage(rec.url),
              };
            }
          }
          return rec;
        })
      );

      // Filter and sort recommendations
      const filteredRecommendations = this.filterUsefulRecommendations(processedRecommendations);
      const sortedRecommendations = this.sortRecommendationsByAccuracy(filteredRecommendations);

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

  /**
   * Fetch data sources
   */
  static async fetchDataSources(): Promise<DataSource[]> {
    try {
      const dataSources = await getBackendSrv().get('/api/datasources');
      return dataSources || [];
    } catch (error) {
      console.warn('Failed to fetch data sources:', error);
      return [];
    }
  }

  /**
   * Fetch plugins
   */
  static async fetchPlugins(): Promise<Plugin[]> {
    try {
      const plugins = await getBackendSrv().get('/api/plugins');
      return plugins || [];
    } catch (error) {
      console.warn('Failed to fetch plugins:', error);
      return [];
    }
  }

  /**
   * Fetch dashboards by name using search API
   */
  static async fetchDashboardsByName(name: string): Promise<DashboardSearchResult[]> {
    try {
      const dashboards = await getBackendSrv().get('/api/search', {
        type: 'dash-db',
        limit: 100,
        deleted: false,
        query: name
      });
      return dashboards || [];
    } catch (error) {
      console.warn('Failed to fetch dashboards:', error);
      return [];
    }
  }

  /**
   * Fetch dashboard info if on dashboard page
   */
  private static async fetchDashboardInfo(currentPath: string): Promise<DashboardInfo | null> {
    try {
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

  /**
   * Generate context tags (simplified version)
   */
  private static generateContextTags(
    pathSegments: string[],
    searchParams: Record<string, string>,
    dataSources: DataSource[],
    dashboardInfo: DashboardInfo | null
  ): string[] {
    const tags: string[] = [];
    
    // Extract primary entity and action
    const entity = this.extractEntity(pathSegments);
    const action = this.detectAction(pathSegments, searchParams);
    
    if (entity) {
      tags.push(`${entity}:${action}`);
    }

    // Add visualization type if detected
    const vizType = this.detectVisualizationType();
    if (vizType) {
      tags.push(`panel-type:${vizType}`);
    }

    // Add selected datasource if detected
    const selectedDatasource = this.detectSelectedDatasource();
    if (selectedDatasource) {
      tags.push(`selected-datasource:${selectedDatasource}`);
    }

    // Add specific context tags
    if (entity === 'dashboard' && dashboardInfo) {
      if (dashboardInfo.tags) {
        dashboardInfo.tags.forEach(tag => tags.push(`dashboard-tag:${tag}`));
      }
    }

    if (entity === 'datasource' && dataSources.length > 0) {
      dataSources.forEach(ds => tags.push(`datasource-type:${ds.type}`));
    }

    if (entity === 'explore') {
      tags.push('explore:query');
    }

    // UI context
    if (searchParams.tab) {tags.push('ui:tabbed');}
    if (searchParams.fullscreen) {tags.push('ui:fullscreen');}
    if (searchParams.kiosk) {tags.push('ui:kiosk');}

    return [...new Set(tags)];
  }

  /**
   * Extract entity from path segments
   */
  private static extractEntity(pathSegments: string[]): string | null {
    if (pathSegments.length === 0) {return null;}
    
    const entityMap: Record<string, string> = {
      'd': 'dashboard',
      'dashboard': 'dashboard',
      'datasources': 'datasource',
      'connections': 'datasource',
      'explore': 'explore',
      'alerting': 'alert',
      'admin': 'admin',
      'plugins': 'plugin',
      'a': 'app',
    };

    return entityMap[pathSegments[0]] || null;
  }

  /**
   * Detect action from path and search params
   */
  private static detectAction(pathSegments: string[], searchParams: Record<string, string>): string {
    if (searchParams.editPanel || searchParams.editview) {return 'edit';}
    if (pathSegments.includes('new')) {return 'create';}
    if (pathSegments.includes('edit')) {return 'edit';}
    if (pathSegments.includes('settings')) {return 'configure';}
    return 'view';
  }

  /**
   * Detect visualization type from viz picker button
   */
  static detectVisualizationType(): string | null {
    try {
      // Look for the viz picker button
      const vizPickerButton = document.querySelector('button[aria-label="Change visualization"]');
      if (vizPickerButton) {
        // Try to get the viz type from the text content
        const textContent = vizPickerButton.textContent?.trim();
        if (textContent) {
          return textContent.toLowerCase();
        }
        
        // Fallback: try to get from image src
        const img = vizPickerButton.querySelector('img');
        if (img?.src) {
          // Handle paths like: public/plugins/state-timeline/img/timeline.svg
          const match = img.src.match(/public\/plugins\/([^\/]+)\//);
          if (match) {
            return match[1];
          }
        }
      }

      return null;
    } catch (error) {
      console.warn('Error detecting visualization type:', error);
      return null;
    }
  }

  /**
   * Detect selected datasource from datasource picker
   */
  static detectSelectedDatasource(): string | null {
    try {
      // Look for the datasource picker input
      const datasourcePicker = document.querySelector('input[aria-label="Select a data source"]');
      if (datasourcePicker) {
        const input = datasourcePicker as HTMLInputElement;
        
        // Try to get from the value first
        if (input.value && input.value.trim()) {
          return input.value.trim();
        }
        
        // Fallback: try to get from placeholder (shows current selection)
        if (input.placeholder && input.placeholder.trim()) {
          return input.placeholder.trim();
        }
      }

      return null;
    } catch (error) {
      console.warn('Error detecting selected datasource:', error);
      return null;
    }
  }

  /**
   * Get Grafana version
   */
  private static getGrafanaVersion(): string {
    try {
      return config.bootData.settings.buildInfo.version || 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  /**
   * Filter useful recommendations
   */
  private static filterUsefulRecommendations(recommendations: Recommendation[]): Recommendation[] {
    return recommendations.filter(rec => {
      const url = rec.url;
      if (url === 'https://grafana.com/docs/learning-journeys' || 
          url === 'https://grafana.com/docs/learning-journeys/') {
        return false;
      }
      return true;
    });
  }

  /**
   * Sort recommendations by accuracy
   */
  private static sortRecommendationsByAccuracy(recommendations: Recommendation[]): Recommendation[] {
    return recommendations.sort((a, b) => {
      const typeA = a.type === 'learning-journey' || !a.type ? 0 : 1;
      const typeB = b.type === 'learning-journey' || !b.type ? 0 : 1;
      
      if (typeA !== typeB) {return typeA - typeB;}
      
      const accuracyA = a.matchAccuracy ?? 0;
      const accuracyB = b.matchAccuracy ?? 0;
      return accuracyB - accuracyA;
    });
  }

  /**
   * Get bundled interactive recommendations from index.json file
   * Filters based on current URL to show contextually relevant interactives
   */
  private static getBundledInteractiveRecommendations(contextData: ContextData): Recommendation[] {
    const bundledRecommendations: Recommendation[] = [];
    
    try {
      // Load the index.json file that contains metadata for all bundled interactives
      const indexData = require('../../bundled-interactives/index.json');
      
      if (indexData && indexData.interactives && Array.isArray(indexData.interactives)) {
        // Filter interactives that match the current URL/path
        const relevantInteractives = indexData.interactives.filter((interactive: any) => {
          // Check if the interactive's target URL matches current path
          return interactive.url === contextData.currentPath;
        });
        
        relevantInteractives.forEach((interactive: any) => {
          bundledRecommendations.push({
            title: interactive.title,
            url: `bundled:${interactive.id}`,
            type: 'docs-page',
            summary: interactive.summary,
            matchAccuracy: 0.8, // Higher accuracy since it's contextually relevant
          });
        });
      }
    } catch (error) {
      console.warn('Failed to load bundled interactives index.json:', error);
      // Fallback to empty array - no bundled interactives will be shown
    }
    
    return bundledRecommendations;
  }
} 
