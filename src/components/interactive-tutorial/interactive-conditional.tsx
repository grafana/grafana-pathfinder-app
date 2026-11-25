import { GuideContentKeyContext } from './guide-content-key-context';
import { getContentKey } from '../../global-state/content-key';
import {
  setGuideConditionalBranch,
  subscribeGuideIndexEvictions,
  getGuideIndexEvictionRevision,
} from '../../global-state/active-guide-index';
import { collectGuideCompletionEvidence, refreshGuidePercentageOnLoad } from '../../global-state/completion-store';
import { completedParsedBranch } from './conditional-branch-completion';
import { STEP_TYPE_PARSE_KEYS } from './step-type-registry';
import { ConditionalExecutionContext, SectionBranchContext } from './section-branch-context';
import { useInteractiveMode } from '../../global-state/interactive-mode-context';
import { useControllerChannel, useControllerConnected } from '../../global-state/controller-channel';
import { splitGuideScopedRequirements } from '../../requirements-manager';
import { conditionTokens } from '../../lib/condition-input';
import { Button } from '@grafana/ui';
import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useContext,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react';
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
  id?: string;
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

interface RenderedDomState {
  hasVisibleContent: boolean;
  isPending: boolean;
}

// Nested conditionals are transparent for occupancy: their loading state is
// pending, and hidden retained markers are not visible content of the parent.
function inspectRenderedDom(nodes: NodeListOf<ChildNode>): RenderedDomState {
  let hasVisibleContent = false;
  let isPending = false;

  for (const node of Array.from(nodes)) {
    if (node.nodeType === 8) {
      continue;
    }
    if (node.nodeType === 3) {
      hasVisibleContent ||= Boolean(node.textContent?.trim());
      continue;
    }
    if (!(node instanceof HTMLElement)) {
      hasVisibleContent ||= node.nodeType === 1;
      continue;
    }
    if (node.hidden) {
      continue;
    }
    if (!node.classList.contains('interactive-conditional')) {
      hasVisibleContent = true;
      continue;
    }
    if (node.classList.contains('loading')) {
      isPending = true;
      continue;
    }

    const nested = inspectRenderedDom(node.childNodes);
    hasVisibleContent ||= nested.hasVisibleContent;
    isPending ||= nested.isPending;
  }

  return { hasVisibleContent, isPending };
}

export function InteractiveConditional({
  id,
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
  const resolveOwnerContentKey = useContext(GuideContentKeyContext);
  const indexRevision = useSyncExternalStore(
    subscribeGuideIndexEvictions,
    getGuideIndexEvictionRevision,
    getGuideIndexEvictionRevision
  );
  const parentSection = useContext(SectionBranchContext);
  const reportParentExecution = useContext(ConditionalExecutionContext);
  const executingTokens = useRef(new Set<object>());
  const selectedBranchRef = useRef<boolean | null>(null);
  const completedSelection = useCallback((): boolean | null => {
    const evidence = collectGuideCompletionEvidence(resolveOwnerContentKey?.() ?? getContentKey());
    const complete = (branch: boolean) =>
      completedParsedBranch(branch ? whenTrueChildren : whenFalseChildren, evidence) ||
      evidence.some(
        (item) =>
          item.kind === 'mark-section-complete' &&
          item.blockId === `section-conditional-${id ?? keyPrefix}-${branch ? 'true' : 'false'}`
      );
    const selected = selectedBranchRef.current;
    if (selected !== null) {
      return complete(selected) ? selected : null;
    }
    return complete(true) ? true : complete(false) ? false : null;
  }, [resolveOwnerContentKey, whenTrueChildren, whenFalseChildren, id, keyPrefix]);
  const registerBranch = display === 'inline' ? parentSection?.register : undefined;
  const branchOwnerId = id ?? keyPrefix;
  const [conditionsPassed, setConditionsPassed] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [hasOccupiedNumberingSlot, setHasOccupiedNumberingSlot] = useState(false);
  const [emptyRenderToken, setEmptyRenderToken] = useState<object | null>(null);
  const conditionalWrapperRef = useRef<HTMLDivElement>(null);
  const { checkRequirementsFromData } = useInteractiveElements();
  const mode = useInteractiveMode();
  const channel = useControllerChannel();
  const connected = useControllerConnected();

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

      const completed = completedSelection();
      if (completed !== null) {
        selectedBranchRef.current = completed;
        setConditionsPassed(completed);
        setIsChecking(false);
        return;
      }
      if (executingTokens.current.size > 0) {
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

        const check = async () => {
          if (mode !== 'controller') {
            return checkRequirementsFromData(requirementData);
          }
          const { guideScoped, remaining } = splitGuideScopedRequirements(requirements);
          if (conditionTokens(guideScoped).length) {
            const local = await checkRequirementsFromData({
              ...requirementData,
              requirements: guideScoped,
            });
            if (!local.pass) {
              return local;
            }
          }
          if (!conditionTokens(remaining).length) {
            return { pass: true, verdict: 'satisfied' as const };
          }
          if (!channel || !connected) {
            return { pass: false, verdict: 'unavailable' as const };
          }
          return (
            (await channel.requestRequirementCheck(`conditional-${id ?? keyPrefix}`, remaining, {
              targetAction: 'conditional',
              refTarget: requirementData.refTarget,
              passive: true,
            })) ?? { pass: false, verdict: 'unavailable' as const }
          );
        };
        const result = await check();

        // Drop the result if a newer run has started after we awaited - prevents
        // a stale "false" landing after a fresh "true" (and vice versa).
        if (!isMountedRef.current || myRunId !== runIdRef.current) {
          return;
        }
        const completed = completedSelection();
        if (executingTokens.current.size > 0) {
          return;
        }
        if (completed !== null || (result.verdict !== 'unavailable' && result.verdict !== 'invalid')) {
          const selected = completed ?? result.pass;
          selectedBranchRef.current = selected;
          setConditionsPassed(selected);
        }
        setIsChecking(false);
      } catch (error) {
        logger.warn('Failed to evaluate conditional conditions', { error });
        if (!isMountedRef.current || myRunId !== runIdRef.current) {
          return;
        }
        setIsChecking(false);
      }
    },
    [
      requirements,
      checkRequirementsFromData,
      description,
      refTarget,
      mode,
      channel,
      connected,
      id,
      keyPrefix,
      completedSelection,
    ]
  );

  const needsDomWatch = mode !== 'controller' && conditionsKeyNeedsDomWatch(conditionsKey);

  const childrenToRender = useMemo(
    () => (conditionsPassed === null ? [] : conditionsPassed ? whenTrueChildren : whenFalseChildren),
    [conditionsPassed, whenFalseChildren, whenTrueChildren]
  );
  useLayoutEffect(() => {
    const contentKey = resolveOwnerContentKey?.() ?? getContentKey();
    const stepIds: string[] = [];
    const nestedConditionalIds: string[] = [];
    const visit = (elements: ParsedElement[]) => {
      for (const element of elements) {
        if (element.type === 'interactive-conditional') {
          nestedConditionalIds.push(element.props.id);
        } else if ((STEP_TYPE_PARSE_KEYS as readonly string[]).includes(element.type)) {
          if (typeof element.props.stepId === 'string') {
            stepIds.push(element.props.stepId);
          }
        } else {
          visit(element.children.filter((child): child is ParsedElement => typeof child !== 'string'));
        }
      }
    };
    visit(childrenToRender);
    setGuideConditionalBranch(
      contentKey,
      branchOwnerId,
      conditionsPassed === null ? undefined : { stepIds, nestedConditionalIds }
    );
    refreshGuidePercentageOnLoad(contentKey);
    return () => setGuideConditionalBranch(contentKey, branchOwnerId, undefined);
  }, [resolveOwnerContentKey, branchOwnerId, conditionsPassed, childrenToRender, indexRevision]);

  const sectionConfig =
    conditionsPassed === null ? undefined : conditionsPassed ? whenTrueSectionConfig : whenFalseSectionConfig;
  const branchKey = conditionsPassed ? 'true' : 'false';
  const branchSectionId = `conditional-${id ?? keyPrefix}-${branchKey}`;
  const rawChildren = useMemo(
    () => childrenToRender.map((child, index) => renderElement(child, `${keyPrefix}-${branchKey}-${index}`)),
    [childrenToRender, renderElement, keyPrefix, branchKey]
  );
  useLayoutEffect(() => {
    registerBranch?.(branchOwnerId, conditionsPassed === null ? undefined : rawChildren);
    return () => registerBranch?.(branchOwnerId, undefined);
  }, [registerBranch, branchOwnerId, conditionsPassed, rawChildren]);
  const renderedChildren = display === 'inline' && parentSection ? rawChildren.map(parentSection.enhance) : rawChildren;
  const hasRenderableChildren = renderedChildren.some(hasRenderableNode);
  // A later authoring update must be allowed to remount a branch previously
  // observed as empty, even when the condition verdict itself did not change.
  const renderToken = useMemo(
    () => ({ branchKey, childrenToRender, display, keyPrefix }),
    [branchKey, childrenToRender, display, keyPrefix]
  );
  const isEmptyAfterCommit = emptyRenderToken === renderToken;

  useEffect(() => {
    const wrapper = conditionalWrapperRef.current;
    if (!wrapper || !hasRenderableChildren) {
      return;
    }

    const syncRenderedOutput = () => {
      if (!isMountedRef.current) {
        return;
      }
      const renderedDomState = inspectRenderedDom(wrapper.childNodes);
      if (!renderedDomState.hasVisibleContent && !renderedDomState.isPending) {
        setEmptyRenderToken((previous) => (previous === renderToken ? previous : renderToken));
        return;
      }

      if (renderedDomState.hasVisibleContent) {
        setEmptyRenderToken(null);
        setHasOccupiedNumberingSlot(true);
      }
    };

    syncRenderedOutput();
    const observer = new MutationObserver(syncRenderedOutput);
    observer.observe(wrapper, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [hasRenderableChildren, renderToken]);

  // Stable ref to the latest evaluator. Lets long-lived subscriptions
  // (MutationObserver, event listeners) invoke the current evaluator without
  // having to include it in their dep arrays, which would tear down and
  // re-attach the subscription on every parent render.
  const evaluateRef = useRef(evaluateConditions);
  const reportExecution = useCallback(
    (token: object, executing: boolean) => {
      if (executing) {
        executingTokens.current.add(token);
      } else {
        executingTokens.current.delete(token);
        void evaluateRef.current({ isReevaluation: true });
      }
      reportParentExecution?.(token, executing);
    },
    [reportParentExecution]
  );
  useEffect(() => {
    evaluateRef.current = evaluateConditions;
  }, [evaluateConditions]);

  useEffect(() => {
    const timer = setTimeout(() => void evaluateConditions({ isReevaluation: true }), 0);
    return () => {
      clearTimeout(timer);
      runIdRef.current += 1;
    };
  }, [evaluateConditions]);

  useEffect(() => {
    if (mode !== 'controller' || !connected) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await evaluateRef.current({ isReevaluation: true });
      if (active) {
        timer = setTimeout(() => void poll(), 5000);
      }
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, connected]);

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
      if (detail.kind !== 'guide') {
        scheduleReevaluation();
      }
    });

    window.addEventListener('datasources-changed', handleDataSourcesChanged);
    window.addEventListener('plugins-changed', handlePluginsChanged);
    window.addEventListener('popstate', handleLocationChanged);
    window.addEventListener('hashchange', handleLocationChanged);
    document.addEventListener('input', handleActionCompleted);
    document.addEventListener('change', handleActionCompleted);
    window.addEventListener('guide-response-changed', handleActionCompleted);
    window.addEventListener('interactive-action-completed', handleActionCompleted);
    document.addEventListener('interactive-action-completed', handleActionCompleted);

    // REACT: cleanup subscriptions (R1)
    return () => {
      if (reevalTimerRef.current) {
        clearTimeout(reevalTimerRef.current);
        reevalTimerRef.current = undefined;
      }
      unsubscribeProgress();
      window.removeEventListener('datasources-changed', handleDataSourcesChanged);
      window.removeEventListener('plugins-changed', handlePluginsChanged);
      window.removeEventListener('popstate', handleLocationChanged);
      window.removeEventListener('hashchange', handleLocationChanged);
      document.removeEventListener('input', handleActionCompleted);
      document.removeEventListener('change', handleActionCompleted);
      window.removeEventListener('guide-response-changed', handleActionCompleted);
      window.removeEventListener('interactive-action-completed', handleActionCompleted);
      document.removeEventListener('interactive-action-completed', handleActionCompleted);
    };
  }, [scheduleReevaluation]);

  useEffect(() => {
    if (!needsDomWatch) {
      return;
    }

    let debounceId: ReturnType<typeof setTimeout> | undefined;

    const observer = new MutationObserver((mutations) => {
      const externalChange = mutations.some(({ target }) => {
        const element = target instanceof Element ? target : target.parentElement;
        return !element?.closest('.interactive-conditional');
      });
      if (!externalChange || debounceId !== undefined) {
        return;
      }
      debounceId = setTimeout(() => {
        debounceId = undefined;
        evaluateRef.current({ isReevaluation: true });
      }, 200);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return () => {
      if (debounceId) {
        clearTimeout(debounceId);
      }
      observer.disconnect();
    };
  }, [needsDomWatch]);

  if (conditionsPassed === null) {
    return (
      <div className="interactive-conditional loading" data-testid={testIds.interactive.conditional(conditionalId)}>
        <div className="interactive-conditional-loading">
          {isChecking ? (
            <>
              <span className="interactive-conditional-spinner spinning">⟳</span>
              <span className="interactive-conditional-loading-text">Checking conditions...</span>
            </>
          ) : (
            <>
              <span role="status">Unable to check which instructions apply.</span>
              <Button size="sm" variant="secondary" onClick={() => void evaluateConditions()}>
                Retry
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (childrenToRender.length === 0) {
    return hasOccupiedNumberingSlot ? (
      <span hidden className="section-numbering-retained" data-section-numbering-retained="true" />
    ) : null;
  }

  // A direct null/false result has no child lifecycle to preserve, so it can
  // use the same null/retained fast path as an empty parsed branch.
  if (!hasRenderableChildren) {
    return hasOccupiedNumberingSlot ? (
      <span hidden className="section-numbering-retained" data-section-numbering-retained="true" />
    ) : null;
  }

  // Nested components stay mounted when their DOM settles empty so their own
  // requirement listeners can make them visible again. The direct wrapper
  // attributes let the numbered <li> hide or retain its slot without
  // unmounting that subtree.
  const isEmptyNumberingState = isEmptyAfterCommit && !hasOccupiedNumberingSlot;
  const isRetainedNumberingState = isEmptyAfterCommit && hasOccupiedNumberingSlot;
  const numberingStateClass = isEmptyNumberingState
    ? ' section-numbering-empty'
    : isRetainedNumberingState
      ? ' section-numbering-retained'
      : '';

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
        ref={conditionalWrapperRef}
        className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}${numberingStateClass}`}
        data-testid={testIds.interactive.conditional(conditionalId)}
        data-conditions={conditions.join(', ')}
        data-passed={String(conditionsPassed)}
        data-display="section"
        data-section-numbering-empty={isEmptyNumberingState ? 'true' : undefined}
        data-section-numbering-retained={isRetainedNumberingState ? 'true' : undefined}
      >
        <InteractiveSection
          key={branchSectionId}
          title={sectionTitle}
          id={branchSectionId}
          isSequence={true}
          requirements={sectionRequirements}
          objectives={sectionObjectives}
          className="conditional-section"
        >
          <ConditionalExecutionContext.Provider value={reportExecution}>
            {renderedChildren}
          </ConditionalExecutionContext.Provider>
        </InteractiveSection>
      </div>
    );
  }

  const alignedChildren = renderedChildren.map(markPlainNumberingChild);

  return (
    <div
      ref={conditionalWrapperRef}
      className={`interactive-conditional ${conditionsPassed ? 'conditions-passed' : 'conditions-failed'}${numberingStateClass}`}
      data-testid={testIds.interactive.conditional(conditionalId)}
      data-conditions={conditions.join(', ')}
      data-passed={String(conditionsPassed)}
      data-section-numbering-empty={isEmptyNumberingState ? 'true' : undefined}
      data-section-numbering-retained={isRetainedNumberingState ? 'true' : undefined}
    >
      <ConditionalExecutionContext.Provider value={reportExecution}>
        {alignedChildren}
      </ConditionalExecutionContext.Provider>
    </div>
  );
}

InteractiveConditional.displayName = 'InteractiveConditional';
