import { useState, useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { usePluginContext } from '@grafana/data';
import { ContextService } from './context.service';
import { ContextData, UseContextPanelOptions, UseContextPanelReturn } from './context.types';

export function useContextPanel(options: UseContextPanelOptions = {}): UseContextPanelReturn {
  const { onOpenLearningJourney, onOpenDocsPage } = options;
  
  // Get plugin configuration
  const pluginContext = usePluginContext();
  const pluginConfig = pluginContext?.meta?.jsonData || {};

  // State
  const [contextData, setContextData] = useState<ContextData>({
    currentPath: '',
    currentUrl: '',
    pathSegments: [],
    dataSources: [],
    dashboardInfo: null,
    recommendations: [],
    tags: [],
    isLoading: true,
    recommendationsError: null,
    visualizationType: null,
    grafanaVersion: 'Unknown',
    theme: 'dark',
    timestamp: '',
    searchParams: {},
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

  // Timeout ref for debounced refresh
  const refreshTimeoutRef = useRef<NodeJS.Timeout>();

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

  // Debounced refresh to avoid excessive API calls
  const debouncedRefresh = useCallback(
    (delay = 300) => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(async () => {
        await fetchContextData();
      }, delay);
    },
    [fetchContextData]
  );

  // Fetch recommendations
  const fetchRecommendations = useCallback(async (contextData: ContextData) => {
    if (!contextData.currentPath || contextData.isLoading) {
      return;
    }

    setIsLoadingRecommendations(true);
    try {
      const { recommendations, error } = await ContextService.fetchRecommendations(contextData, pluginConfig);
      setContextData((prev) => ({
        ...prev,
        recommendations,
        recommendationsError: error,
      }));
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      setContextData((prev) => ({
        ...prev,
        recommendationsError: 'Failed to fetch recommendations',
      }));
    } finally {
      setIsLoadingRecommendations(false);
    }
  }, [pluginConfig]); // Add pluginConfig as dependency

  // Simplified location-based change detection (EchoSrv handles datasource/viz changes)
  useEffect(() => {
    const checkForChanges = () => {
      const location = locationService.getLocation();
      const currentPath = location.pathname || window.location.pathname || '';
      const currentUrl = window.location.href;
      const currentSearchParams = window.location.search;

      // Only check location/URL changes - EchoSrv handles datasource/viz detection
      const hasLocationChanged = lastLocationRef.current.path !== currentPath;
      const hasUrlChanged = lastLocationRef.current.url !== currentUrl;
      const hasSearchParamsChanged = lastLocationRef.current.searchParams !== currentSearchParams;

      if (hasLocationChanged || hasUrlChanged || hasSearchParamsChanged) {
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
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
      };
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [debouncedRefresh]); // debouncedRefresh is stable due to useCallback

  // Listen for EchoSrv-triggered context changes (datasource/viz changes)
  useEffect(() => {
    const unsubscribe = ContextService.onContextChange(async () => {
      // Force immediate context refresh when EchoSrv events occur
      try {
        setContextData((prev) => ({ ...prev, isLoading: true }));
        const newContextData = await ContextService.getContextData();
        setContextData(newContextData);

        // Now fetch recommendations with the fresh context data
        if (newContextData.currentPath) {
          fetchRecommendations(newContextData);
        }
      } catch (error) {
        console.error('Failed to refresh context after EchoSrv change:', error);
        setContextData((prev) => ({ ...prev, isLoading: false }));
      }
    });

    return unsubscribe;
  }, [fetchRecommendations]); // Removed contextData dependency to avoid stale closures

  // Fetch recommendations when context data changes (but not when loading)
  const tagsString = contextData.tags?.join(',') || '';
  const contextDataRef = useRef(contextData);
  contextDataRef.current = contextData;

  useEffect(() => {
    if (!contextData.isLoading && contextData.currentPath) {
      // Use ref to avoid stale closure issues
      fetchRecommendations(contextDataRef.current);
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
    fetchRecommendations(contextData);
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
