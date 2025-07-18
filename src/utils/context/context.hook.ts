import { useState, useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { ContextService } from './context.service';
import { 
  ContextData, 
  UseContextPanelOptions, 
  UseContextPanelReturn
} from './context.types';

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
    searchParams: ''
  });

  // Timeout ref for debounced refresh
  const refreshTimeoutRef = useRef<NodeJS.Timeout>();

  // Fetch context data
  const fetchContextData = useCallback(async () => {
    try {
      setContextData(prev => ({ ...prev, isLoading: true }));
      const newContextData = await ContextService.getContextData();
      setContextData(newContextData);
    } catch (error) {
      console.error('Failed to fetch context data:', error);
      setContextData(prev => ({ ...prev, isLoading: false }));
    }
  }, []);

  // Debounced refresh to avoid excessive API calls
  const debouncedRefresh = useCallback((delay = 300) => {
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }
    refreshTimeoutRef.current = setTimeout(async () => {
      await fetchContextData();
    }, delay);
  }, [fetchContextData]);

  // Fetch recommendations
  const fetchRecommendations = useCallback(async (contextData: ContextData) => {
    if (!contextData.currentPath || contextData.isLoading) return;
    
    setIsLoadingRecommendations(true);
    try {
      const { recommendations, error } = await ContextService.fetchRecommendations(contextData);
      setContextData(prev => ({ 
        ...prev, 
        recommendations, 
        recommendationsError: error 
      }));
    } catch (error) {
      console.error('Failed to fetch recommendations:', error);
      setContextData(prev => ({ 
        ...prev, 
        recommendationsError: 'Failed to fetch recommendations' 
      }));
    } finally {
      setIsLoadingRecommendations(false);
    }
  }, []);

  // Enhanced location and context change detection
  useEffect(() => {
    const checkForChanges = () => {
      const location = locationService.getLocation();
      const currentPath = location.pathname || window.location.pathname || '';
      const currentUrl = window.location.href;
      const currentVizType = ContextService.detectVisualizationType();
      const currentSelectedDatasource = ContextService.detectSelectedDatasource();
      const currentSearchParams = window.location.search;
      
      // Check if anything significant changed
      const hasLocationChanged = lastLocationRef.current.path !== currentPath;
      const hasUrlChanged = lastLocationRef.current.url !== currentUrl;
      const hasVizTypeChanged = lastLocationRef.current.vizType !== currentVizType;
      const hasDatasourceChanged = lastLocationRef.current.selectedDatasource !== currentSelectedDatasource;
      const hasSearchParamsChanged = lastLocationRef.current.searchParams !== currentSearchParams;
      
      if (hasLocationChanged || hasUrlChanged || hasVizTypeChanged || hasDatasourceChanged || hasSearchParamsChanged) {
        lastLocationRef.current = { 
          path: currentPath, 
          url: currentUrl, 
          vizType: currentVizType,
          selectedDatasource: currentSelectedDatasource,
          searchParams: currentSearchParams
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

    // Set up DOM observation for viz picker changes
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      
      mutations.forEach((mutation) => {
        if (mutation.type === 'childList') {
          const addedNodes = Array.from(mutation.addedNodes);
          const removedNodes = Array.from(mutation.removedNodes);
          
          const hasVizPickerChanges = [...addedNodes, ...removedNodes].some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              return element.matches('button[aria-label="Change visualization"]') ||
                     element.querySelector('button[aria-label="Change visualization"]') ||
                     element.matches('input[aria-label="Select a data source"]') ||
                     element.querySelector('input[aria-label="Select a data source"]');
            }
            return false;
          });
          
          if (hasVizPickerChanges) {
            shouldCheck = true;
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target as Element;
          
          if (target.matches('button[aria-label="Change visualization"]') ||
              target.matches('button[data-testid*="toggle-viz-picker"]') ||
              target.matches('input[aria-label="Select a data source"]')) {
            shouldCheck = true;
          }
        }
      });

      if (shouldCheck) {
        setTimeout(checkForChanges, 500);
      }
    });

    // Start observing the document for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-expanded', 'src', 'data-testid', 'value', 'placeholder']
    });

    // Listen for browser navigation
    window.addEventListener('popstate', handlePopState);
    
    // Listen for Grafana location changes (if available)
    if (locationService.getHistory) {
      const history = locationService.getHistory();
      const unlisten = history.listen(handleLocationChange);
      
      return () => {
        observer.disconnect();
        window.removeEventListener('popstate', handlePopState);
        unlisten();
        if (refreshTimeoutRef.current) {
          clearTimeout(refreshTimeoutRef.current);
        }
      };
    }

    return () => {
      observer.disconnect();
      window.removeEventListener('popstate', handlePopState);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, []); // Empty dependency array - this effect should only run once

  // Fetch recommendations when context data changes (but not when loading)
  useEffect(() => {
    if (!contextData.isLoading && contextData.currentPath) {
      fetchRecommendations(contextData);
    }
  }, [
    contextData.isLoading, 
    contextData.currentPath, 
    contextData.tags?.join(','), // Convert array to string for comparison
    contextData.visualizationType,
    fetchRecommendations
  ]);

  // Actions
  const refreshContext = useCallback(() => {
    lastLocationRef.current = { path: '', url: '', vizType: null, selectedDatasource: null, searchParams: '' };
    fetchContextData();
  }, [fetchContextData]);

  const refreshRecommendations = useCallback(() => {
    fetchRecommendations(contextData);
  }, [fetchRecommendations, contextData]);

  const openLearningJourney = useCallback((url: string, title: string) => {
    onOpenLearningJourney?.(url, title);
  }, [onOpenLearningJourney]);

  const openDocsPage = useCallback((url: string, title: string) => {
    onOpenDocsPage?.(url, title);
  }, [onOpenDocsPage]);

  const toggleSummaryExpansion = useCallback((recommendationUrl: string) => {
    setContextData(prev => ({
      ...prev,
      recommendations: prev.recommendations.map(rec => {
        if (rec.url === recommendationUrl) {
          return { ...rec, summaryExpanded: !rec.summaryExpanded };
        }
        return rec;
      })
    }));
  }, []);

  const navigateToPath = useCallback((path: string) => {
    locationService.push(path);
  }, []);

  const toggleOtherDocsExpansion = useCallback(() => {
    setOtherDocsExpanded(prev => !prev);
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