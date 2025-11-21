import { getBackendSrv, config, locationService, getEchoSrv, EchoEventType } from '@grafana/runtime';
import {
  getConfigWithDefaults,
  isRecommenderEnabled,
  DocsPluginConfig,
  DEFAULT_RECOMMENDER_TIMEOUT,
  ALLOWED_RECOMMENDER_DOMAINS,
} from '../constants';
import { fetchContent, getJourneyCompletionPercentage } from '../docs-retrieval';
import { hashUserData } from '../lib/hash.util';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { sanitizeTextForDisplay, parseUrlSafely, sanitizeForLogging } from '../security';
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
  BundledInteractivesIndex,
} from '../types/context.types';

export class ContextService {
  private static echoLoggingInitialized = false;
  private static currentDatasourceType: string | null = null;
  private static currentVisualizationType: string | null = null;

  // Error handling state
  private static lastExternalRecommenderError: {
    type: 'unavailable' | 'rate-limit' | 'other';
    timestamp: number;
    message: string;
  } | null = null;

  // Constants for recommendation accuracy scores
  private static readonly CONFIDENCE_THRESHOLD = 0.5;
  private static readonly STATIC_LINK_ACCURACY = 0.7;
  private static readonly BUNDLED_INTERACTIVE_ACCURACY = 0.8;

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

  // Debouncing removed from service level - now handled at hook level for unified control

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
   * Notify all listeners that context has changed (immediate notification - debouncing handled at hook level)
   */
  private static notifyContextChange(): void {
    this.changeListeners.forEach((listener) => {
      try {
        listener();
      } catch (error) {
        console.error('Error in context change listener:', error);
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
    this.eventBuffer = this.eventBuffer.filter((e) => now - e.timestamp < this.BUFFER_TTL);

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
      .filter((e) => e.datasourceType && now - e.timestamp < this.BUFFER_TTL)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    const recentVizEvent = this.eventBuffer
      .filter((e) => e.visualizationType && now - e.timestamp < this.BUFFER_TTL)
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
        },
      });

      this.echoLoggingInitialized = true;
    } catch (error) {
      console.error('Failed to initialize EchoSrv logging:', error);
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
      this.fetchDashboardInfo(currentPath),
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
      featuredRecommendations: [], // Will be populated by fetchRecommendations
      tags,
      isLoading: false,
      recommendationsError: null,
      recommendationsErrorType: null,
      usingFallbackRecommendations: false,
      visualizationType: this.getVisualizationTypeForContext(pathSegments, searchParams),
      grafanaVersion: this.getGrafanaVersion(),
      theme: config.theme2.isDark ? 'dark' : 'light',
      timestamp: new Date().toISOString(),
      searchParams,
    };
  }

  /**
   * Fetch recommendations based on context
   */
  static async fetchRecommendations(
    contextData: ContextData,
    pluginConfig: DocsPluginConfig = {}
  ): Promise<{
    recommendations: Recommendation[];
    featuredRecommendations: Recommendation[];
    error: string | null;
    errorType: 'unavailable' | 'rate-limit' | 'other' | null;
    usingFallbackRecommendations: boolean;
  }> {
    try {
      if (!contextData.currentPath) {
        return {
          recommendations: [],
          featuredRecommendations: [],
          error: 'No path provided for recommendations',
          errorType: 'other',
          usingFallbackRecommendations: false,
        };
      }

      const bundledRecommendations = this.getBundledInteractiveRecommendations(contextData, pluginConfig);
      if (!isRecommenderEnabled(pluginConfig)) {
        const fallbackResult = await this.getFallbackRecommendations(contextData, bundledRecommendations);
        return {
          ...fallbackResult,
          featuredRecommendations: [],
          errorType: null,
          usingFallbackRecommendations: false, // Not using fallback due to error, just disabled
        };
      }

      // Always try external recommendations when T&C are enabled, regardless of previous errors
      return this.getExternalRecommendations(contextData, pluginConfig, bundledRecommendations);
    } catch (error) {
      console.warn('Failed to fetch recommendations:', error);
      const bundledRecommendations = this.getBundledInteractiveRecommendations(contextData, pluginConfig);
      const fallbackResult = await this.getFallbackRecommendations(contextData, bundledRecommendations);
      return {
        ...fallbackResult,
        featuredRecommendations: [],
        error: error instanceof Error ? error.message : 'Failed to fetch recommendations',
        errorType: 'other',
        usingFallbackRecommendations: true,
      };
    }
  }

  /**
   * Get fallback recommendations when external recommender is disabled
   */
  private static async getFallbackRecommendations(
    contextData: ContextData,
    bundledRecommendations: Recommendation[]
  ): Promise<{ recommendations: Recommendation[]; error: string | null }> {
    const staticLinkRecommendations = this.getStaticLinkRecommendations(contextData);
    const allRecommendations = [...bundledRecommendations, ...staticLinkRecommendations];
    const processedRecommendations = await this.processLearningJourneys(allRecommendations, {});

    return {
      recommendations: processedRecommendations,
      error: null,
    };
  }

  /**
   * SECURITY: Validate recommender service URL
   * Ensures the URL is HTTPS and from an approved domain to prevent MITM attacks
   * In dev mode: Allows HTTP and bypasses domain allowlist for local testing
   */
  private static validateRecommenderUrl(url: string): boolean {
    const parsedUrl = parseUrlSafely(url);

    if (!parsedUrl) {
      console.error('Invalid recommender service URL');
      return false;
    }

    // Dev mode: Allow any HTTP/HTTPS URL for local testing
    if (isDevModeEnabledGlobal()) {
      console.log('Dev mode enabled: Allowing recommender URL', url);
      return true;
    }

    // Production: Require HTTPS
    if (parsedUrl.protocol !== 'https:') {
      console.error('Recommender service URL must use HTTPS (dev mode disabled)');
      return false;
    }

    // Production: Check if domain is in allowlist (exact match only, no subdomains)
    const isAllowedDomain = ALLOWED_RECOMMENDER_DOMAINS.some((domain) => {
      return parsedUrl.hostname === domain;
    });

    if (!isAllowedDomain) {
      console.error('Recommender service domain not in allowlist');
      return false;
    }

    return true;
  }

  /**
   * Get recommendations from external API service
   */
  private static async getExternalRecommendations(
    contextData: ContextData,
    pluginConfig: DocsPluginConfig,
    bundledRecommendations: Recommendation[]
  ): Promise<{
    recommendations: Recommendation[];
    featuredRecommendations: Recommendation[];
    error: string | null;
    errorType: 'unavailable' | 'rate-limit' | 'other' | null;
    usingFallbackRecommendations: boolean;
  }> {
    try {
      const configWithDefaults = getConfigWithDefaults(pluginConfig);

      // SECURITY: Validate recommender service URL before making request
      if (!this.validateRecommenderUrl(configWithDefaults.recommenderServiceUrl)) {
        return this.handleRecommenderError(
          'other',
          'Recommender service URL failed security validation',
          contextData,
          bundledRecommendations
        );
      }

      const isCloud = config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud');

      // Extract and hash source hostname for privacy
      // OSS play.grafana.org is left unhashed (public demo site)
      const getHashedSource = async (): Promise<string | undefined> => {
        try {
          const hostname = window.location.hostname;

          // OSS users on Grafana Play - public demo site, no need to hash
          if (!isCloud && hostname === 'play.grafana.org') {
            return 'play.grafana.org';
          }

          // OSS users on other hostnames - use generic identifier
          if (!isCloud) {
            return 'oss-source';
          }

          return hostname;
        } catch (error) {
          console.warn('Failed to extract/hash source:', error);
          return undefined;
        }
      };

      const hashedSource = await getHashedSource();

      // Get user data for hashing
      const userId = isCloud ? config.bootData.user.analytics.identifier || 'unknown' : 'oss-user';
      const userEmail = isCloud
        ? config.bootData.user.email || 'unknown@example.com' // Cloud users: use real email or unknown for anonymous
        : 'oss-user@example.com'; // OSS users: always use generic OSS email

      // Hash sensitive user data
      const { hashedUserId, hashedEmail } = await hashUserData(userId, userEmail);

      const payload: ContextPayload = {
        path: contextData.currentPath,
        datasources: [...new Set(contextData.dataSources.map((ds) => ds.type.toLowerCase()))],
        tags: contextData.tags,
        user_id: hashedUserId,
        user_email: hashedEmail,
        user_role: config.bootData.user.orgRole || 'Viewer',
        platform: this.getCurrentPlatform(),
        source: hashedSource,
        language: this.getCurrentLanguage(),
      };

      // Add timeout to prevent hanging in air-gapped or slow connection scenarios
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_RECOMMENDER_TIMEOUT);

      try {
        const response = await fetch(`${configWithDefaults.recommenderServiceUrl}/recommend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Handle specific HTTP error codes
          if (response.status === 404) {
            return this.handleRecommenderError(
              'unavailable',
              'Recommender service not found',
              contextData,
              bundledRecommendations
            );
          }

          if (response.status === 429) {
            return this.handleRecommenderError(
              'rate-limit',
              'Recommender service is under strain',
              contextData,
              bundledRecommendations
            );
          }

          // Handle other HTTP errors
          return this.handleRecommenderError(
            'other',
            `HTTP error! status: ${response.status}`,
            contextData,
            bundledRecommendations
          );
        }

        const data: RecommenderResponse = await response.json();

        // DEBUG: Log the raw API response to see what we received
        console.log('[Featured Debug] Raw API response:', {
          recommendations: data.recommendations?.length || 0,
          featured: data.featured?.length || 0,
          featuredData: data.featured,
        });

        // SECURITY: Sanitize external API recommendations to prevent XSS and prototype pollution
        // Use explicit allowlist instead of spread operator to prevent malicious properties
        const sanitizeRecommendation = (rec: any): Recommendation => ({
          title: sanitizeTextForDisplay(rec.title || ''),
          url: typeof rec.url === 'string' ? rec.url : '', // Validated when opened
          summary: sanitizeTextForDisplay(rec.summary || rec.description || ''),
          type: rec.type === 'docs-page' || rec.type === 'learning-journey' ? rec.type : 'docs-page',
          matchAccuracy: typeof rec.matchAccuracy === 'number' ? rec.matchAccuracy : 0.5,
          // Explicitly DO NOT spread ...rec to prevent prototype pollution attacks
          // Properties like __proto__, constructor, onClick, dangerouslySetInnerHTML are blocked
        });

        const mappedExternalRecommendations = (data.recommendations || []).map(sanitizeRecommendation);

        // SECURITY: Sanitize featured recommendations using same logic
        const mappedFeaturedRecommendations = (data.featured || []).map(sanitizeRecommendation);

        // DEBUG: Log sanitized featured recommendations
        console.log('[Featured Debug] Sanitized featured recommendations:', mappedFeaturedRecommendations);

        const allRecommendations = [...mappedExternalRecommendations, ...bundledRecommendations];
        const processedRecommendations = await this.processLearningJourneys(allRecommendations, pluginConfig);

        // Process featured recommendations separately
        const processedFeaturedRecommendations = await this.processLearningJourneys(
          mappedFeaturedRecommendations,
          pluginConfig
        );

        // Filter and sort recommendations
        const filteredRecommendations = this.filterUsefulRecommendations(processedRecommendations);
        const sortedRecommendations = this.sortRecommendationsByAccuracy(filteredRecommendations);

        // Featured recommendations are curated by the server, so don't filter by confidence
        // Just keep the server order and all items
        const filteredFeaturedRecommendations = processedFeaturedRecommendations;

        // DEBUG: Log final featured recommendations being returned
        console.log('[Featured Debug] Final featured recommendations being returned:', {
          count: filteredFeaturedRecommendations.length,
          titles: filteredFeaturedRecommendations.map((r) => r.title),
        });

        // Clear any previous errors on successful call
        this.lastExternalRecommenderError = null;

        return {
          recommendations: sortedRecommendations,
          featuredRecommendations: filteredFeaturedRecommendations,
          error: null,
          errorType: null,
          usingFallbackRecommendations: false,
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);

        // Handle AbortError (timeout)
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          return this.handleRecommenderError(
            'unavailable',
            'Recommender service timeout',
            contextData,
            bundledRecommendations
          );
        }

        // Handle network errors (CORS, network failures, etc.)
        const errorMessage = fetchError instanceof Error ? fetchError.message : 'Unknown error';

        // Check if it's a CORS or network error
        if (
          errorMessage.includes('CORS') ||
          errorMessage.includes('NetworkError') ||
          errorMessage.includes('Failed to fetch')
        ) {
          return this.handleRecommenderError(
            'unavailable',
            'Recommender service unavailable',
            contextData,
            bundledRecommendations
          );
        }

        // Handle other errors
        return this.handleRecommenderError('other', errorMessage, contextData, bundledRecommendations);
      }
    } catch (error) {
      // Handle outer errors (hashing, payload construction, etc.)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.handleRecommenderError('other', errorMessage, contextData, bundledRecommendations);
    }
  }

  /**
   * Handle recommender service errors by falling back to static recommendations
   */
  private static async handleRecommenderError(
    errorType: 'unavailable' | 'rate-limit' | 'other',
    errorMessage: string,
    contextData: ContextData,
    bundledRecommendations: Recommendation[]
  ): Promise<{
    recommendations: Recommendation[];
    featuredRecommendations: Recommendation[];
    error: string | null;
    errorType: 'unavailable' | 'rate-limit' | 'other' | null;
    usingFallbackRecommendations: boolean;
  }> {
    // Store error state for tracking
    this.lastExternalRecommenderError = {
      type: errorType,
      timestamp: Date.now(),
      message: errorMessage,
    };

    // Get fallback recommendations
    const fallbackResult = await this.getFallbackRecommendations(contextData, bundledRecommendations);

    // Generate user-friendly error message
    const userMessage = this.generateErrorMessage(errorType);

    return {
      ...fallbackResult,
      featuredRecommendations: [],
      error: userMessage,
      errorType,
      usingFallbackRecommendations: true,
    };
  }

  /**
   * Generate user-friendly error messages based on error type
   */
  private static generateErrorMessage(errorType: 'unavailable' | 'rate-limit' | 'other'): string {
    switch (errorType) {
      case 'unavailable':
        return 'Recommender unavailable. Showing static recommendations.';
      case 'rate-limit':
        return 'Recommender is under a lot of strain. Switching to static recommendations.';
      case 'other':
      default:
        return 'Recommender service error. Using static recommendations.';
    }
  }

  /**
   * Get the last external recommender error for debugging or status display
   */
  public static getLastRecommenderError(): {
    type: 'unavailable' | 'rate-limit' | 'other';
    timestamp: number;
    message: string;
  } | null {
    return this.lastExternalRecommenderError;
  }

  /**
   * Process learning journey recommendations to add metadata
   */
  private static async processLearningJourneys(
    recommendations: Recommendation[],
    pluginConfig?: DocsPluginConfig
  ): Promise<Recommendation[]> {
    return Promise.all(
      recommendations.map(async (rec) => {
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
            console.warn(`Failed to fetch journey data for ${sanitizeForLogging(rec.title)}:`, error);
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
  }

  /**
   * Get current platform (cloud vs oss)
   */
  private static getCurrentPlatform(): string {
    return config.bootData.settings.buildInfo.versionString.startsWith('Grafana Cloud') ? 'cloud' : 'oss';
  }

  /**
   * Get current language/locale
   * Returns user's regional format preference (e.g., 'en-US', 'es-ES', 'fr-FR')
   * This is used for locale-specific features like date formatting
   */
  private static getCurrentLanguage(): string {
    try {
      const language = config.bootData.user.language;
      return language;
    } catch (error) {
      console.warn('Failed to get current language:', error);
      return 'en-US';
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
        query: name,
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
    // Only include viz type when user is creating or editing visualizations
    const isCreatingOrEditingViz = this.isCreatingOrEditingVisualization(pathSegments, searchParams);
    if (isCreatingOrEditingViz) {
      const echoDetectedVizType = this.getDetectedVisualizationType();
      const vizType = echoDetectedVizType || 'timeseries'; // Default to timeseries if no event detected
      tags.push(`panel-type:${vizType}`);
    }

    // Add selected datasource from EchoSrv events (Phase 2: Echo-based detection)
    const echoDetectedDatasource = this.getDetectedDatasourceType();
    if (echoDetectedDatasource) {
      tags.push(`selected-datasource:${echoDetectedDatasource}`);
    }

    // Add specific context tags
    if (entity === 'dashboard' && dashboardInfo) {
      if (dashboardInfo.tags) {
        dashboardInfo.tags.forEach((tag) => tags.push(`dashboard-tag:${tag.toLowerCase().replace(/\s+/g, '_')}`));
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
        const selectedDs = dataSources.find(
          (ds) => ds.name.toLowerCase().includes(datasourceName) || datasourceName.includes(ds.type.toLowerCase())
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
        const selectedDs = dataSources.find((ds) => String(ds.id) === String(searchParams.id));
        if (selectedDs) {
          tags.push(`datasource-type:${selectedDs.type.toLowerCase()}`);
        }
      }
    }

    if (entity === 'explore') {
      tags.push('explore:query');
    }

    // UI context
    if (searchParams.tab) {
      tags.push('ui:tabbed');
    }
    if (searchParams.fullscreen) {
      tags.push('ui:fullscreen');
    }
    if (searchParams.kiosk) {
      tags.push('ui:kiosk');
    }

    return [...new Set(tags)];
  }

  /**
   * Extract entity from path segments
   */
  private static extractEntity(pathSegments: string[]): string | null {
    if (pathSegments.length === 0) {
      return null;
    }

    // Special case: /connections/datasources/edit/ is actually a datasource operation
    if (pathSegments[0] === 'connections' && pathSegments[1] === 'datasources' && pathSegments[2] === 'edit') {
      return 'datasource';
    }

    const entityMap: Record<string, string> = {
      d: 'dashboard',
      dashboard: 'dashboard',
      datasources: 'datasource',
      connections: 'connection',
      explore: 'explore',
      alerting: 'alert',
      admin: 'admin',
      plugins: 'plugin',
      a: 'app',
    };

    return entityMap[pathSegments[0]] || null;
  }

  /**
   * Detect action from path and search params
   */
  private static detectAction(pathSegments: string[], searchParams: Record<string, string>): string {
    if (searchParams.editPanel || searchParams.editview) {
      return 'edit';
    }
    if (pathSegments.includes('new')) {
      return 'create';
    }
    if (pathSegments.includes('edit')) {
      return 'edit';
    }
    if (pathSegments.includes('settings')) {
      return 'configure';
    }
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
   * Get visualization type for current context
   * Only returns viz type when creating/editing, defaults to 'timeseries' if no event detected
   */
  private static getVisualizationTypeForContext(
    pathSegments: string[],
    searchParams: Record<string, string>
  ): string | null {
    const isCreatingOrEditingViz = this.isCreatingOrEditingVisualization(pathSegments, searchParams);
    if (isCreatingOrEditingViz) {
      const echoDetectedVizType = this.getDetectedVisualizationType();
      return echoDetectedVizType || 'timeseries'; // Default to timeseries if no event detected
    }

    // Return null when not in create/edit context
    return null;
  }

  /**
   * Determine if user is currently creating or editing a visualization
   * Based on URL patterns and search parameters
   */
  private static isCreatingOrEditingVisualization(
    pathSegments: string[],
    searchParams: Record<string, string>
  ): boolean {
    // Editing existing panel
    if (searchParams.editPanel) {
      return true;
    }

    // Creating first panel on new dashboard
    if (searchParams.firstPanel) {
      return true;
    }

    // New dashboard creation
    if (pathSegments.includes('new') && pathSegments.includes('dashboard')) {
      return true;
    }

    // Dashboard new path
    if (pathSegments[0] === 'dashboard' && pathSegments[1] === 'new') {
      return true;
    }

    // Panel edit view
    if (searchParams.editview === 'panel') {
      return true;
    }

    return false;
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
   * Drops recommendations with confidence <= 0.5
   */
  private static filterUsefulRecommendations(recommendations: Recommendation[]): Recommendation[] {
    return recommendations.filter((rec) => {
      const url = rec.url;

      // Filter out generic learning journeys index pages
      if (
        url === 'https://grafana.com/docs/learning-journeys' ||
        url === 'https://grafana.com/docs/learning-journeys/'
      ) {
        return false;
      }

      // Drop recommendations with low confidence
      const confidence = rec.matchAccuracy ?? 0;
      if (confidence <= this.CONFIDENCE_THRESHOLD) {
        return false;
      }

      return true;
    });
  }

  /**
   * Sort recommendations by accuracy only
   * No longer prioritizes learning journeys over docs - all sorted by confidence descending
   */
  private static sortRecommendationsByAccuracy(recommendations: Recommendation[]): Recommendation[] {
    return recommendations.sort((a, b) => {
      const accuracyA = a.matchAccuracy ?? 0;
      const accuracyB = b.matchAccuracy ?? 0;
      return accuracyB - accuracyA;
    });
  }

  /**
   * Get static link recommendations from static-links/*.json files
   * Only used when recommender is disabled - provides fallback recommendations
   * Uses simple URL prefix matching only (no complex tag logic)
   */
  private static getStaticLinkRecommendations(contextData: ContextData): Recommendation[] {
    const staticRecommendations: Recommendation[] = [];

    try {
      const currentPlatform = this.getCurrentPlatform();

      // Dynamically load all JSON files from static-links directory
      const staticLinksContext = (require as any).context('../bundled-interactives/static-links', false, /\.json$/);
      const allFilePaths = staticLinksContext.keys();

      // Deduplicate files by filename to handle webpack context finding same files with different paths
      const uniqueFilePaths = this.deduplicateFilePaths(allFilePaths);

      // Load each unique static links file
      for (const filePath of uniqueFilePaths) {
        const filename = filePath.replace('./', ''); // Convert ./explore-oss.json to explore-oss.json
        try {
          const staticData = staticLinksContext(filePath);

          if (staticData && staticData.rules && Array.isArray(staticData.rules)) {
            const relevantLinks = staticData.rules.filter((rule: any) => {
              // Skip entries with tag properties (only want top-level navigation)
              if (this.containsTagInMatch(rule.match)) {
                return false;
              }

              // Check platform match
              if (!this.matchesPlatform(rule.match, currentPlatform)) {
                return false;
              }

              // Check URL prefix match (handle both formats)
              return this.matchesUrlPrefix(rule.match, contextData.currentPath);
            });

            // Convert to recommendation format
            relevantLinks.forEach((rule: any) => {
              staticRecommendations.push({
                title: rule.title,
                url: rule.url,
                type: rule.type || 'docs-page',
                summary: rule.description || '',
                matchAccuracy: this.STATIC_LINK_ACCURACY,
              });
            });
          }
        } catch (error) {
          console.warn(`Failed to load static links file ${filename}:`, error);
        }
      }
    } catch (error) {
      console.warn('Failed to load static link recommendations:', error);
    }

    return staticRecommendations;
  }

  /**
   * Check if match condition contains any tag properties
   */
  private static containsTagInMatch(match: any): boolean {
    if (!match) {
      return false;
    }

    // Check for direct tag property
    if (match.tag) {
      return true;
    }

    // Recursively check AND conditions
    if (match.and && Array.isArray(match.and)) {
      return match.and.some((condition: any) => this.containsTagInMatch(condition));
    }

    // Recursively check OR conditions
    if (match.or && Array.isArray(match.or)) {
      return match.or.some((condition: any) => this.containsTagInMatch(condition));
    }

    return false;
  }

  /**
   * Check if match condition matches current platform
   */
  private static matchesPlatform(match: any, currentPlatform: string): boolean {
    if (!match) {
      return false;
    }

    // Check for direct targetPlatform property
    if (match.targetPlatform) {
      return match.targetPlatform === currentPlatform;
    }

    // Check AND conditions - all must match
    if (match.and && Array.isArray(match.and)) {
      return match.and.every((condition: any) => this.matchesPlatform(condition, currentPlatform));
    }

    // Check OR conditions - at least one must match
    if (match.or && Array.isArray(match.or)) {
      return match.or.some((condition: any) => this.matchesPlatform(condition, currentPlatform));
    }

    // If no platform-related properties, assume it matches (no platform constraint)
    return true;
  }

  /**
   * Check if match condition matches current URL path
   * Handles both urlPrefix and urlPrefixIn formats
   */
  private static matchesUrlPrefix(match: any, currentPath: string): boolean {
    if (!match) {
      return false;
    }

    // Check for direct urlPrefix property
    if (match.urlPrefix) {
      return currentPath.startsWith(match.urlPrefix);
    }

    // Check for urlPrefixIn array property
    if (match.urlPrefixIn && Array.isArray(match.urlPrefixIn)) {
      return match.urlPrefixIn.some((prefix: string) => currentPath.startsWith(prefix));
    }

    // Check AND conditions - all must match
    if (match.and && Array.isArray(match.and)) {
      return match.and.every((condition: any) => this.matchesUrlPrefix(condition, currentPath));
    }

    // Check OR conditions - at least one must match
    if (match.or && Array.isArray(match.or)) {
      return match.or.some((condition: any) => this.matchesUrlPrefix(condition, currentPath));
    }

    // If no URL-related properties, assume it matches (no URL constraint)
    return true;
  }

  /**
   * Get bundled interactive recommendations from index.json file
   * Filters based on current URL to show contextually relevant interactives
   */
  private static getBundledInteractiveRecommendations(
    contextData: ContextData,
    pluginConfig: DocsPluginConfig
  ): Recommendation[] {
    const bundledRecommendations: Recommendation[] = [];

    // Dev mode - add extra recommendations for debugging
    if (isDevModeEnabledGlobal()) {
      bundledRecommendations.push({
        title: 'Components',
        url: 'https://grafana.com/components/',
        type: 'docs-page',
        summary: 'Components page',
      });
    }

    try {
      // Load the index.json file that contains metadata for all bundled interactives
      const indexData: BundledInteractivesIndex = require('../bundled-interactives/index.json');

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
            matchAccuracy: this.BUNDLED_INTERACTIVE_ACCURACY,
          });
        });
      }
    } catch (error) {
      console.warn('Failed to load bundled interactives index.json:', error);
      // Fallback to empty array - no bundled interactives will be shown
    }

    return bundledRecommendations;
  }

  /**
   * Deduplicate file paths by filename to handle webpack finding same files with different paths
   */
  private static deduplicateFilePaths(filePaths: string[]): string[] {
    return filePaths.filter((filePath: string, index: number, arr: string[]) => {
      const filename = filePath.split('/').pop() || filePath;
      return (
        arr.findIndex((fp: string) => {
          const compareFilename = fp.split('/').pop() || fp;
          return compareFilename === filename;
        }) === index
      );
    });
  }
}
