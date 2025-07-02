import { useState, useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { 
  DataSource, 
  DashboardInfo, 
  Recommendation, 
  fetchDataSources, 
  fetchDashboardInfo, 
  fetchGrafanaVersion, 
  fetchRecommendations 
} from './context-data-fetcher';
import { generateContextTags, ContextState, detectVisualizationType } from './context-analysis';

export interface UseContextPanelOptions {
  onOpenLearningJourney?: (url: string, title: string) => void;
  onOpenDocsPage?: (url: string, title: string) => void;
}

export interface UseContextPanelReturn {
  // State
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
  otherDocsExpanded: boolean;
  visualizationType: string | null;
  
  // Actions
  refreshContext: () => void;
  refreshRecommendations: () => void;
  openLearningJourney: (url: string, title: string) => void;
  openDocsPage: (url: string, title: string) => void;
  toggleSummaryExpansion: (index: number) => void;
  navigateToPath: (path: string) => void;
  toggleOtherDocsExpansion: () => void;
}

export function useContextPanel(options: UseContextPanelOptions = {}): UseContextPanelReturn {
  const { onOpenLearningJourney, onOpenDocsPage } = options;

  // State
  const [currentPath, setCurrentPath] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [pathSegments, setPathSegments] = useState<string[]>([]);
  const [timestamp, setTimestamp] = useState('');
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [dashboardInfo, setDashboardInfo] = useState<DashboardInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<Record<string, string>>({});
  const [grafanaVersion, setGrafanaVersion] = useState('');
  const [theme, setTheme] = useState('');
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  const [recommendationsError, setRecommendationsError] = useState<string | null>(null);
  const [otherDocsExpanded, setOtherDocsExpanded] = useState(false);
  const [visualizationType, setVisualizationType] = useState<string | null>(null);

  // Track last processed location to avoid unnecessary updates
  const lastLocationRef = useRef<{ path: string; url: string; vizType?: string }>({ path: '', url: '' });

  // Fetch recommendations with context analysis
  const fetchRecommendationsData = useCallback(async (
    currentPath: string,
    dataSources: DataSource[],
    pathSegments: string[],
    searchParams: Record<string, string>,
    dashboardInfo: DashboardInfo | null,
    visualizationType?: string
  ) => {
    setIsLoadingRecommendations(true);
    setRecommendationsError(null);

    // Generate context tags using the extracted utility
    const contextState: ContextState = {
      currentPath,
      pathSegments,
      searchParams,
      dataSources,
      dashboardInfo,
      visualizationType: visualizationType || undefined,
    };
    const contextTags = generateContextTags(contextState);

    // Fetch recommendations
    const { recommendations, error } = await fetchRecommendations(currentPath, dataSources, contextTags);
    
    setRecommendations(recommendations);
    setRecommendationsError(error);
    setIsLoadingRecommendations(false);
  }, []);

  // Set up visualization type observer
  useEffect(() => {
    const observeVizChanges = () => {
      const currentVizType = detectVisualizationType();
      if (currentVizType !== visualizationType) {
        setVisualizationType(currentVizType);
        
        // Trigger recommendations refresh if we're in panel edit mode and viz type changed
        if (currentVizType && lastLocationRef.current.vizType !== currentVizType) {
          lastLocationRef.current.vizType = currentVizType;
          // Debounce the refresh to avoid excessive calls
          setTimeout(() => {
            // Call fetchRecommendationsData directly with the detected viz type
            // instead of relying on state which might not be updated yet
            fetchRecommendationsData(currentPath, dataSources, pathSegments, searchParams, dashboardInfo, currentVizType);
          }, 500);
        }
      }
    };

    // Initial detection
    observeVizChanges();

    // Set up MutationObserver to watch for DOM changes
    const observer = new MutationObserver((mutations) => {
      let shouldCheck = false;
      
      mutations.forEach((mutation) => {
        // Check if any changes occurred to viz picker buttons or their content
        if (mutation.type === 'childList') {
          const addedNodes = Array.from(mutation.addedNodes);
          const hasVizPickerChanges = addedNodes.some(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              return element.matches('[data-testid*="toggle-viz-picker"]') ||
                     element.querySelector('[data-testid*="toggle-viz-picker"]') ||
                     element.matches('img[src*="/plugins/panel/"]') ||
                     element.querySelector('img[src*="/plugins/panel/"]');
            }
            return false;
          });
          
          if (hasVizPickerChanges) {
            shouldCheck = true;
          }
        } else if (mutation.type === 'attributes') {
          const target = mutation.target as Element;
          if (target.matches('[data-testid*="toggle-viz-picker"]') ||
              target.matches('img[src*="/plugins/panel/"]') ||
              target.closest('[data-testid*="toggle-viz-picker"]')) {
            shouldCheck = true;
          }
        }
      });

      if (shouldCheck) {
        // Debounce the check to avoid excessive calls
        setTimeout(observeVizChanges, 100);
      }
    });

    // Start observing the document for changes
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-testid', 'aria-expanded']
    });

    // Also listen for click events on viz picker buttons
    const handleVizPickerClick = (event: Event) => {
      const target = event.target as Element;
      const vizPickerButton = target.closest('[data-testid*="toggle-viz-picker"]');
      
      if (vizPickerButton) {
        // Wait a bit for the UI to update after the click
        setTimeout(observeVizChanges, 200);
      }
    };

    document.addEventListener('click', handleVizPickerClick);

    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleVizPickerClick);
    };
  }, [visualizationType, fetchRecommendationsData, currentPath, dataSources, pathSegments, searchParams, dashboardInfo]);

  // Update context data based on current location
  const updateContext = useCallback(async () => {
    const currentPath = window.location.pathname;
    const currentUrl = window.location.href;
    const currentVizType = detectVisualizationType();
    
    // Check if location actually changed (including viz type)
    if (lastLocationRef.current.path === currentPath && 
        lastLocationRef.current.url === currentUrl &&
        lastLocationRef.current.vizType === currentVizType) {
      return;
    }
    
    lastLocationRef.current = { path: currentPath, url: currentUrl, vizType: currentVizType || undefined };

    setIsLoading(true);

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

    // Update state with basic location info
    setCurrentPath(currentPath);
    setCurrentUrl(currentUrl);
    setPathSegments(pathSegments);
    setTimestamp(timestamp);
    setSearchParams(searchParams);
    setTheme(theme);
    setVisualizationType(currentVizType);

    // Fetch additional context data in parallel
    const [dataSources, dashboardInfo, grafanaVersion] = await Promise.all([
      fetchDataSources(),
      fetchDashboardInfo(currentPath),
      fetchGrafanaVersion(),
    ]);
    
    setDataSources(dataSources);
    setDashboardInfo(dashboardInfo);
    setGrafanaVersion(grafanaVersion);

    setIsLoading(false);

    // Fetch recommendations after we have the data sources and viz type
    await fetchRecommendationsData(currentPath, dataSources, pathSegments, searchParams, dashboardInfo, currentVizType || undefined);
  }, [fetchRecommendationsData]);

  // Set up location listener
  useEffect(() => {
    // Initial context update
    updateContext();

    // Set up listener for location changes
    const history = locationService.getHistory();
    if (history) {
      const unlisten = history.listen((location: any) => {
        // Use updateContext which now has built-in change detection
        updateContext();
      });

      // Cleanup listener on unmount
      return () => {
        unlisten();
      };
    }
    
    // Return empty cleanup function if no history available
    return () => {};
  }, [updateContext]); // Only depend on updateContext, not path/url state

  // Actions
  const refreshContext = useCallback(() => {
    // Reset location tracking to force update
    lastLocationRef.current = { path: '', url: '' };
    updateContext();
  }, [updateContext]);

  const refreshRecommendations = useCallback(() => {
    fetchRecommendationsData(currentPath, dataSources, pathSegments, searchParams, dashboardInfo, visualizationType || undefined);
  }, [fetchRecommendationsData, currentPath, dataSources, pathSegments, searchParams, dashboardInfo, visualizationType]);

  const openLearningJourney = useCallback((url: string, title: string) => {
    if (onOpenLearningJourney) {
      onOpenLearningJourney(url, title);
    }
  }, [onOpenLearningJourney]);

  const openDocsPage = useCallback((url: string, title: string) => {
    if (onOpenDocsPage) {
      onOpenDocsPage(url, title);
    } else {
      console.warn('No onOpenDocsPage callback available');
    }
  }, [onOpenDocsPage]);

  const toggleSummaryExpansion = useCallback((index: number) => {
    setRecommendations(prevRecommendations => {
      const newRecommendations = [...prevRecommendations];
      const recommendation = newRecommendations[index];
      
      // Toggle summary expansion state
      newRecommendations[index] = {
        ...recommendation,
        summaryExpanded: !recommendation.summaryExpanded,
      };
      
      return newRecommendations;
    });
  }, []);

  const navigateToPath = useCallback((path: string) => {
    locationService.push(path);
  }, []);

  const toggleOtherDocsExpansion = useCallback(() => {
    setOtherDocsExpanded(prev => !prev);
  }, []);

  return {
    // State
    currentPath,
    currentUrl,
    pathSegments,
    timestamp,
    dataSources,
    dashboardInfo,
    isLoading,
    searchParams,
    grafanaVersion,
    theme,
    recommendations,
    isLoadingRecommendations,
    recommendationsError,
    otherDocsExpanded,
    visualizationType,
    
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
