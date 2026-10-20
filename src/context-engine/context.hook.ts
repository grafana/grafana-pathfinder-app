import { contextLocationKey } from '../lib/context-location';
// eslint-disable-next-line no-restricted-imports -- [ratchet] Shared resolved settings dependency tracked in PR #1691.
import { usePathfinderPluginConfig } from '../hooks';
import { useState, useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { ContextService } from './context.service';
import { getDetectedDatasourceType, getDetectedVisualizationType, onContextChange } from './context-event-bus';
import { ContextData, Recommendation, UseContextPanelOptions, UseContextPanelReturn } from '../types/context.types';
import type { PackageOpenInfo } from '../types/content-panel.types';
import { useTimeoutManager } from '../utils/timeout-manager';
import { StorageEvents } from '../lib/event-names';
import { logger } from '../lib/logging';
import { suggestionState, SUGGESTIONS_UPDATED_EVENT } from '../global-state/suggestion';
import { subscribeToAutoOpenGuideEnrollment } from '../utils/experiments/auto-open-guide/state';

export function useContextPanel(options: UseContextPanelOptions = {}): UseContextPanelReturn {
  const { onOpenLearningJourney, onOpenDocsPage } = options;

  const { config: pluginConfig } = usePathfinderPluginConfig();

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
  const [hasFetchedRecommendations, setHasFetchedRecommendations] = useState(false);
  const [otherDocsExpanded, setOtherDocsExpanded] = useState(false);
  const [contextRevision, setContextRevision] = useState(0);

  const contextVersion = useRef(0);
  const recommendationVersion = useRef(0);
  const mounted = useRef(true);
  const lastLocationRef = useRef('');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const timeoutManager = useTimeoutManager();

  const fetchContextData = useCallback(async () => {
    const version = ++contextVersion.current;
    try {
      setContextData((prev) => ({ ...prev, isLoading: true }));
      setHasFetchedRecommendations(false);
      const newContextData = await ContextService.getContextData();
      if (mounted.current && version === contextVersion.current) {
        setContextData(newContextData);
        setContextRevision((revision) => revision + 1);
      }
    } catch (error) {
      if (!mounted.current || version !== contextVersion.current) {
        return;
      }
      logger.error('Failed to fetch context data', { error });
      setContextData((prev) => ({ ...prev, isLoading: false }));
      setContextRevision((revision) => revision + 1);
    }
  }, []);

  const debouncedRefresh = useCallback(
    (delay?: number) => {
      contextVersion.current++;
      timeoutManager.setDebounced('context-refresh', fetchContextData, delay, 'contextRefresh');
    },
    [fetchContextData, timeoutManager]
  );

  const fetchRecommendations = useCallback(
    async (contextData: ContextData) => {
      if (!contextData.currentPath || contextData.isLoading) {
        return;
      }

      const version = contextVersion.current;
      const request = ++recommendationVersion.current;
      const isCurrent = () =>
        mounted.current && version === contextVersion.current && request === recommendationVersion.current;
      setIsLoadingRecommendations(true);
      setHasFetchedRecommendations(false);
      try {
        const { recommendations, featuredRecommendations, error, errorType, usingFallbackRecommendations } =
          await ContextService.fetchRecommendations(contextData, pluginConfig);
        if (!isCurrent()) {
          return;
        }

        const suggestions = suggestionState.getSuggestions();
        const suggestionUrls = new Set(suggestions.map((s) => s.url));
        const tagged = suggestions.map((s) => ({
          ...s,
          _fromSuggestion: true as const,
          placement: 'suggestion' as const,
        }));
        const mergedFeatured =
          tagged.length > 0
            ? [...tagged, ...featuredRecommendations.filter((r) => !suggestionUrls.has(r.url))]
            : featuredRecommendations;

        setContextData((prev) => ({
          ...prev,
          recommendations,
          featuredRecommendations: mergedFeatured,
          recommendationsError: error,
          recommendationsErrorType: errorType,
          usingFallbackRecommendations,
        }));
      } catch (error) {
        if (!isCurrent()) {
          return;
        }
        logger.error('Failed to fetch recommendations', { error });
        setContextData((prev) => ({
          ...prev,
          recommendationsError: 'Failed to fetch recommendations',
          recommendationsErrorType: 'other',
          usingFallbackRecommendations: true,
        }));
      } finally {
        if (isCurrent()) {
          setIsLoadingRecommendations(false);
          setHasFetchedRecommendations(true);
        }
      }
    },
    [pluginConfig]
  );

  useEffect(() => {
    const checkForChanges = () => {
      const location = locationService.getLocation();
      const currentPath = location.pathname || window.location.pathname || '';
      const key = contextLocationKey(currentPath, location.search);
      if (lastLocationRef.current !== key) {
        lastLocationRef.current = key;
        getDetectedDatasourceType();
        getDetectedVisualizationType();

        debouncedRefresh();
      }
    };

    checkForChanges();

    const handlePopState = () => {
      setTimeout(checkForChanges, 100); // Small delay for URL to update
    };

    const handleLocationChange = () => {
      setTimeout(checkForChanges, 100);
    };

    window.addEventListener('popstate', handlePopState);

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
  }, [debouncedRefresh, timeoutManager]);

  useEffect(() => {
    const unsubscribe = onContextChange(() => {
      debouncedRefresh();
    });

    return unsubscribe;
  }, [debouncedRefresh]);

  useEffect(() => subscribeToAutoOpenGuideEnrollment(debouncedRefresh), [debouncedRefresh]);

  useEffect(() => {
    const handleProgressCleared = () => {
      debouncedRefresh();
    };

    window.addEventListener(StorageEvents.InteractiveProgressCleared, handleProgressCleared);
    return () => {
      window.removeEventListener(StorageEvents.InteractiveProgressCleared, handleProgressCleared);
    };
  }, [debouncedRefresh]);

  const applySuggestions = useCallback(() => {
    const suggestions = suggestionState.getSuggestions();
    setContextData((prev) => {
      const withoutOld = prev.featuredRecommendations.filter((r) => !r._fromSuggestion);
      if (suggestions.length === 0) {
        return withoutOld.length === prev.featuredRecommendations.length
          ? prev
          : { ...prev, featuredRecommendations: withoutOld };
      }
      const suggestionUrls = new Set(suggestions.map((s) => s.url));
      const dedupedExisting = withoutOld.filter((r) => !suggestionUrls.has(r.url));
      const tagged = suggestions.map((s) => ({
        ...s,
        _fromSuggestion: true as const,
        placement: 'suggestion' as const,
      }));
      return { ...prev, featuredRecommendations: [...tagged, ...dedupedExisting] };
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- apply persisted suggestions on mount; re-applied on the SUGGESTIONS_UPDATED event subscribed below
    applySuggestions();

    const handler = () => applySuggestions();
    document.addEventListener(SUGGESTIONS_UPDATED_EVENT, handler);
    return () => document.removeEventListener(SUGGESTIONS_UPDATED_EVENT, handler);
  }, [applySuggestions]);

  const tagsString = contextData.tags?.join(',') || '';
  useEffect(() => {
    if (!contextData.isLoading && contextData.currentPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when the active context changes
      fetchRecommendations(contextData);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- contextData would cause infinite loop
  }, [
    contextData.isLoading,
    contextData.currentPath,
    tagsString, // Extracted to separate variable - includes datasource tags
    contextData.visualizationType, // Direct viz type tracking
    contextRevision,
    fetchRecommendations,
  ]);

  const refreshContext = useCallback(() => {
    lastLocationRef.current = '';
    fetchContextData();
  }, [fetchContextData]);

  const refreshRecommendations = useCallback(() => {
    const currentContextData = {
      ...contextData,
      recommendations: [],
      recommendationsError: null,
    };
    fetchRecommendations(currentContextData);
  }, [fetchRecommendations, contextData]);

  const openLearningJourney = useCallback(
    (url: string, title: string) => {
      return onOpenLearningJourney?.(url, title);
    },
    [onOpenLearningJourney]
  );

  const openDocsPage = useCallback(
    (url: string, title: string, packageInfo?: PackageOpenInfo) => {
      return onOpenDocsPage?.(url, title, packageInfo);
    },
    [onOpenDocsPage]
  );

  const toggleSummaryExpansion = useCallback((recommendationUrl: string) => {
    if (!recommendationUrl) {
      return;
    }

    const matches = (rec: Recommendation) =>
      (rec.url !== '' && rec.url === recommendationUrl) ||
      (rec.contentUrl !== '' && rec.contentUrl === recommendationUrl);

    const hasDeferredData = (rec: Recommendation) =>
      (rec.pendingRecommendIds && rec.pendingRecommendIds.length > 0) ||
      (rec.pendingSuggestIds && rec.pendingSuggestIds.length > 0) ||
      (rec.pendingMilestoneIds && rec.pendingMilestoneIds.length > 0);

    let resolveTarget: Recommendation | undefined;

    setContextData((prev) => {
      const updateRec = (rec: Recommendation): Recommendation => {
        if (!matches(rec)) {
          return rec;
        }
        const expanding = !rec.summaryExpanded;
        if (expanding && hasDeferredData(rec) && !rec.isResolvingDeferred) {
          resolveTarget = rec;
        }
        return {
          ...rec,
          summaryExpanded: expanding,
          isResolvingDeferred: expanding && hasDeferredData(rec),
        };
      };

      return {
        ...prev,
        recommendations: prev.recommendations.map(updateRec),
        featuredRecommendations: prev.featuredRecommendations.map(updateRec),
      };
    });

    if (resolveTarget) {
      const clearResolving = () => {
        setContextData((current) => ({
          ...current,
          recommendations: current.recommendations.map((rec) =>
            matches(rec) ? { ...rec, isResolvingDeferred: false } : rec
          ),
          featuredRecommendations: current.featuredRecommendations.map((rec) =>
            matches(rec) ? { ...rec, isResolvingDeferred: false } : rec
          ),
        }));
      };

      ContextService.resolveDeferredData(resolveTarget)
        .then((resolved) => {
          setContextData((current) => {
            const applyResolved = (rec: Recommendation): Recommendation => {
              if (!matches(rec)) {
                return rec;
              }
              return { ...rec, ...resolved, summaryExpanded: rec.summaryExpanded, isResolvingDeferred: false };
            };
            return {
              ...current,
              recommendations: current.recommendations.map(applyResolved),
              featuredRecommendations: current.featuredRecommendations.map(applyResolved),
            };
          });
        })
        .catch(clearResolving);
    }
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
    hasFetchedRecommendations,
    otherDocsExpanded,

    refreshContext,
    refreshRecommendations,
    openLearningJourney,
    openDocsPage,
    toggleSummaryExpansion,
    navigateToPath,
    toggleOtherDocsExpansion,
  };
}

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
