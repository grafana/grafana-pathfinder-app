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
import { generateContextTags, ContextState } from './context-analysis';

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

  // Track last processed location to avoid unnecessary updates
  const lastLocationRef = useRef<{ path: string; url: string }>({ path: '', url: '' });

  // Fetch recommendations with context analysis
  const fetchRecommendationsData = useCallback(async (
    currentPath: string,
    dataSources: DataSource[],
    pathSegments: string[],
    searchParams: Record<string, string>,
    dashboardInfo: DashboardInfo | null
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
    };
    const contextTags = generateContextTags(contextState);

    // Fetch recommendations
    const { recommendations, error } = await fetchRecommendations(currentPath, dataSources, contextTags);
    
    setRecommendations(recommendations);
    setRecommendationsError(error);
    setIsLoadingRecommendations(false);
  }, []);

  // Update context data based on current location
  const updateContext = useCallback(async () => {
    const currentPath = window.location.pathname;
    const currentUrl = window.location.href;
    
    // Check if location actually changed
    if (lastLocationRef.current.path === currentPath && lastLocationRef.current.url === currentUrl) {
      console.log('Location unchanged, skipping context update');
      return;
    }
    
    console.log('Updating context for location:', { from: lastLocationRef.current.path, to: currentPath });
    lastLocationRef.current = { path: currentPath, url: currentUrl };

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

    // Fetch recommendations after we have the data sources
    await fetchRecommendationsData(currentPath, dataSources, pathSegments, searchParams, dashboardInfo);
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
    fetchRecommendationsData(currentPath, dataSources, pathSegments, searchParams, dashboardInfo);
  }, [fetchRecommendationsData, currentPath, dataSources, pathSegments, searchParams, dashboardInfo]);

  const openLearningJourney = useCallback((url: string, title: string) => {
    if (onOpenLearningJourney) {
      onOpenLearningJourney(url, title);
    }
  }, [onOpenLearningJourney]);

  const openDocsPage = useCallback((url: string, title: string) => {
    console.log('useContextPanel.openDocsPage called with:', { url, title, hasCallback: !!onOpenDocsPage });
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
