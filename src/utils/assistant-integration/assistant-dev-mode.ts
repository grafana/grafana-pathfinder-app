/**
 * Assistant Dev Mode Utilities
 *
 * Provides mock implementations of Grafana Assistant functions for testing
 * the assistant integration in OSS environments where the assistant is not available.
 *
 * When assistant dev mode is enabled:
 * - isAssistantAvailable() returns Observable that emits true
 * - openAssistant() logs the prompt and context to console instead of opening
 *
 * This allows developers to test the text selection and popover UI locally.
 */

import { Observable, BehaviorSubject } from 'rxjs';
import { isAssistantAvailable, openAssistant, type ChatContextItem } from '@grafana/assistant';
import { isAssistantDevModeEnabledGlobal } from '../dev-mode';

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
  console.warn('=== Assistant Dev Mode ===');
  console.warn('Origin:', props.origin);
  console.warn('Prompt:', props.prompt || '(no prompt)');
  console.warn('AutoSend:', props.autoSend ?? true);
  console.warn('Context:', props.context);
  console.warn('=========================');
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
