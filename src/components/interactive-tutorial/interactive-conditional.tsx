/**
 * Interactive Conditional Component
 *
 * Evaluates conditions and renders the appropriate branch (whenTrue or whenFalse).
 * Re-evaluates when relevant state changes (datasources, plugins, page location, etc.).
 * Supports two display modes:
 * - 'inline' (default): Renders children directly without wrapper
 * - 'section': Renders children inside an InteractiveSection with full "Do Section" functionality
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useInteractiveElements } from '../../interactive-engine';
import type { ParsedElement } from '../../docs-retrieval';
import { testIds } from '../../constants/testIds';
import type { ConditionalDisplayMode, ConditionalSectionConfig } from '../../types/json-guide.types';
import { InteractiveSection } from './interactive-section';
import { subscribeProgressEvent } from '../../global-state/progress-events';
import { logger } from '../../lib/logging';

export interface InteractiveConditionalProps {
  /** Conditions to evaluate (uses same syntax as requirements) */
  conditions: string[];
  /** Optional description (shown in debug mode, not to users) */
  description?: string;
  /** Display mode: 'inline' (default) or 'section' for section-styled rendering */
  display?: ConditionalDisplayMode;
  /** Target element for exists-reftarget condition (CSS selector or button text) */
  refTarget?: string;
  /** Section config for the 'pass' branch (only used when display is 'section') */
  whenTrueSectionConfig?: ConditionalSectionConfig;
  /** Section config for the 'fail' branch (only used when display is 'section') */
  whenFalseSectionConfig?: ConditionalSectionConfig;
  /** Children to render when ALL conditions pass */
  whenTrueChildren: ParsedElement[];
  /** Children to render when ANY condition fails */
  whenFalseChildren: ParsedElement[];
  /** Function to render a ParsedElement to React */
  renderElement: (element: ParsedElement, key: string) => React.ReactNode;
  /** Key prefix for rendered children */
  keyPrefix: string;
}

/**
 * Parse conditions array into a requirements string for the checker
 */
function conditionsToRequirementsString(conditions: string[]): string {
  return conditions.join(',');
}

/** True when conditions may flip after DOM updates (e.g. viz picker opens). */
function conditionsKeyNeedsDomWatch(conditionsKey: string): boolean {
  return conditionsKey.includes('exists-reftarget');
}

/**
 * Interactive conditional component that evaluates conditions and renders appropriate branch
 */
export function InteractiveConditional({
  conditions,
  description,
  display = 'inline',
  refTarget,
  whenTrueSectionConfig,
  whenFalseSectionConfig,
  whenTrueChildren,
  whenFalseChildren,
  renderElement,
  keyPrefix,
}: InteractiveConditionalProps) {
  const [conditionsPassed, setConditionsPassed] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const { checkRequirementsFromData } = useInteractiveElements();

  // Stable string identity for `conditions`. The parent passes a fresh array
  // on every render (parsed from JSON), so keying effects off the array would
  // tear down and re-attach the MutationObserver on every parent render. The
  // joined string is referentially stable as long as the underlying values are.
  const conditionsKey = useMemo(() => conditions.join(','), [conditions]);

  // Generate a stable ID for this conditional (derived from the stable key).
  const conditionalId = useMemo(
    () => conditionsKey.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'unknown',
    [conditionsKey]
  );

  // Track mounted state to prevent state updates after unmount
  // REACT: Track mounted state (R4)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Race guard: when multiple re-evaluations are in flight (MutationObserver
  // burst + step-completed + action-completed), only the most-recently-started
  // run is allowed to commit its result. Without this, an older slow promise
  // can overwrite the result of a newer faster one and flip the branch.
  const runIdRef = useRef(0);

  // Track scheduled re-eval timers so we can cancel them on unmount or when a
  // new schedule supersedes an older one. setTimeouts pile up otherwise.
  const reevalTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Convert conditions to requirements string format
  const requirementsString = conditionsToRequirementsString(conditions);

  // Function to evaluate conditions
  const evaluateConditions = useCallback(
    async (options?: { isReevaluation?: boolean }) => {
      if (!isMountedRef.current) {
        return;
      }

      // Only block the UI with a spinner on the first evaluation. Re-checks keep the
      // current branch mounted so steps can appear without a full content refresh.
      if (!options?.isReevaluation) {
        setIsChecking(true);
      }

      runIdRef.current += 1;
      const myRunId = runIdRef.current;

      try {
        // Create requirement data for checking
        // Use provided refTarget for exists-reftarget condition, fallback to placeholder
        const requirementData = {
          requirements: requirementsString,
          targetAction: 'conditional',
          refTarget: refTarget || 'conditional-block',
          targetValue: undefined,
          textContent: description || 'Conditional block',
          tagName: 'div',
        };

        const result = await checkRequirementsFromData(requirementData);

        // Drop the result if a newer run has started after we awaited - prevents
        // a stale "false" landing after a fresh "true" (and vice versa).
        if (!isMountedRef.current || myRunId !== runIdRef.current) {
          return;
        }
        setConditionsPassed(result.pass);
        setIsChecking(false);
      } catch (error) {
        logger.warn('Failed to evaluate conditional conditions', { error });
        if (!isMountedRef.current || myRunId !== runIdRef.current) {
          return;
        }
        // Default to false branch on error
        setConditionsPassed(false);
        setIsChecking(false);
      }
    },
    [requirementsString, checkRequirementsFromData, description, refTarget]
  );

  const needsDomWatch = conditionsKeyNeedsDomWatch(conditionsKey);

  // Stable ref to the latest evaluator. Lets long-lived subscriptions
  // (MutationObserver, event listeners) invoke the current evaluator without
  // having to include it in their dep arrays, which would tear down and
  // re-attach the subscription on every parent render.
  const evaluateRef = useRef(evaluateConditions);
  useEffect(() => {
    evaluateRef.current = evaluateConditions;
  }, [evaluateConditions]);

  const scheduleReevaluation = useCallback(() => {
    if (reevalTimerRef.current) {
      clearTimeout(reevalTimerRef.current);
    }
    const delay = needsDomWatch ? 250 : 100;
    reevalTimerRef.current = setTimeout(() => {
      reevalTimerRef.current = undefined;
      evaluateRef.current({ isReevaluation: true });
    }, delay);
  }, [needsDomWatch]);

  // Evaluate on mount and re-evaluate when relevant events occur
  useEffect(() => {
    // Initial evaluation (deferred to avoid synchronous setState in effect)
    const initialCheckTimeout = setTimeout(() => {
      evaluateRef.current();
    }, 0);

    // Listen for events that might change condition results
    const handleDataSourcesChanged = () => {
      scheduleReevaluation();
    };

    const handlePluginsChanged = () => {
      scheduleReevaluation();
    };

    const handleLocationChanged = () => {
      scheduleReevaluation();
    };

    // Re-evaluate after interactive steps complete - the step may have changed UI state
    // `interactive-action-completed` is dispatched from two places with two
    // different targets: interactive-state-manager fires on `document`, while
    // challenge-block fires on `window`. Subscribe to both so conditional
    // re-evaluation never depends on which path completed the action.
    const handleActionCompleted = () => {
      scheduleReevaluation();
    };

    // `pathfinder:progress` (kind === 'step', completed) replaces the legacy
    // `interactive-step-completed` event: step finishes → re-evaluate
    // exists-reftarget conditions.
    const unsubscribeProgress = subscribeProgressEvent((detail) => {
      if (detail.kind === 'step' && detail.completed) {
        scheduleReevaluation();
      }
    });

    window.addEventListener('datasources-changed', handleDataSourcesChanged);
    window.addEventListener('plugins-changed', handlePluginsChanged);
    window.addEventListener('popstate', handleLocationChanged);
    window.addEventListener('interactive-action-completed', handleActionCompleted);
    document.addEventListener('interactive-action-completed', handleActionCompleted);

    // REACT: cleanup subscriptions (R1)
    return () => {
      clearTimeout(initialCheckTimeout);
      if (reevalTimerRef.current) {
        clearTimeout(reevalTimerRef.current);
        reevalTimerRef.current = undefined;
      }
      unsubscribeProgress();
      window.removeEventListener('datasources-changed', handleDataSourcesChanged);
      window.removeEventListener('plugins-changed', handlePluginsChanged);
      window.removeEventListener('popstate', handleLocationChanged);
      window.removeEventListener('interactive-action-completed', handleActionCompleted);
      document.removeEventListener('interactive-action-completed', handleActionCompleted);
    };
  }, [scheduleReevaluation]);

  // exists-reftarget: re-check when Grafana portals/pickers inject new nodes (e.g. viz picker tabs).
  // We watch only structural changes (childList + subtree) - attribute churn from panel re-renders
  // is the noisy part and element-existence transitions are childList events anyway.
  // Depends only on `needsDomWatch` (effectively a one-shot boolean per conditional) - the latest
  // evaluator is reached via `evaluateRef` so re-renders never tear down the observer.
  useEffect(() => {
    if (!needsDomWatch) {
      return;
    }

    let debounceId: ReturnType<typeof setTimeout> | undefined;

    const observer = new MutationObserver(() => {
      if (debounceId) {
        clearTimeout(debounceId);
      }
      debounceId = setTimeout(() => {
        evaluateRef.current({ isReevaluation: true });
      }, 200);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      if (debounceId) {
        clearTimeout(debounceId);
      }
      observer.disconnect();
    };
  }, [needsDomWatch]);

  // Show loading state while checking
  if (isChecking && conditionsPassed === null) {
    return (
      <div className="interactive-conditional loading" data-testid={testIds.interactive.conditional(conditionalId)}>
        <div className="interactive-conditional-loading">
          <span className="interactive-conditional-spinner spinning">⟳</span>
          <span className="interactive-conditional-loading-text">Checking conditions...</span>
        </div>
      </div>
    );
  }

  // Select the appropriate branch and config based on condition result
  const childrenToRender = conditionsPassed ? whenTrueChildren : whenFalseChildren;
  const sectionConfig = conditionsPassed ? whenTrueSectionConfig : whenFalseSectionConfig;

  // If the selected branch has no children, skip rendering entirely
  if (childrenToRender.length === 0) {
    return null;
  }

  // Render as section if display mode is 'section'
  // Uses the full InteractiveSection component for "Do Section" button, step tracking, etc.
  if (display === 'section') {
    // Extract config values, using defaults if not provided
    const sectionTitle = sectionConfig?.title || (conditionsPassed ? 'When conditions pass' : 'When conditions fail');
    const sectionRequirements = sectionConfig?.requirements?.join(',');
    const sectionObjectives = sectionConfig?.objectives?.join(',');

    return (
      <div
        className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}`}
        data-testid={testIds.interactive.conditional(conditionalId)}
        data-conditions={conditions.join(', ')}
        data-passed={String(conditionsPassed)}
        data-display="section"
      >
        <InteractiveSection
          title={sectionTitle}
          id={`conditional-${conditionalId}-${conditionsPassed ? 'true' : 'false'}`}
          isSequence={true}
          requirements={sectionRequirements}
          objectives={sectionObjectives}
          className="conditional-section"
        >
          {childrenToRender.map((child, index) =>
            renderElement(child, `${keyPrefix}-${conditionsPassed ? 'true' : 'false'}-${index}`)
          )}
        </InteractiveSection>
      </div>
    );
  }

  // Render inline (default)
  return (
    <div
      className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}`}
      data-testid={testIds.interactive.conditional(conditionalId)}
      data-conditions={conditions.join(', ')}
      data-passed={String(conditionsPassed)}
    >
      {childrenToRender.map((child, index) =>
        renderElement(child, `${keyPrefix}-${conditionsPassed ? 'true' : 'false'}-${index}`)
      )}
    </div>
  );
}

// Add display name for debugging
InteractiveConditional.displayName = 'InteractiveConditional';
