/**
 * Guide Response Context
 *
 * React context for reactive access to guide responses.
 * Wraps the guideResponseStore with React state for automatic re-renders.
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, ReactNode } from 'react';
import { guideResponseStore, ResponseValue } from './guide-responses';

/** Context value shape */
interface GuideResponseContextValue {
  /** Current guide ID */
  guideId: string;
  /** All responses for the current guide */
  responses: Record<string, ResponseValue>;
  /** Set a response value */
  setResponse: (variableName: string, value: ResponseValue) => void;
  /** Get a response value */
  getResponse: (variableName: string) => ResponseValue | undefined;
  /** Check if a response exists */
  hasResponse: (variableName: string) => boolean;
  /** Delete a response */
  deleteResponse: (variableName: string) => void;
  /** Clear all responses for this guide */
  clearResponses: () => void;
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
 */
export function GuideResponseProvider({ guideId, children }: GuideResponseProviderProps) {
  // State to trigger re-renders when responses change
  const [responses, setResponses] = useState<Record<string, ResponseValue>>(() =>
    guideResponseStore.getAllResponses(guideId)
  );

  // Reload responses when guideId changes
  useEffect(() => {
    setResponses(guideResponseStore.getAllResponses(guideId));
  }, [guideId]);

  // Set a response - updates both storage and state, dispatches event for requirements re-check
  const setResponse = useCallback(
    (variableName: string, value: ResponseValue) => {
      guideResponseStore.setResponse(guideId, variableName, value);
      setResponses((prev) => ({ ...prev, [variableName]: value }));
      
      // Dispatch event to trigger requirements re-evaluation
      window.dispatchEvent(
        new CustomEvent('guide-response-changed', {
          detail: { guideId, variableName, value },
        })
      );
    },
    [guideId]
  );

  // Get a response from current state
  const getResponse = useCallback(
    (variableName: string): ResponseValue | undefined => {
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

  // Delete a response - dispatches event for requirements re-check
  const deleteResponse = useCallback(
    (variableName: string) => {
      guideResponseStore.deleteResponse(guideId, variableName);
      setResponses((prev) => {
        const next = { ...prev };
        delete next[variableName];
        return next;
      });
      
      // Dispatch event to trigger requirements re-evaluation
      window.dispatchEvent(
        new CustomEvent('guide-response-changed', {
          detail: { guideId, variableName, value: undefined },
        })
      );
    },
    [guideId]
  );

  // Clear all responses - dispatches event for requirements re-evaluation
  const clearResponses = useCallback(() => {
    guideResponseStore.clearResponses(guideId);
    setResponses({});

    // Dispatch event to trigger requirements re-evaluation
    window.dispatchEvent(
      new CustomEvent('guide-response-changed', {
        detail: { guideId, variableName: '*', value: undefined },
      })
    );
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
    }),
    [guideId, responses, setResponse, getResponse, hasResponse, deleteResponse, clearResponses]
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
export function useGuideResponse(variableName: string): ResponseValue | undefined {
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

