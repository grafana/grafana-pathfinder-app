/**
 * Assistant Dev Mode Utilities
 *
 * Provides mock implementations of Grafana Assistant functions for testing
 * the assistant integration in OSS environments where the assistant is not available.
 *
 * When assistant dev mode is enabled:
 * - isAssistantAvailable() returns Observable that emits true
 * - openAssistant() logs the prompt and context to console instead of opening
 * - useInlineAssistant() returns a mock that logs instead of generating
 *
 * This allows developers to test the text selection and popover UI locally.
 *
 * Dumps go through logger.debug (console-only): prompt/context/systemPrompt
 * must never reach Faro-backed log levels, which ship to remote telemetry.
 */

import { useState, useEffect, useCallback } from 'react';
import { Observable, BehaviorSubject } from 'rxjs';
import {
  isAssistantAvailable,
  openAssistant,
  type ChatContextItem,
  type InlineAssistantOptions,
  type InlineAssistantResult,
} from '@grafana/assistant';
import { isAssistantDevModeEnabledGlobal } from '../../utils/dev-mode';
import { logger } from '../../lib/logging';

// Create a persistent BehaviorSubject for mock availability
// This ensures the mock stays active and doesn't get overridden
const mockAvailabilitySubject = new BehaviorSubject<boolean>(true);

/**
 * Mock implementation of isAssistantAvailable that always returns true
 * Uses BehaviorSubject to maintain a stable true value
 */
const getMockIsAssistantAvailable = (): Observable<boolean> => {
  return mockAvailabilitySubject.asObservable();
};

/**
 * Mock implementation of openAssistant that logs to console
 */
const getMockOpenAssistant = (props: {
  origin: string;
  prompt?: string;
  context?: ChatContextItem[];
  autoSend?: boolean;
}): void => {
  logger.debug('=== Assistant Dev Mode ===');
  logger.debug('Origin', { origin: props.origin });
  logger.debug('Prompt', { prompt: props.prompt || '(no prompt)' });
  logger.debug('AutoSend', { autoSend: props.autoSend ?? true });
  logger.debug('Context', { context: props.context });
  logger.debug('=========================');
};

/**
 * Wrapper for isAssistantAvailable that returns mock or real implementation
 * based on dev mode setting
 */
export const getIsAssistantAvailable = (): Observable<boolean> => {
  const devModeEnabled = isAssistantDevModeEnabledGlobal();

  if (devModeEnabled) {
    return getMockIsAssistantAvailable();
  }
  return isAssistantAvailable();
};

export const useIsAssistantAvailable = (): boolean => {
  const [isAvailable, setIsAvailable] = useState(false);
  useEffect(() => {
    const subscription = getIsAssistantAvailable().subscribe((available: boolean) => {
      setIsAvailable(available);
    });
    return () => subscription.unsubscribe();
  }, []);
  return isAvailable;
};

/**
 * Wrapper for openAssistant that uses mock or real implementation
 * based on dev mode setting
 */
export const getOpenAssistant = (props: {
  origin: string;
  prompt?: string;
  context?: ChatContextItem[];
  autoSend?: boolean;
}): void => {
  const devModeEnabled = isAssistantDevModeEnabledGlobal();

  if (devModeEnabled) {
    getMockOpenAssistant(props);
    return;
  }
  openAssistant(props);
};

/**
 * Mock implementation of useInlineAssistant hook for dev mode
 * This is a proper React hook that manages state and allows re-generation
 */
export const useMockInlineAssistant = (): InlineAssistantResult => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState<Error | null>(null);

  const generate = useCallback(async (options: InlineAssistantOptions) => {
    logger.debug('=== Inline Assistant Dev Mode ===');
    logger.debug('Origin', { origin: options.origin });
    logger.debug('Prompt', { prompt: options.prompt });
    logger.debug('System Prompt', { systemPrompt: options.systemPrompt || '(none)' });
    logger.debug('=====================================');

    // Set isGenerating to true at the start
    setIsGenerating(true);
    setError(null);

    try {
      // Simulate a successful generation with a mock response
      const mockResponse = `[MOCK] Customized version of your ${options.origin.split('/').pop()}`;
      setContent(mockResponse);

      // Call onComplete callback if provided
      if (options.onComplete) {
        // Simulate async delay
        setTimeout(() => {
          options.onComplete!(mockResponse);
          // Set isGenerating back to false after completion
          setIsGenerating(false);
        }, 500);
      } else {
        // If no callback, reset immediately
        setIsGenerating(false);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setIsGenerating(false);
      if (options.onError) {
        options.onError(error);
      }
    }
  }, []);

  const cancel = useCallback(() => {
    logger.debug('[Dev Mode] Cancel called');
    setIsGenerating(false);
  }, []);

  const reset = useCallback(() => {
    logger.debug('[Dev Mode] Reset called');
    setIsGenerating(false);
    setContent('');
    setError(null);
  }, []);

  return {
    generate,
    isGenerating,
    content,
    error,
    cancel,
    reset,
  };
};
