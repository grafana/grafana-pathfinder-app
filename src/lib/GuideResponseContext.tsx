/**
 * Guide Response Context
 *
 * React context for reactive access to guide responses.
 * Uses the unified user-storage system for cross-device sync via Grafana user storage.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { guideResponseStorage, GuideResponseValue } from './user-storage';

/** Context value shape */
interface GuideResponseContextValue {
  /** Current guide ID */
  guideId: string;
  /** All responses for the current guide */
  responses: Record<string, GuideResponseValue>;
  /** Set a response value */
  setResponse: (variableName: string, value: GuideResponseValue) => void;
  /** Get a response value */
  getResponse: (variableName: string) => GuideResponseValue | undefined;
  /** Check if a response exists */
  hasResponse: (variableName: string) => boolean;
  /** Delete a response */
  deleteResponse: (variableName: string) => void;
  /** Clear all responses for this guide */
  clearResponses: () => void;
  /** Whether responses are still loading */
  isLoading: boolean;
}

/** Context instance */
const GuideResponseContext = createContext<GuideResponseContextValue | null>(null);

/** Provider props */
interface GuideResponseProviderProps {
  /** The guide ID to scope responses to */
  guideId: string;
  /** Child components */
  children: ReactNode;
}

/**
 * Provider component for guide responses.
 * Loads existing responses on mount and provides reactive updates.
 * Uses async storage that syncs to Grafana user storage for cross-device persistence.
 */
export function GuideResponseProvider({ guideId, children }: GuideResponseProviderProps) {
  // State to trigger re-renders when responses change
  const [responses, setResponses] = useState<Record<string, GuideResponseValue>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Load responses when guideId changes (async)
  // Uses async/await with AbortController pattern to satisfy lint rules
  useEffect(() => {
    const controller = new AbortController();

    async function loadResponses() {
      try {
        const loaded = await guideResponseStorage.getForGuide(guideId);
        if (!controller.signal.aborted) {
          setResponses(loaded);
          setIsLoading(false);
        }
      } catch {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadResponses();

    return () => {
      controller.abort();
    };
  }, [guideId]);

  // Set a response - updates state optimistically, then persists async
  // Storage dispatches event internally for requirements re-evaluation
  const setResponse = useCallback(
    (variableName: string, value: GuideResponseValue) => {
      // Optimistic update for immediate UI feedback
      setResponses((prev) => ({ ...prev, [variableName]: value }));

      // Persist to storage (async, handles event dispatch)
      guideResponseStorage.setResponse(guideId, variableName, value);
    },
    [guideId]
  );

  // Get a response from current state
  const getResponse = useCallback(
    (variableName: string): GuideResponseValue | undefined => {
      return responses[variableName];
    },
    [responses]
  );

  // Check if a response exists
  const hasResponse = useCallback(
    (variableName: string): boolean => {
      return variableName in responses;
    },
    [responses]
  );

  // Delete a response - updates state optimistically, then persists async
  // Storage dispatches event internally for requirements re-evaluation
  const deleteResponse = useCallback(
    (variableName: string) => {
      // Optimistic update
      setResponses((prev) => {
        const next = { ...prev };
        delete next[variableName];
        return next;
      });

      // Persist to storage (async, handles event dispatch)
      guideResponseStorage.deleteResponse(guideId, variableName);
    },
    [guideId]
  );

  // Clear all responses - updates state optimistically, then persists async
  // Storage dispatches event internally for requirements re-evaluation
  const clearResponses = useCallback(() => {
    // Optimistic update
    setResponses({});

    // Persist to storage (async, handles event dispatch)
    guideResponseStorage.clearForGuide(guideId);
  }, [guideId]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<GuideResponseContextValue>(
    () => ({
      guideId,
      responses,
      setResponse,
      getResponse,
      hasResponse,
      deleteResponse,
      clearResponses,
      isLoading,
    }),
    [guideId, responses, setResponse, getResponse, hasResponse, deleteResponse, clearResponses, isLoading]
  );

  return <GuideResponseContext.Provider value={value}>{children}</GuideResponseContext.Provider>;
}

/**
 * Hook to access guide responses.
 * Must be used within a GuideResponseProvider.
 */
export function useGuideResponses(): GuideResponseContextValue {
  const context = useContext(GuideResponseContext);
  if (!context) {
    throw new Error('useGuideResponses must be used within a GuideResponseProvider');
  }
  return context;
}

/**
 * Hook to get a specific response value.
 * Returns undefined if no provider is present (graceful degradation).
 */
export function useGuideResponse(variableName: string): GuideResponseValue | undefined {
  const context = useContext(GuideResponseContext);
  return context?.responses[variableName];
}

/**
 * Hook to check if guide response context is available.
 * Useful for components that need to work with or without the provider.
 */
export function useHasGuideResponseContext(): boolean {
  const context = useContext(GuideResponseContext);
  return context !== null;
}

/**
 * Hook to optionally access guide responses.
 * Returns null if no provider is present (graceful degradation).
 * Use this when a component needs to work both with and without a provider.
 */
export function useGuideResponsesOptional(): GuideResponseContextValue | null {
  return useContext(GuideResponseContext);
}
