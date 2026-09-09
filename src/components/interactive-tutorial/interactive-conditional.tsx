import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useInteractiveElements } from '../../interactive-engine';
import type { ParsedElement } from '../../docs-retrieval';
import { testIds } from '../../constants/testIds';
import type { ConditionalDisplayMode, ConditionalSectionConfig } from '../../types/json-guide.types';
import { isValidRequirement } from '../../types/requirements.types';
import { InteractiveSection } from './interactive-section';
import { subscribeProgressEvent } from '../../global-state/progress-events';
import { logger } from '../../lib/logging';
import { shouldNumberSectionChild } from './section-numbering';

export interface InteractiveConditionalProps {
  conditions: string[];
  description?: string;
  display?: ConditionalDisplayMode;
  refTarget?: string;
  whenTrueSectionConfig?: ConditionalSectionConfig;
  whenFalseSectionConfig?: ConditionalSectionConfig;
  whenTrueChildren: ParsedElement[];
  whenFalseChildren: ParsedElement[];
  renderElement: (element: ParsedElement, key: string) => React.ReactNode;
  keyPrefix: string;
}

function conditionsKeyNeedsDomWatch(conditionsKey: string): boolean {
  return conditionsKey.includes('exists-reftarget');
}

function markPlainNumberingChild(child: React.ReactNode): React.ReactNode {
  if (
    !React.isValidElement<{ className?: string }>(child) ||
    (typeof child.type !== 'string' && shouldNumberSectionChild(child))
  ) {
    return child;
  }

  const className = [child.props.className, 'section-numbering-plain'].filter(Boolean).join(' ');
  return React.cloneElement(child, { className });
}

function hasRenderableNode(node: React.ReactNode): boolean {
  if (node == null || typeof node === 'boolean') {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(hasRenderableNode);
  }
  if (typeof node === 'string') {
    return node.length > 0;
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node) && node.type === React.Fragment) {
    return hasRenderableNode(node.props.children);
  }
  return true;
}

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
  const [hasOccupiedNumberingSlot, setHasOccupiedNumberingSlot] = useState(false);
  const { checkRequirementsFromData } = useInteractiveElements();

  // Stable string identity for `conditions`. The parent passes a fresh array
  // on every render (parsed from JSON), so keying effects off the array would
  // tear down and re-attach the MutationObserver on every parent render. The
  // serialized form is referentially stable as long as the values are.
  const conditionsKey = useMemo(() => JSON.stringify(conditions), [conditions]);

  const conditionalId = useMemo(
    () => conditionsKey.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 50) || 'unknown',
    [conditionsKey]
  );

  // REACT: prevent post-unmount updates (R4)
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

  // Value-stable view of `conditions`, keyed off the serialized form so the
  // checker callback below is not rebuilt on every parent render.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on conditionsKey, which is the serialization of conditions
  const requirements = useMemo(() => conditions, [conditionsKey]);
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
        const requirementData = {
          requirements: requirements,
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
        setConditionsPassed(false);
        setIsChecking(false);
      }
    },
    [requirements, checkRequirementsFromData, description, refTarget]
  );

  const needsDomWatch = conditionsKeyNeedsDomWatch(conditionsKey);

  const childrenToRender = conditionsPassed === null ? [] : conditionsPassed ? whenTrueChildren : whenFalseChildren;
  const sectionConfig =
    conditionsPassed === null ? undefined : conditionsPassed ? whenTrueSectionConfig : whenFalseSectionConfig;
  const branchKey = conditionsPassed ? 'true' : 'false';
  const renderedChildren =
    conditionsPassed === null
      ? []
      : childrenToRender.map((child, index) => renderElement(child, `${keyPrefix}-${branchKey}-${index}`));
  const hasRenderableChildren = renderedChildren.some(hasRenderableNode);

  useEffect(() => {
    if (hasRenderableChildren) {
      // The rendered output is the only reliable occupancy signal; latch it
      // after commit so a later empty re-evaluation can retain its slot.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- monotonic render-history latch
      setHasOccupiedNumberingSlot(true);
    }
  }, [hasRenderableChildren]);

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

  useEffect(() => {
    // Initial evaluation (deferred to avoid synchronous setState in effect)
    const initialCheckTimeout = setTimeout(() => {
      evaluateRef.current();
    }, 0);

    const handleDataSourcesChanged = () => {
      scheduleReevaluation();
    };

    const handlePluginsChanged = () => {
      scheduleReevaluation();
    };

    const handleLocationChanged = () => {
      scheduleReevaluation();
    };

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

  if (childrenToRender.length === 0) {
    return hasOccupiedNumberingSlot ? <span hidden data-section-numbering-retained="true" /> : null;
  }

  // Parsed elements can still produce no React output (for example, a nested
  // conditional whose selected branch is empty). Do not leave a numbered
  // wrapper around an empty result; it would consume a counter slot.
  if (!hasRenderableChildren) {
    return hasOccupiedNumberingSlot ? <span hidden data-section-numbering-retained="true" /> : null;
  }

  // Section display preserves its own execution and numbering scope.
  if (display === 'section') {
    const sectionTitle = sectionConfig?.title || (conditionsPassed ? 'When conditions pass' : 'When conditions fail');
    // Collapse an empty array to undefined the way every json-parser converter
    // does: `[]` is truthy, and a truthy empty condition list makes
    // `useSectionRequirements` install a recheck loop for nothing.
    const sectionRequirements = sectionConfig?.requirements?.length ? sectionConfig.requirements : undefined;
    const executableSectionObjectives = sectionConfig?.objectives?.filter(isValidRequirement);
    const sectionObjectives = executableSectionObjectives?.length ? executableSectionObjectives : undefined;

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
          {renderedChildren}
        </InteractiveSection>
      </div>
    );
  }

  const alignedChildren = renderedChildren.map(markPlainNumberingChild);

  return (
    <div
      className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}`}
      data-testid={testIds.interactive.conditional(conditionalId)}
      data-conditions={conditions.join(', ')}
      data-passed={String(conditionsPassed)}
    >
      {alignedChildren}
    </div>
  );
}

InteractiveConditional.displayName = 'InteractiveConditional';
