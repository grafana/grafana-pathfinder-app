import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { locationService } from '@grafana/runtime';
import { usePluginContext } from '@grafana/data';
import { ContextService } from './context.service';
import { ContextData, UseContextPanelOptions, UseContextPanelReturn } from '../types/context.types';
import { useTimeoutManager } from '../utils/timeout-manager';

export function useContextPanel(options: UseContextPanelOptions = {}): UseContextPanelReturn {
  const { onOpenLearningJourney, onOpenDocsPage } = options;

  // Get plugin configuration with stable reference
  const pluginContext = usePluginContext();
  const pluginConfig = useMemo(() => {
    return pluginContext?.meta?.jsonData || {};
  }, [pluginContext?.meta?.jsonData]);

  // State
  const [contextData, setContextData] = useState<ContextData>({
    currentPath: '',
    currentUrl: '',
    pathSegments: [],
    dataSources: [],
    dashboardInfo: null,
    recommendations: [],
    featuredRecommendations: [],
    tags: [],
    isLoading: true,
    recommendationsError: null,
    recommendationsErrorType: null,
    usingFallbackRecommendations: false,
    visualizationType: null,
    grafanaVersion: 'Unknown',
    theme: 'dark',
    timestamp: '',
    searchParams: {},
    platform: 'oss', // Default to oss, will be updated by getContextData
  });

  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [otherDocsExpanded, setOtherDocsExpanded] = useState(false);

  // Track location changes with more detail
  const lastLocationRef = useRef<{
    path: string;
    url: string;
    vizType: string | null;
    selectedDatasource: string | null;
    searchParams: string;
  }>({
    path: '',
    url: '',
    vizType: null,
    selectedDatasource: null,
    searchParams: '',
  });

  // Use centralized timeout manager instead of local refs
  const timeoutManager = useTimeoutManager();

  // Fetch context data
  const fetchContextData = useCallback(async () => {
    try {
      setContextData((prev) => ({ ...prev, isLoading: true }));
      const newContextData = await ContextService.getContextData();
      setContextData(newContextData);
    } catch (error) {
      console.error('Failed to fetch context data:', error);
      setContextData((prev) => ({ ...prev, isLoading: false }));
    }
  }, []); // Empty dependency array - setContextData is stable

  // All context changes that trigger a refresh should share this debounce to prevent repeated API calls and changes to the UI.
  const debouncedRefresh = useCallback(
    (delay?: number) => {
      timeoutManager.setDebounced('context-refresh', fetchContextData, delay, 'contextRefresh');
    },
    [fetchContextData, timeoutManager]
  );

  // Fetch recommendations
  const fetchRecommendations = useCallback(
    async (contextData: ContextData) => {
      if (!contextData.currentPath || contextData.isLoading) {
        return;
      }

      setIsLoadingRecommendations(true);
      try {
        const { recommendations, featuredRecommendations, error, errorType, usingFallbackRecommendations } =
          await ContextService.fetchRecommendations(contextData, pluginConfig);

        setContextData((prev) => ({
          ...prev,
          recommendations,
          featuredRecommendations,
          recommendationsError: error,
          recommendationsErrorType: errorType,
          usingFallbackRecommendations,
        }));
      } catch (error) {
        console.error('Failed to fetch recommendations:', error);
        setContextData((prev) => ({
          ...prev,
          recommendationsError: 'Failed to fetch recommendations',
          recommendationsErrorType: 'other',
          usingFallbackRecommendations: true,
        }));
      } finally {
        setIsLoadingRecommendations(false);
      }
    },
    [pluginConfig]
  ); // Add pluginConfig as dependency

  // Simplified location-based change detection (EchoSrv handles datasource/viz changes)
  useEffect(() => {
    const checkForChanges = () => {
      const location = locationService.getLocation();
      const currentPath = location.pathname || window.location.pathname || '';
      const currentUrl = window.location.href;
      const currentSearchParams = window.location.search;

      // Only check pathname changes - EchoSrv handles datasource/viz detection
      // This prevents unnecessary updates when URL params or hash change
      const hasLocationChanged = lastLocationRef.current.path !== currentPath;

      if (hasLocationChanged) {
        // Get current EchoSrv state for tracking (but don't trigger on changes)
        const currentVizType = ContextService.getDetectedVisualizationType();
        const currentSelectedDatasource = ContextService.getDetectedDatasourceType();

        lastLocationRef.current = {
          path: currentPath,
          url: currentUrl,
          vizType: currentVizType,
          selectedDatasource: currentSelectedDatasource,
          searchParams: currentSearchParams,
        };

        // Debounced refresh to avoid rapid-fire updates
        debouncedRefresh();
      }
    };

    // Initial check
    checkForChanges();

    // Listen for browser navigation events
    const handlePopState = () => {
      setTimeout(checkForChanges, 100); // Small delay for URL to update
    };

    // Listen for Grafana location service changes
    const handleLocationChange = () => {
      setTimeout(checkForChanges, 100);
    };

    // Listen for browser navigation
    window.addEventListener('popstate', handlePopState);

    // Listen for Grafana location changes (if available)
    if (locationService.getHistory) {
      const history = locationService.getHistory();
      const unlisten = history.listen(handleLocationChange);

      return () => {
        window.removeEventListener('popstate', handlePopState);
        unlisten();
        timeoutManager.clear('context-refresh');
      };
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      timeoutManager.clear('context-refresh');
    };
  }, [debouncedRefresh, timeoutManager]); // debouncedRefresh is stable due to useCallback

  // Listen for EchoSrv-triggered context changes (datasource/viz changes)
  useEffect(() => {
    const unsubscribe = ContextService.onContextChange(() => {
      debouncedRefresh();
    });

    return unsubscribe;
  }, [debouncedRefresh]);

  // Fetch recommendations when context data changes (but not when loading)
  const tagsString = contextData.tags?.join(',') || '';
  useEffect(() => {
    if (!contextData.isLoading && contextData.currentPath) {
      fetchRecommendations(contextData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextData would cause infinite loop
  }, [
    contextData.isLoading,
    contextData.currentPath,
    tagsString, // Extracted to separate variable - includes datasource tags
    contextData.visualizationType, // Direct viz type tracking
    fetchRecommendations,
  ]); // fetchRecommendations is stable due to useCallback with empty deps

  // Actions
  const refreshContext = useCallback(() => {
    lastLocationRef.current = { path: '', url: '', vizType: null, selectedDatasource: null, searchParams: '' };
    fetchContextData();
  }, [fetchContextData]);

  const refreshRecommendations = useCallback(() => {
    // Use current state at time of call, not dependency
    const currentContextData = {
      ...contextData,
      recommendations: [],
      recommendationsError: null,
    };
    fetchRecommendations(currentContextData);
  }, [fetchRecommendations, contextData]);

  const openLearningJourney = useCallback(
    (url: string, title: string) => {
      onOpenLearningJourney?.(url, title);
    },
    [onOpenLearningJourney]
  );

  const openDocsPage = useCallback(
    (url: string, title: string) => {
      onOpenDocsPage?.(url, title);
    },
    [onOpenDocsPage]
  );

  const toggleSummaryExpansion = useCallback((recommendationUrl: string) => {
    setContextData((prev) => ({
      ...prev,
      recommendations: prev.recommendations.map((rec) => {
        if (rec.url === recommendationUrl) {
          return { ...rec, summaryExpanded: !rec.summaryExpanded };
        }
        return rec;
      }),
      featuredRecommendations: prev.featuredRecommendations.map((rec) => {
        if (rec.url === recommendationUrl) {
          return { ...rec, summaryExpanded: !rec.summaryExpanded };
        }
        return rec;
      }),
    }));
  }, []);

  const navigateToPath = useCallback((path: string) => {
    locationService.push(path);
  }, []);

  const toggleOtherDocsExpansion = useCallback(() => {
    setOtherDocsExpanded((prev) => !prev);
  }, []);

  return {
    contextData,
    isLoadingRecommendations,
    otherDocsExpanded,

    // Actions
    refreshContext,
    refreshRecommendations,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
    navigateToPath,
    toggleOtherDocsExpansion,
  };
}

// Export individual access functions for backward compatibility
export const useContextData = () => {
  const { contextData } = useContextPanel();
  return contextData;
};

export const useRecommendations = () => {
  const { contextData, isLoadingRecommendations } = useContextPanel();
  return {
    recommendations: contextData.recommendations,
    isLoading: isLoadingRecommendations,
    error: contextData.recommendationsError,
  };
};
