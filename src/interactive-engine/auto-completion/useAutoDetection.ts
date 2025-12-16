/**
 * Shared hook for auto-detection of user actions in interactive elements
 *
 * Extracts common logic from InteractiveStep, InteractiveMultiStep, and InteractiveGuided
 * to reduce code duplication and ensure consistent behavior.
 *
 * @module useAutoDetection
 */

import { useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { usePluginContext } from '@grafana/data';
import { matchesStepAction, type DetectedActionEvent, type StepActionConfig } from './action-matcher';
import { getInteractiveConfig } from '../../constants/interactive-config';
import { getConfigWithDefaults } from '../../constants';
import { findButtonByText, querySelectorAllEnhanced } from '../../lib/dom';
import { resolveSelector } from '../../lib/dom/selector-resolver';
import { isCssSelector } from '../../lib/dom/selector-detector';

/**
 * Configuration for a single action to detect
 */
export interface ActionToDetect {
  targetAction: string;
  refTarget: string;
  targetValue?: string;
  /** Hint to show when form validation fails (for formfill with regex patterns) */
  formHint?: string;
}

/**
 * Result of action matching
 */
export interface MatchResult {
  matched: boolean;
  actionIndex: number;
  targetElement: HTMLElement | null;
  /** Form hint for formfill actions (passed through from config) */
  formHint?: string;
}

/**
 * Options for the useAutoDetection hook
 */
export interface UseAutoDetectionOptions {
  /** Array of actions to detect (for multi-step/guided) or single action */
  actions: ActionToDetect[];

  /** Whether auto-detection should be active */
  isEnabled: boolean;

  /** Whether step is already completed */
  isCompleted: boolean;

  /** Whether step is currently executing (section automation) */
  isExecuting?: boolean;

  /** Whether step is disabled */
  disabled?: boolean;

  /** For guided steps - only detect for the current action index */
  currentActionIndex?: number;

  /** Callback when an action is detected and matched */
  onActionDetected: (result: MatchResult, action: DetectedActionEvent) => void;

  /** Optional post-verification delay override */
  verificationDelay?: number;
}

/**
 * Resolve target element for coordinate-based matching
 *
 * Attempts to find the DOM element that corresponds to the action configuration.
 * Uses button text matching for button actions, CSS selectors for others.
 * Handles `grafana:` prefixed selectors by resolving them to CSS selectors first.
 */
export function resolveTargetElement(action: ActionToDetect): HTMLElement | null {
  const { targetAction, refTarget } = action;

  if (!refTarget) {
    return null;
  }

  // Resolve grafana: prefixed selectors to CSS selectors
  const resolvedSelector = resolveSelector(refTarget);

  try {
    if (targetAction === 'button') {
      // Try CSS selector first if it looks like one
      if (isCssSelector(resolvedSelector)) {
        const result = querySelectorAllEnhanced(resolvedSelector);
        const buttons = result.elements.filter((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
        if (buttons[0]) {
          return buttons[0];
        }
      }

      // Fall back to text matching (use original refTarget for text matching)
      const buttons = findButtonByText(refTarget);
      return buttons[0] || null;
    } else if (targetAction === 'highlight' || targetAction === 'hover') {
      const result = querySelectorAllEnhanced(resolvedSelector);
      return result.elements[0] || null;
    } else if (targetAction === 'formfill') {
      // Also resolve formfill selectors for element matching
      const result = querySelectorAllEnhanced(resolvedSelector);
      return result.elements[0] || null;
    }
    // Note: navigate doesn't use coordinate matching
  } catch (error) {
    console.warn('Failed to resolve target element for coordinate matching:', error);
  }

  return null;
}

/**
 * Hook for subscribing to auto-detected user actions
 *
 * Provides a unified way for interactive elements to detect user actions
 * and auto-complete steps when the user performs actions themselves.
 *
 * @example
 * ```tsx
 * useAutoDetection({
 *   actions: [{ targetAction: 'button', refTarget: 'Save', targetValue: undefined }],
 *   isEnabled: checker.isEnabled,
 *   isCompleted: isCompletedWithObjectives,
 *   onActionDetected: (result) => {
 *     if (result.matched) {
 *       markStepComplete();
 *     }
 *   },
 * });
 * ```
 */
export function useAutoDetection(options: UseAutoDetectionOptions): void {
  const {
    actions,
    isEnabled,
    isCompleted,
    isExecuting = false,
    disabled = false,
    currentActionIndex,
    onActionDetected,
    verificationDelay: customDelay,
  } = options;

  // Get plugin configuration for auto-detection settings
  const pluginContext = usePluginContext();
  const interactiveConfig = useMemo(() => {
    const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
    return getInteractiveConfig(config);
  }, [pluginContext?.meta?.jsonData]);

  // Stable callback ref to avoid effect re-runs
  const onActionDetectedRef = useRef(onActionDetected);

  // Update ref in useLayoutEffect to comply with React rules (refs shouldn't be updated during render)
  useLayoutEffect(() => {
    onActionDetectedRef.current = onActionDetected;
  }, [onActionDetected]);

  // AbortController for cleanup
  const abortControllerRef = useRef<AbortController | null>(null);

  // Memoize actions to avoid effect re-runs
  const actionsJson = useMemo(() => JSON.stringify(actions), [actions]);

  useEffect(() => {
    // Check if auto-detection should be active
    if (!interactiveConfig.autoDetection.enabled || !isEnabled || isCompleted || disabled) {
      return;
    }

    // For guided steps, only detect while executing
    if (currentActionIndex !== undefined && !isExecuting) {
      return;
    }

    // Create abort controller for async cleanup
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    const handleActionDetected = async (event: Event) => {
      // Check if aborted
      if (signal.aborted) {
        return;
      }

      const customEvent = event as CustomEvent<DetectedActionEvent>;
      const detectedAction = customEvent.detail;

      // Parse actions from memoized JSON
      const parsedActions: ActionToDetect[] = JSON.parse(actionsJson);

      // Determine which actions to check
      const actionsToCheck =
        currentActionIndex !== undefined
          ? [{ action: parsedActions[currentActionIndex], index: currentActionIndex }]
          : parsedActions.map((action, index) => ({ action, index }));

      // Check each action for a match
      for (const { action, index } of actionsToCheck) {
        if (!action || signal.aborted) {
          continue;
        }

        // Skip noop actions - they don't have a target element
        if (action.targetAction === 'noop') {
          continue;
        }

        // Resolve target element for coordinate matching
        const targetElement = resolveTargetElement(action);

        // Resolve grafana: prefixed selectors to CSS selectors for matching
        const resolvedRefTarget = resolveSelector(action.refTarget);

        // Build config for matching (use resolved selector)
        const stepConfig: StepActionConfig = {
          targetAction: action.targetAction as StepActionConfig['targetAction'],
          refTarget: resolvedRefTarget,
          targetValue: action.targetValue,
        };

        // Check if action matches
        const matches = matchesStepAction(detectedAction, stepConfig, targetElement);

        if (matches) {
          // Wait for DOM to settle before notifying (configurable delay)
          const delay = customDelay ?? interactiveConfig.autoDetection.verificationDelay;
          await new Promise((resolve) => setTimeout(resolve, delay));

          // Check if aborted during delay
          if (signal.aborted) {
            return;
          }

          // Notify callback (include formHint for formfill actions)
          onActionDetectedRef.current(
            {
              matched: true,
              actionIndex: index,
              targetElement,
              formHint: action.formHint,
            },
            detectedAction
          );

          return; // Only match one action per event
        }
      }
    };

    // Subscribe to user-action-detected events
    document.addEventListener('user-action-detected', handleActionDetected);

    return () => {
      document.removeEventListener('user-action-detected', handleActionDetected);
      // Abort any pending async operations
      abortControllerRef.current?.abort();
    };
  }, [
    interactiveConfig.autoDetection.enabled,
    interactiveConfig.autoDetection.verificationDelay,
    isEnabled,
    isCompleted,
    isExecuting,
    disabled,
    currentActionIndex,
    actionsJson,
    customDelay,
  ]);
}

/**
 * Hook for simple single-action auto-detection
 *
 * Convenience wrapper around useAutoDetection for steps with a single action.
 */
export function useSingleActionDetection(options: {
  targetAction: string;
  refTarget: string;
  targetValue?: string;
  isEnabled: boolean;
  isCompleted: boolean;
  isExecuting?: boolean;
  disabled?: boolean;
  onMatch: (detectedAction: DetectedActionEvent) => void;
}): void {
  const { targetAction, refTarget, targetValue, isEnabled, isCompleted, isExecuting, disabled, onMatch } = options;

  const handleActionDetected = useCallback(
    (result: MatchResult, action: DetectedActionEvent) => {
      if (result.matched) {
        onMatch(action);
      }
    },
    [onMatch]
  );

  useAutoDetection({
    actions: [{ targetAction, refTarget, targetValue }],
    isEnabled,
    isCompleted,
    isExecuting,
    disabled,
    onActionDetected: handleActionDetected,
  });
}
