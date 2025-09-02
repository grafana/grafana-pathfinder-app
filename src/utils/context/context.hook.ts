import React, { useState, useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { ContextService } from './context.service';
import { ContextData, UseContextPanelOptions, UseContextPanelReturn } from './context.types';
import { useTimeoutManager } from '../timeout-manager';

export function useContextPanel(options: UseContextPanelOptions = {}): UseContextPanelReturn {
  const { onOpenLearningJourney, onOpenDocsPage } = options;

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

  // Unified debounced refresh for ALL context changes (location + EchoSrv)
  const debouncedRefresh = useCallback(
    (delay?: number) => {
      timeoutManager.setDebounced('context-refresh', fetchContextData, delay, 'contextRefresh');
    },
    [fetchContextData, timeoutManager]
  );

  // Fetch recommendations
  const fetchRecommendations = useCallback(async (contextData: ContextData) => {
    if (!contextData.currentPath || contextData.isLoading) {
      return;
    }

    setIsLoadingRecommendations(true);
    try {
      const { recommendations, error } = await ContextService.fetchRecommendations(contextData);
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
  }, []); // Empty dependency array - setContextData and setIsLoadingRecommendations are stable

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
        timeoutManager.clear('context-refresh');
      };
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      timeoutManager.clear('context-refresh');
    };
  }, [debouncedRefresh]); // debouncedRefresh is stable due to useCallback

  // Listen for EchoSrv-triggered context changes (datasource/viz changes)
  // Now uses unified debouncing with location changes
  useEffect(() => {
    const unsubscribe = ContextService.onContextChange(() => {
      debouncedRefresh();
    });

    return unsubscribe;
  }, [debouncedRefresh]); // Only depend on debouncedRefresh

  // Fetch recommendations when context data changes (but not when loading)
  // Separate the trigger data from the full context to prevent feedback loops
  const recommendationTriggerData = React.useMemo(() => ({
    currentPath: contextData.currentPath,
    isLoading: contextData.isLoading,
    tags: contextData.tags,
    visualizationType: contextData.visualizationType,
    dataSources: contextData.dataSources,
    dashboardInfo: contextData.dashboardInfo,
    pathSegments: contextData.pathSegments,
    grafanaVersion: contextData.grafanaVersion,
    theme: contextData.theme,
    timestamp: contextData.timestamp,
    searchParams: contextData.searchParams,
  }), [
    contextData.currentPath,
    contextData.isLoading,
    contextData.tags,
    contextData.visualizationType,
    contextData.dataSources,
    contextData.dashboardInfo,
    contextData.pathSegments,
    contextData.grafanaVersion,
    contextData.theme,
    contextData.timestamp,
    contextData.searchParams,
  ]);

  const tagsString = recommendationTriggerData.tags?.join(',') || '';
  useEffect(() => {
    if (!recommendationTriggerData.isLoading && recommendationTriggerData.currentPath) {
      // Create full context data for recommendations but don't depend on it
      const fullContextData: ContextData = {
        ...recommendationTriggerData,
        currentUrl: contextData.currentUrl, // Include missing required property
        recommendations: [], // Don't include current recommendations to prevent loops
        recommendationsError: null,
      };
      fetchRecommendations(fullContextData);
    }
  }, [
    recommendationTriggerData.isLoading,
    recommendationTriggerData.currentPath,
    tagsString, // Extracted to separate variable - includes datasource tags
    recommendationTriggerData.visualizationType, // Direct viz type tracking
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
      ...recommendationTriggerData,
      currentUrl: contextData.currentUrl,
      recommendations: [],
      recommendationsError: null,
    };
    fetchRecommendations(currentContextData);
  }, [fetchRecommendations, recommendationTriggerData, contextData.currentUrl]);

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
