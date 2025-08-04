import { getBackendSrv, config, locationService, getEchoSrv, EchoEventType } from '@grafana/runtime';
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
  RecommenderResponse,
  BundledInteractive,
  BundledInteractivesIndex
} from './context.types';

export class ContextService {
  private static echoLoggingInitialized = false;
  private static currentDatasourceType: string | null = null;
  private static currentVisualizationType: string | null = null;
  
  // Event buffer to handle missed events when plugin is closed/reopened
  private static eventBuffer: Array<{
    datasourceType?: string;
    visualizationType?: string;
    timestamp: number;
    source: string;
  }> = [];
  private static readonly BUFFER_SIZE = 10;
  private static readonly BUFFER_TTL = 300000; // 5 minutes
  
  // Simple event system for context changes
  private static changeListeners: Set<() => void> = new Set();

  /**
   * Subscribe to context changes (for hooks to refresh when EchoSrv events occur)
   */
  public static onContextChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /**
   * Notify all listeners that context has changed
   */
  private static notifyContextChange(): void {
    this.changeListeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.error('@context/ Error in context change listener:', error);
      }
    });
  }

  /**
   * Add event to buffer for handling missed events when plugin is closed/reopened
   */
  private static addToEventBuffer(event: {
    datasourceType?: string;
    visualizationType?: string;
    timestamp: number;
    source: string;
  }): void {
    // Clean expired events
    const now = Date.now();
    this.eventBuffer = this.eventBuffer.filter(e => now - e.timestamp < this.BUFFER_TTL);
    
    // Add new event
    this.eventBuffer.push(event);
    
    // Keep buffer size manageable
    if (this.eventBuffer.length > this.BUFFER_SIZE) {
      this.eventBuffer = this.eventBuffer.slice(-this.BUFFER_SIZE);
    }
    
    // Notify listeners of context change
    this.notifyContextChange();
  }

  /**
   * Initialize context from recent events (called when plugin reopens)
   */
  public static initializeFromRecentEvents(): void {
    const now = Date.now();
    
    // Find most recent datasource and visualization events
    const recentDatasourceEvent = this.eventBuffer
      .filter(e => e.datasourceType && now - e.timestamp < this.BUFFER_TTL)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
      
    const recentVizEvent = this.eventBuffer
      .filter(e => e.visualizationType && now - e.timestamp < this.BUFFER_TTL)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    
    if (recentDatasourceEvent) {
      this.currentDatasourceType = recentDatasourceEvent.datasourceType!;
    }
    
    if (recentVizEvent) {
      this.currentVisualizationType = recentVizEvent.visualizationType!;
    }
  }

  /**
   * Initialize EchoSrv event logging (Phase 1: Understanding what events we get)
   * Now designed to be called at plugin startup
   */
  public static initializeEchoLogging(): void {
    if (this.echoLoggingInitialized) {
      return;
    }

    try {
      const echoSrv = getEchoSrv();
      
      // Add our logging backend
      echoSrv.addBackend({
        supportedEvents: [EchoEventType.Interaction, EchoEventType.Pageview, EchoEventType.MetaAnalytics],
        options: { name: 'context-service-logger' },
        flush: () => {
          // No-op for logging backend
        },
        addEvent: (event) => {
          // Phase 2: Capture datasource configuration events
          if (event.type === 'interaction') {
            // Primary: New datasource selection
            if (event.payload?.interactionName === 'grafana_ds_add_datasource_clicked') {
              const pluginId = event.payload?.properties?.plugin_id;
              if (pluginId) {
                this.currentDatasourceType = pluginId;
                this.addToEventBuffer({ datasourceType: pluginId, timestamp: Date.now(), source: 'add' });
              }
            }
            
            // Workaround: Existing datasource edit detection via "Save & Test"
            // TODO: Find a better event for datasource edit page loads instead of relying on Save & Test
            // This approach only works after user clicks Save & Test, not on initial page load
            if (event.payload?.interactionName === 'grafana_ds_test_datasource_clicked') {
              const pluginId = event.payload?.properties?.plugin_id;
              if (pluginId) {
                this.currentDatasourceType = pluginId;
                this.addToEventBuffer({ datasourceType: pluginId, timestamp: Date.now(), source: 'test' });
              }
            }
            
            // Phase 3: Dashboard datasource picker - when user selects datasource for querying
            if (event.payload?.interactionName === 'dashboards_dspicker_clicked') {
              const dsType = event.payload?.properties?.ds_type;
              if (dsType) {
                this.currentDatasourceType = dsType;
                this.addToEventBuffer({ datasourceType: dsType, timestamp: Date.now(), source: 'dashboard-picker' });
              }
            }
            
            // Phase 4: Dashboard panel/visualization type picker
            if (event.payload?.interactionName === 'dashboards_panel_plugin_picker_clicked') {
              const pluginId = event.payload?.properties?.plugin_id;
              if (pluginId && event.payload?.properties?.item === 'select_panel_plugin') {
                this.currentVisualizationType = pluginId;
                this.addToEventBuffer({ visualizationType: pluginId, timestamp: Date.now(), source: 'panel-picker' });
              }
            }
          }
          
          // Phase 3: Explore query execution - detect active datasource usage
          if (event.type === 'meta-analytics' && event.payload?.eventName === 'data-request') {
            const datasourceType = event.payload?.datasourceType;
            const source = event.payload?.source;
            if (datasourceType && source) {
              this.currentDatasourceType = datasourceType;
              this.addToEventBuffer({ datasourceType, timestamp: Date.now(), source: `${source}-query` });
            }
          }
        }
      });

      this.echoLoggingInitialized = true;
      
    } catch (error) {
      console.error('@context/ Failed to initialize EchoSrv logging:', error);
    }
  }

  /**
   * Main method to get all context data
   */
  static async getContextData(): Promise<ContextData> {
    // Ensure EchoSrv is initialized (fallback if onPluginStart wasn't called)
    this.initializeEchoLogging();
    
    // Initialize from recent events if plugin was reopened
    if (!this.currentDatasourceType && !this.currentVisualizationType) {
      this.initializeFromRecentEvents();
    }
    const location = locationService.getLocation();
    const currentPath = location.pathname;
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    const pathSegments = currentPath.split('/').filter(Boolean);
    
    // Parse search parameters using LocationService
    const urlQueryMap = locationService.getSearchObject();
    const searchParams: Record<string, string> = {};
    Object.entries(urlQueryMap).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams[key] = String(value);
      }
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
      visualizationType: this.getDetectedVisualizationType(),
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
        datasources: contextData.dataSources.map(ds => ds.type.toLowerCase()),
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

    // Add visualization type from EchoSrv events (Phase 4: Echo-based detection)
    const echoDetectedVizType = this.getDetectedVisualizationType();
    if (echoDetectedVizType) {
      tags.push(`panel-type:${echoDetectedVizType}`);
    }

    // Add selected datasource from EchoSrv events (Phase 2: Echo-based detection)  
    const echoDetectedDatasource = this.getDetectedDatasourceType();
    if (echoDetectedDatasource) {
      tags.push(`selected-datasource:${echoDetectedDatasource}`);
    }

    // Add specific context tags
    if (entity === 'dashboard' && dashboardInfo) {
      if (dashboardInfo.tags) {
        dashboardInfo.tags.forEach(tag => tags.push(`dashboard-tag:${tag.toLowerCase().replace(/\s+/g, '_')}`));
      }
    }

    // Handle connection-related pages
    if (entity === 'connection') {
      if (pathSegments[1] === 'add-new-connection' && pathSegments[2]) {
        // Extract connection type from URL: /connections/add-new-connection/clickhouse
        const connectionType = pathSegments[2].toLowerCase();
        tags.push(`connection-type:${connectionType}`);
      } else if (pathSegments[1] === 'datasources' && pathSegments[2]) {
        // Handle /connections/datasources/grafana-clickhouse-datasource/ 
        // This is actually a datasource within connections UI
        const datasourceName = pathSegments[2].toLowerCase();
        // Try to find the actual datasource to get its type
        const selectedDs = dataSources.find(ds => 
          ds.name.toLowerCase().includes(datasourceName) ||
          datasourceName.includes(ds.type.toLowerCase())
        );
        if (selectedDs) {
          tags.push(`datasource-type:${selectedDs.type.toLowerCase()}`);
        } else {
          // Fallback: use the name from URL
          tags.push(`datasource-type:${datasourceName}`);
        }
      }
    }

    // Handle direct datasource pages using EchoSrv detection (Phase 2: Simplified approach)
    if (entity === 'datasource') {
      // Use EchoSrv-detected datasource type first
      if (echoDetectedDatasource) {
        tags.push(`datasource-type:${echoDetectedDatasource.toLowerCase()}`);
      } else if (pathSegments[1] === 'edit' && searchParams.id) {
        // Fallback to API lookup only for existing datasource edit pages
        const selectedDs = dataSources.find(ds => String(ds.id) === String(searchParams.id));
        if (selectedDs) {
          tags.push(`datasource-type:${selectedDs.type.toLowerCase()}`);
        }
      }
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
    
    // Special case: /connections/datasources/edit/ is actually a datasource operation
    if (pathSegments[0] === 'connections' && 
        pathSegments[1] === 'datasources' && 
        pathSegments[2] === 'edit') {
      return 'datasource';
    }
    
    const entityMap: Record<string, string> = {
      'd': 'dashboard',
      'dashboard': 'dashboard',
      'datasources': 'datasource',
      'connections': 'connection',
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
   * Get datasource type detected from EchoSrv events (Phase 2 & 3: Echo-based detection)
   * 
   * Supported event sources:
   * - grafana_ds_add_datasource_clicked: New datasource configuration
   * - grafana_ds_test_datasource_clicked: Existing datasource configuration (workaround)
   * - dashboards_dspicker_clicked: Dashboard datasource selection for querying
   * - data-request (meta-analytics): Active query execution in explore/dashboard
   * 
   * TODO: Potential improvements for datasource edit detection:
   * - Listen for pageview events to detect edit page loads
   * - Add fallback to API lookup on edit pages using datasource_uid from URL
   * - Consider listening for additional interaction events that fire earlier
   */
  static getDetectedDatasourceType(): string | null {
    return this.currentDatasourceType;
  }

  /**
   * Get visualization type detected from EchoSrv events (Phase 4: Echo-based detection)
   * 
   * Supported event sources:
   * - dashboards_panel_plugin_picker_clicked: Panel/visualization type selection in dashboards
   */
  static getDetectedVisualizationType(): string | null {
    return this.currentVisualizationType;
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
      const indexData: BundledInteractivesIndex = require('../../bundled-interactives/index.json');
      
      if (indexData && indexData.interactives && Array.isArray(indexData.interactives)) {
        // Filter interactives that match the current URL/path
        const relevantInteractives = indexData.interactives.filter((interactive: BundledInteractive) => {
          // Handle both single URL (string) and multiple URLs (array)
          if (Array.isArray(interactive.url)) {
            // Check if any URL in the array matches current path
            return interactive.url.some((url: string) => url === contextData.currentPath);
          } else if (typeof interactive.url === 'string') {
            // Backward compatibility: single URL as string
            return interactive.url === contextData.currentPath;
          }
          return false;
        });
        
        relevantInteractives.forEach((interactive: BundledInteractive) => {
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
