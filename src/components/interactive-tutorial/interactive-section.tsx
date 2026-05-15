import React, { useState, useCallback, useMemo, useEffect, useReducer, useRef } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import { useInteractiveElements, ActionMonitor } from '../../interactive-engine';
import { useStepChecker } from '../../requirements-manager';
import { useIsAlignmentPaused, useAlignmentStartingLocation } from '../../global-state/alignment-pending-context';
import { InteractiveStep, resetStepCounter } from './interactive-step';
import { InteractiveMultiStep, resetMultiStepCounter } from './interactive-multi-step';
import { InteractiveGuided, resetGuidedCounter } from './interactive-guided';
import { InteractiveQuiz, resetQuizCounter } from './interactive-quiz';
import { TerminalStep, resetTerminalStepCounter } from './terminal-step';
import { TerminalConnectStep, resetTerminalConnectStepCounter } from './terminal-connect-step';
import { CodeBlockStep, resetCodeBlockStepCounter } from './code-block-step';
import { resetChallengeCounter } from './challenge-block';
import { wrapSectionChildrenForNumbering } from './section-numbering';
// Re-exports preserved for back-compat with `section-numbering.test.tsx`,
// which imports both helpers from this module. New code should import
// directly from `./section-numbering`.
export { shouldNumberSectionChild, wrapSectionChildrenForNumbering } from './section-numbering';

// ⚠ TRACKED STEP TYPE REGISTRY — site 3 of 4 (orchestration site).
// Adding a new interactive step component type requires updates in 4
// places. The schemas now live in `step-type-registry.ts`; this lookup
// map zips each component identity to its schema. The other three
// sites are unchanged:
//   1. content-renderer.tsx INTERACTIVE_STEP_TYPES
//   2. content-renderer.tsx SECTION_TRACKED_STEP_TYPES
//   3. ./step-type-registry.ts STEP_TYPE_SCHEMAS (consumed here)
//   4. ./section-child-classifier.ts INTERACTIVE_STEP_COMPONENT_TYPES
// See .cursor/rules/tracked-step-types.mdc for the full checklist.
// Lazily initialised — the lookup Map is built on first call rather
// than at module load. This mirrors the call-time lookup pattern in
// `shouldNumberSectionChild` and exists for the same reason: the
// docs-retrieval barrel imports content-renderer, which re-imports
// the interactive-tutorial index, so a top-level
// `new Map([[CodeBlockStep, ...], ...])` would resolve component
// identities to undefined under cycle load order.
let stepTypeLookup: ReadonlyMap<React.ComponentType<any>, StepTypeSchema> | undefined;
function getStepTypeLookup(): ReadonlyMap<React.ComponentType<any>, StepTypeSchema> {
  if (!stepTypeLookup) {
    stepTypeLookup = new Map<React.ComponentType<any>, StepTypeSchema>([
      [InteractiveStep, INTERACTIVE_STEP_SCHEMA],
      [InteractiveMultiStep, INTERACTIVE_MULTISTEP_SCHEMA],
      [InteractiveGuided, INTERACTIVE_GUIDED_SCHEMA],
      [InteractiveQuiz, INTERACTIVE_QUIZ_SCHEMA],
      [TerminalStep, TERMINAL_STEP_SCHEMA],
      [TerminalConnectStep, TERMINAL_CONNECT_STEP_SCHEMA],
      [CodeBlockStep, CODE_BLOCK_STEP_SCHEMA],
    ]);
  }
  return stepTypeLookup;
}

/** Resolve the schema for a child element, or `undefined` if the child
 *  is not a tracked step type (markdown / media / wrapper). */
function lookupStepSchema(child: React.ReactNode): StepTypeSchema | undefined {
  if (!React.isValidElement(child)) {
    return undefined;
  }
  return getStepTypeLookup().get(child.type as React.ComponentType<any>);
}
import { reportAppInteraction, UserInteraction, getSourceDocument, calculateStepCompletion } from '../../lib/analytics';
import {
  interactiveStepStorage,
  sectionCollapseStorage,
  interactiveCompletionStorage,
  sectionAcknowledgementStorage,
} from '../../lib/user-storage';
import { INTERACTIVE_CONFIG, getInteractiveConfig } from '../../constants/interactive-config';
import { getConfigWithDefaults } from '../../constants';
import type { InteractiveSectionProps, StepInfo } from '../../types/component-props.types';
import { testIds } from '../../constants/testIds';
import { getContentKey } from './get-content-key';
import {
  analyzeAcknowledgement,
  getResumeInfo as computeResumeInfo,
  computeStepEligibility,
  type AcknowledgementAnalysis,
} from './step-section-utils';
import { classifySectionChild } from './section-child-classifier';
import { useSectionAutoCollapse } from './hooks/use-section-auto-collapse';
import { useSectionScroll } from './hooks/use-section-scroll';
import { deriveSectionState, initialSectionState, restoreFromStorage, sectionReducer } from './section-state';
import {
  getDocumentStepPosition,
  getTotalDocumentSteps,
  nextSectionCounter,
  registerSectionSteps,
  resetRegistry,
} from './section-registry';
import {
  CODE_BLOCK_STEP_SCHEMA,
  type EnhanceContext,
  INTERACTIVE_GUIDED_SCHEMA,
  INTERACTIVE_MULTISTEP_SCHEMA,
  INTERACTIVE_QUIZ_SCHEMA,
  INTERACTIVE_STEP_SCHEMA,
  type StepTypeSchema,
  TERMINAL_CONNECT_STEP_SCHEMA,
  TERMINAL_STEP_SCHEMA,
} from './step-type-registry';

// Re-exports preserved for back-compat with `content-renderer.tsx`
// and `use-standalone-persistence.ts`. New code should import directly
// from `./section-registry`.
export { registerSectionSteps, getTotalDocumentSteps, getDocumentStepPosition } from './section-registry';

// Reset every counter (registry + offsets + per-step-type anonymous-ID
// counters). Called when new content loads. The registry's own state
// lives in `./section-registry`; this function adds the step-module
// resets that depend on imports a pure registry module shouldn't carry.
export function resetInteractiveCounters() {
  resetRegistry();
  // Reset anonymous step ID counters across all step types
  resetStepCounter();
  resetMultiStepCounter();
  resetGuidedCounter();
  resetQuizCounter();
  resetTerminalStepCounter();
  resetTerminalConnectStepCounter();
  resetCodeBlockStepCounter();
  resetChallengeCounter();
}

export function InteractiveSection({
  title,
  description,
  children,
  isSequence = false,
  requirements,
  objectives,
  hints,
  onComplete,
  disabled = false,
  className,
  id, // HTML id attribute from parsed content
  autoCollapse, // Author control for auto-collapse behavior
}: InteractiveSectionProps) {
  // Use provided HTML id or generate sequential fallback
  const sectionId = useMemo(() => {
    if (id) {
      // Use the HTML id attribute, prefixed with section- for consistency
      const generatedId = `section-${id}`;
      return generatedId;
    }
    // Fallback to sequential ID for sections without explicit id
    const generatedId = `section-${nextSectionCounter()}`;
    return generatedId;
  }, [id]);

  // Sequential state management.
  //
  // The reducer owns the completion-and-acknowledgement state machine
  // (Phase 4 of #842 — the gate itself isn't enabled yet; this commit
  // is a pure structural move). Orthogonal UI flags stay as useState
  // slots; they don't interact with what "completed" means.
  //
  // Local aliases `completedSteps` and `currentStepIndex` preserve the
  // names used by every existing reader in this file, so the diff for
  // the surrounding code stays focused on writes → dispatches.
  const [sectionState, dispatch] = useReducer(sectionReducer, initialSectionState);
  const completedSteps = sectionState.completed;
  const currentStepIndex = sectionState.cursor;
  const [currentlyExecutingStep, setCurrentlyExecutingStep] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [executingStepNumber, setExecutingStepNumber] = useState(0); // Track which step is being executed (1-indexed for display)
  const [resetTrigger, setResetTrigger] = useState(0); // Trigger to reset child steps

  // Section requirements state - tracks whether section-level requirements are met
  const [sectionRequirementsStatus, setSectionRequirementsStatus] = useState<{
    checking: boolean;
    passed: boolean;
    error?: string;
  }>({ checking: !!requirements, passed: !requirements }); // If no requirements, default to passed

  // Scroll-tracking state + auto-scroll behaviour are owned by
  // `useSectionScroll`. Returns three callbacks the runner uses to
  // gate its programmatic scroll window. (Pattern F.)
  const { scrollToStep, beginProgrammaticScroll, endProgrammaticScroll } = useSectionScroll({ isRunning });

  // --- Persistence helpers (restore across refresh) ---
  // Content key resolved via shared utility to ensure persist/restore consistency

  // Detect if we're in preview mode (block editor preview)
  // Preview mode uses a special URL pattern: block-editor://preview/{guide-id}
  const isPreviewMode = useMemo(() => {
    const contentKey = getContentKey();
    return contentKey.indexOf('devtools') > -1 || contentKey.startsWith('block-editor://preview/');
  }, []);

  // Persist completed steps using new user storage system.
  //
  // Preview-mode sandbox (#842, Bug 3): in block-editor preview the section
  // is a throwaway render — we must not pollute localStorage with progress
  // tied to a `block-editor://preview/...` content key. Skip every write
  // while preserving the in-window event dispatch so listeners that drive
  // ephemeral UI (useGuidePreviewProgress's "hasProgress" → Reset guide
  // button visibility) still react during the same session.
  const persistCompletedSteps = useCallback(
    (ids: Set<string>) => {
      const contentKey = getContentKey();

      let percentage: number | undefined;
      if (!isPreviewMode) {
        interactiveStepStorage.setCompleted(contentKey, sectionId, ids);

        // Compute unified completion percentage across ALL sections (including standalone)
        const docTotal = getTotalDocumentSteps();
        const allCompleted = interactiveStepStorage.countAllCompleted(contentKey);
        percentage = docTotal > 0 ? Math.round((allCompleted / docTotal) * 100) : undefined;
        if (percentage !== undefined) {
          interactiveCompletionStorage.set(contentKey, percentage);
        }
      }

      // Dispatch event to notify that progress was saved (for reset button visibility).
      // Fires in preview mode too — useGuidePreviewProgress depends on it.
      if (ids.size > 0 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('interactive-progress-saved', {
            detail: { contentKey, hasProgress: true, completionPercentage: percentage },
          })
        );
      }
    },
    [sectionId, isPreviewMode]
  );

  // Use ref for cancellation to avoid closure issues
  const isCancelledRef = useRef(false);

  // Track mounted state for section requirements checking
  const sectionMountedRef = useRef(true);
  useEffect(() => {
    sectionMountedRef.current = true;
    return () => {
      sectionMountedRef.current = false;
    };
  }, []);

  // Store refs to multistep components for section-level execution
  const multiStepRefs = useRef<Map<string, { executeStep: () => Promise<boolean> }>>(new Map());

  // Store refs to regular step components for skip functionality
  const stepRefs = useRef<Map<string, { executeStep: () => Promise<boolean>; markSkipped?: () => void }>>(new Map());

  // Get the interactive functions from the hook
  const {
    executeInteractiveAction,
    startSectionBlocking,
    stopSectionBlocking,
    verifyStepResult,
    checkRequirementsFromData,
  } = useInteractiveElements();

  // Check section-level requirements on mount and when relevant state changes
  const checkSectionRequirements = useCallback(async () => {
    if (!requirements || !sectionMountedRef.current) {
      setSectionRequirementsStatus({ checking: false, passed: true });
      return;
    }

    setSectionRequirementsStatus((prev) => ({ ...prev, checking: true }));

    try {
      const sectionRequirementsData = {
        requirements: requirements,
        targetaction: 'section',
        reftarget: sectionId,
        targetvalue: undefined,
        textContent: title || 'Interactive section',
        tagName: 'section',
      };

      const result = await checkRequirementsFromData(sectionRequirementsData);

      if (sectionMountedRef.current) {
        setSectionRequirementsStatus({
          checking: false,
          passed: result.pass,
          error: result.error?.[0]?.error || (result.pass ? undefined : 'Requirements not met'),
        });
      }
    } catch (error) {
      console.warn('Section requirements check failed:', error);
      if (sectionMountedRef.current) {
        // On error, allow section to proceed (fail open for better UX)
        setSectionRequirementsStatus({ checking: false, passed: true });
      }
    }
  }, [requirements, sectionId, title, checkRequirementsFromData]);

  // Initial requirements check and re-check on relevant events
  useEffect(() => {
    if (!requirements) {
      return;
    }

    // Initial check
    checkSectionRequirements();

    // Re-check when relevant events occur
    const handleDataSourcesChanged = () => checkSectionRequirements();
    const handlePluginsChanged = () => checkSectionRequirements();
    const handleLocationChanged = () => checkSectionRequirements();

    window.addEventListener('datasources-changed', handleDataSourcesChanged);
    window.addEventListener('plugins-changed', handlePluginsChanged);
    window.addEventListener('popstate', handleLocationChanged);

    // Re-check when a section completes (for section-completed: dependencies)
    const handleSectionCompleted = () => checkSectionRequirements();
    document.addEventListener('section-completed', handleSectionCompleted);

    // Re-check periodically to catch other state changes
    const intervalId = setInterval(checkSectionRequirements, 5000);

    // REACT: cleanup subscriptions (R1)
    return () => {
      window.removeEventListener('datasources-changed', handleDataSourcesChanged);
      window.removeEventListener('plugins-changed', handlePluginsChanged);
      window.removeEventListener('popstate', handleLocationChanged);
      document.removeEventListener('section-completed', handleSectionCompleted);
      clearInterval(intervalId);
    };
  }, [requirements, checkSectionRequirements]);

  // Create cancellation handler
  const handleSectionCancel = useCallback(() => {
    isCancelledRef.current = true; // Set ref for immediate access
    // The running loop will detect this and break
  }, []);

  // Use executeInteractiveAction directly (no wrapper needed)
  // Section-level blocking is managed separately at the section level

  // Extract step information from children. Iterates the children once,
  // resolves each child to its `StepTypeSchema` via STEP_TYPE_LOOKUP,
  // and builds the StepInfo entry from the schema's `toStepInfoExtension`.
  // Non-step children (markdown / media / wrapper) are skipped.
  const stepComponents = useMemo((): StepInfo[] => {
    const steps: StepInfo[] = [];
    let stepIndex = 0;

    React.Children.forEach(children, (child) => {
      const schema = lookupStepSchema(child);
      if (!schema) {
        return;
      }
      const stepId = `${sectionId}-${schema.idPrefix}-${stepIndex + 1}`;
      const extension = schema.toStepInfoExtension((child as React.ReactElement<any>).props);
      steps.push({
        stepId,
        element: child as React.ReactElement<any>,
        index: stepIndex,
        ...extension,
      });
      stepIndex++;
    });

    return steps;
  }, [children, sectionId]);

  // Acknowledgement-gate analysis (issue #842). Classifies each direct
  // child by document-order kind and decides whether the section needs
  // an explicit "Mark section as complete" click before completing.
  //
  // - Trailing passive content after the last interactive step → gate
  //   fires (`needsAcknowledgement: true`).
  // - 100% passive section → gate fires + `isAllPassive: true`; the
  //   only available action is Mark.
  // - Mid-section passive sandwiched between interactives → no gate.
  // - All interactive (or empty) → no gate.
  //
  // Recomputes only on child-tree changes. The classification of each
  // child is stable across renders if the React element identity is.
  const gateAnalysis: AcknowledgementAnalysis = useMemo(() => {
    const kinds = React.Children.toArray(children).map(classifySectionChild);
    return analyzeAcknowledgement(kinds);
  }, [children]);

  // Load persisted completion + acknowledgement state on first mount only
  // (#842, Bug 4 fix).
  //
  // The previous version re-fired whenever `stepComponents` changed
  // reference — which happens routinely because the parent renderer
  // produces fresh children on every render. Restoring twice is idempotent
  // in steady state but masked race conditions during block-editor preview
  // remounts. The `didRestoreRef` guard makes the contract obvious:
  // "restore exactly once per InteractiveSection instance."
  //
  // Preview-mode sandbox (#842, Bug 3): block-editor previews start fresh
  // every session — we skip the read entirely so stale entries from prior
  // buggy versions cannot resurrect.
  //
  // Acknowledgement-gate plumbing (#842, Phase 4): we always read the
  // ack storage namespace so phase 5 can switch the gate on without
  // touching this effect. With the gate inert (phase 4), the read value
  // flows through unchanged.
  const didRestoreRef = useRef(false);
  useEffect(() => {
    if (didRestoreRef.current) {
      return;
    }
    didRestoreRef.current = true;
    if (isPreviewMode) {
      return;
    }
    const contentKey = getContentKey();
    let cancelled = false;
    Promise.all([
      interactiveStepStorage.getCompleted(contentKey, sectionId),
      sectionAcknowledgementStorage.get(contentKey, sectionId),
    ]).then(([restoredCompleted, restoredAck]) => {
      if (cancelled) {
        return;
      }
      // Phase 5 (#842): the gate is on. The mount-only effect deps
      // are deliberately empty — gateAnalysis is closed over for the
      // migration decision only, evaluated once on first mount.
      const { state: restoredState, migrated } = restoreFromStorage({
        completed: restoredCompleted,
        acknowledged: restoredAck,
        stepComponents,
        gate: gateAnalysis,
      });
      dispatch({
        type: 'RESTORE',
        completed: restoredState.completed,
        acknowledged: restoredState.acknowledged,
        allStepIds: stepComponents.map((s) => s.stepId),
      });
      if (migrated) {
        sectionAcknowledgementStorage.set(contentKey, sectionId, true);
      }
    });
    return () => {
      cancelled = true;
    };
    // Intentionally [] — true mount-only. `stepComponents` is closed over
    // by reference; remounts (instance change) re-trigger the effect via
    // a fresh `didRestoreRef`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Objectives checking is handled by the step checker hook

  // Calculate base completion (steps completed) - needed for completion logic
  // Noop steps are always considered complete (they're informational only)
  const nonNoopSteps = stepComponents.filter((s) => s.targetAction !== 'noop');
  const allInteractiveStepsCompleted =
    stepComponents.length > 0 && (nonNoopSteps.length === 0 || nonNoopSteps.every((s) => completedSteps.has(s.stepId)));

  // Add objectives checking for section - disable once interactive steps are done.
  // Note: objectives are *separate* from acknowledgement — when objectives fire
  // the section is done regardless of the gate (`doneVia: 'objectives'`).
  const objectivesChecker = useStepChecker({
    objectives,
    stepId: sectionId,
    isEligibleForChecking: !allInteractiveStepsCompleted,
  });

  const isCompletedByObjectives = objectivesChecker.completionReason === 'objectives';

  // Derive the high-level state kind from the reducer state + the gate
  // analysis + objectives. `awaiting-ack` is the new state introduced
  // in phase 5 — it surfaces only when every interactive step is done
  // AND the gate predicate says so AND ack hasn't been granted yet.
  const derived = useMemo(
    () => deriveSectionState(sectionState, stepComponents, gateAnalysis, isCompletedByObjectives),
    [sectionState, stepComponents, gateAnalysis, isCompletedByObjectives]
  );
  const sectionKind = derived.kind;
  const isCompleted = derived.isCompleted;
  // `stepsCompleted` preserves the historical meaning ("all interactive
  // steps are done") so existing call sites that care about that
  // specific question keep working. Note that this no longer implies
  // the section is *complete* — a trailing-gate section can have
  // stepsCompleted=true while still sitting in `awaiting-ack`.
  const stepsCompleted = derived.allInteractiveStepsCompleted;

  // Implied-0th-step alignment: when paused, show an inline hint so the user
  // understands why steps appear inactive — useful when they've scrolled past
  // the top alignment banner.
  const isAlignmentPaused = useIsAlignmentPaused();
  const alignmentStartingLocation = useAlignmentStartingLocation();

  // Section completion status tracking (debug logging removed)

  // When section objectives are met, mark all child steps as complete (clarification 2, 16)
  useEffect(() => {
    if (isCompletedByObjectives && stepComponents.length > 0) {
      const allStepIds = stepComponents.map((step) => step.stepId);

      if (completedSteps && completedSteps.size !== allStepIds.length) {
        dispatch({ type: 'COMPLETE_ALL_STEPS', stepIds: allStepIds });
        // Persist so a remount (e.g. fullscreen → sidebar auto-dock fired
        // by an interactive nav inside this section) doesn't lose the
        // objectives-driven completion and re-lock every step.
        persistCompletedSteps(new Set(allStepIds));
      }
    }
  }, [isCompletedByObjectives, stepComponents, sectionId, completedSteps, persistCompletedSteps]);

  // Get plugin configuration to determine if auto-detection is enabled
  const pluginContext = usePluginContext();
  const pluginConfig = useMemo(() => {
    return getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
  }, [pluginContext?.meta?.jsonData]);

  // Get runtime interactive config with plugin overrides
  const interactiveConfig = useMemo(() => {
    return getInteractiveConfig(pluginConfig);
  }, [pluginConfig]);

  // Collapse state + auto-collapse-on-completion + restore-from-storage
  // are owned by `useSectionAutoCollapse`. The hook call sits here
  // (rather than at the top of the component) because it depends on
  // `isCompleted` (derived state above) and `pluginConfig.disableAutoCollapse`.
  const { isCollapsed, toggleCollapse, resetCollapse } = useSectionAutoCollapse({
    sectionId,
    isCompleted,
    isPreviewMode,
    autoCollapse,
    disableAutoCollapse: pluginConfig.disableAutoCollapse,
  });

  // Enable action monitor when component mounts (if feature is enabled in config)
  useEffect(() => {
    const actionMonitor = ActionMonitor.getInstance();

    // Only enable if user has turned on the feature in plugin config
    if (interactiveConfig.autoDetection.enabled) {
      actionMonitor.enable();
    }

    // Cleanup: disable monitor when component unmounts (optional, but good practice)
    return () => {
      // Only disable if no other sections are using it
      // The monitor is a singleton, so this might be shared across sections
    };
  }, [interactiveConfig.autoDetection.enabled]); // Re-run if config changes

  // Track if we've emitted the guide-level completion event for this section
  const hasEmittedGuideCompletionRef = useRef(false);

  // Reset the emission flag when section becomes incomplete (e.g., after reset)
  useEffect(() => {
    if (!isCompleted) {
      hasEmittedGuideCompletionRef.current = false;
    }
  }, [isCompleted]);

  // Trigger reactive checks when section completion status changes
  useEffect(() => {
    if (isCompleted && stepComponents.length > 0) {
      // Notify dependent steps that this section is complete
      const completionEvent = new CustomEvent('section-completed', {
        detail: { sectionId },
      });
      document.dispatchEvent(completionEvent);

      // Emit guide-level completion event (for ContentRenderer tracking)
      // Only emit once per completion to avoid duplicate triggers
      if (!hasEmittedGuideCompletionRef.current) {
        hasEmittedGuideCompletionRef.current = true;
        window.dispatchEvent(
          new CustomEvent('interactive-section-completed', {
            detail: { sectionId },
          })
        );
      }

      // Trigger global reactive check to enable next eligible steps
      // Also trigger watchNextStep to help the next step unlock if it has requirements
      import('../../requirements-manager').then(({ SequentialRequirementsManager }) => {
        SequentialRequirementsManager.getInstance().triggerReactiveCheck();
        SequentialRequirementsManager.getInstance().watchNextStep(3000); // Watch for 3 seconds
      });
    }
  }, [isCompleted, sectionId, stepComponents.length]);

  // PRE-COMPUTE eligibility for ALL steps once (React best practice)
  // This prevents expensive recalculation on every render
  const stepEligibility = useMemo(
    () => computeStepEligibility(stepComponents, completedSteps),
    [completedSteps, stepComponents]
  );

  // Calculate resume information for button display
  const getResumeInfo = useCallback(
    () => computeResumeInfo(stepComponents, currentStepIndex),
    [stepComponents, currentStepIndex]
  );

  // Handle individual step completion
  const handleStepComplete = useCallback(
    (stepId: string, skipStateUpdate = false) => {
      // GUARD: Skip if already completed - prevents infinite loops when callbacks are
      // retriggered due to useCallback/useEffect dependency chains (R1, R2, R3)
      if (completedSteps.has(stepId)) {
        return;
      }

      if (!skipStateUpdate) {
        const currentIndex = stepComponents.findIndex((step) => step.stepId === stepId);
        const newCompletedSteps = new Set([...completedSteps, stepId]);

        // Reducer owns completed + cursor. cursorAdvancedTo is the index
        // AFTER the completed step (so resume points at the next one).
        dispatch({
          type: 'COMPLETE_STEP',
          stepId,
          cursorAdvancedTo: currentIndex >= 0 ? currentIndex + 1 : currentStepIndex,
        });
        setCurrentlyExecutingStep(null);

        persistCompletedSteps(newCompletedSteps);

        // React's reactive model handles eligibility updates automatically:
        // 1. State updates are batched and applied
        // 2. stepEligibility useMemo recalculates (triggered by completedSteps change)
        // 3. enhancedChildren useMemo updates (triggered by stepEligibility change)
        // 4. Child InteractiveStep receives new isEligibleForChecking prop
        // 5. useStepChecker's useEffect fires (triggered by isEligibleForChecking change)
        // 6. checkStep runs and next step unlocks

        // useSyncExternalStore ensures manager state stays in sync with React renders
        // No manual synchronization needed!

        // Emit step completion event for fallback guide completion tracking
        window.dispatchEvent(new CustomEvent('interactive-step-completed', { detail: { stepId, sectionId } }));

        // Check if all steps are completed
        const allStepsCompleted = newCompletedSteps.size >= stepComponents.length;
        if (allStepsCompleted) {
          onComplete?.();
          // Note: guide-level completion event is emitted by the useEffect
          // that watches isCompleted state to avoid duplicate emissions
        }
      } else {
        setCurrentlyExecutingStep(null);
      }
    },
    [completedSteps, currentStepIndex, onComplete, persistCompletedSteps, sectionId, stepComponents]
  );

  /**
   * Handle individual step reset (redo functionality)
   * Removes the target step and all subsequent steps from completion state
   */
  const handleStepReset = useCallback(
    (stepId: string) => {
      // Find the index of the step being reset
      const resetIndex = stepComponents.findIndex((step) => step.stepId === stepId);
      if (resetIndex < 0) {
        return;
      }

      // Build the new completed set + the tail-id list for the reducer.
      // Computed outside dispatch so persistCompletedSteps gets the exact
      // value (the reducer's transition is structurally equivalent —
      // RESET_STEP removes every tailStepIds entry from completed).
      const tailStepIds: string[] = [];
      const newSet = new Set(completedSteps);
      for (let i = resetIndex; i < stepComponents.length; i++) {
        const stepToRemove = stepComponents[i]!.stepId;
        tailStepIds.push(stepToRemove);
        newSet.delete(stepToRemove);
      }

      dispatch({ type: 'RESET_STEP', stepId, tailStepIds, resetIndex });
      persistCompletedSteps(newSet);

      // Acknowledgement clears alongside completion — the reducer enforces
      // that invariant. Mirror it in storage so a remount-restore picks up
      // the cleared ack.
      const contentKey = getContentKey();
      if (!isPreviewMode) {
        sectionAcknowledgementStorage.clear(contentKey, sectionId);
      }

      // Also clear currently executing step if it matches
      if (currentlyExecutingStep === stepId) {
        setCurrentlyExecutingStep(null);
      }

      // CRITICAL: Increment resetTrigger to notify all child steps to clear their local UI state
      // This ensures green checkmarks are cleared from the UI
      setResetTrigger((prev) => prev + 1);
    },
    [completedSteps, currentlyExecutingStep, isPreviewMode, persistCompletedSteps, sectionId, stepComponents]
  );

  // Execute a single step (shared between individual and sequence execution)
  const executeStep = useCallback(
    async (stepInfo: StepInfo): Promise<boolean> => {
      // For multi-step components, call their executeStep method via stored ref
      if (stepInfo.isMultiStep) {
        const multiStepRef = multiStepRefs.current.get(stepInfo.stepId);

        if (multiStepRef?.executeStep) {
          try {
            return await multiStepRef.executeStep();
          } catch (error) {
            console.error(`Multi-step execution failed: ${stepInfo.stepId}`, error);
            return false;
          }
        } else {
          console.error(`Multi-step ref not found for: ${stepInfo.stepId}`);
          return false;
        }
      }

      try {
        // Execute the action using existing interactive logic
        await executeInteractiveAction(
          stepInfo.targetAction!,
          stepInfo.refTarget!,
          stepInfo.targetValue,
          'do',
          stepInfo.targetComment
        );

        // Only run post-verification if explicitly specified
        // Don't use requirements as post-verification fallback since many actions
        // (like clicking navigation buttons) are expected to make the original element disappear
        if (stepInfo.postVerify && stepInfo.postVerify.trim() !== '') {
          const result = await verifyStepResult(
            stepInfo.postVerify,
            stepInfo.targetAction || 'button',
            stepInfo.refTarget || '',
            stepInfo.targetValue,
            stepInfo.stepId
          );
          if (!result.pass) {
            console.warn(`Post-verify failed for ${stepInfo.stepId}:`, result.error);
            return false;
          }
        }

        return true;
      } catch (error) {
        console.error(`Step execution failed: ${stepInfo.stepId}`, error);
        return false;
      }
    },
    [executeInteractiveAction, verifyStepResult]
  );

  // Handle sequence execution (do section)
  const handleDoSection = useCallback(async () => {
    if (disabled || isRunning || stepComponents.length === 0) {
      return;
    }

    setIsRunning(true);
    setExecutingStepNumber(0); // Reset step counter
    // Reset user scroll tracking + set isProgrammaticScroll=true for
    // the entire section run. The hook keeps both flags consistent.
    beginProgrammaticScroll();
    console.warn(
      '[Section] Starting section run, reset userScrolled=false, isProgrammatic=TRUE (will stay true during execution)'
    );

    // Force-disable action monitor during section execution to prevent auto-completion conflicts
    // Using forceDisable() to bypass reference counting during automated execution
    const actionMonitor = ActionMonitor.getInstance();
    actionMonitor.forceDisable();

    // Clear any existing highlights before starting section execution
    const { NavigationManager } = await import('../../interactive-engine');
    const navigationManager = new NavigationManager();
    navigationManager.clearAllHighlights();

    isCancelledRef.current = false; // Reset ref as well

    // Use currentStepIndex as the starting point - much more efficient!
    let startIndex = currentStepIndex;

    // If currentStepIndex is beyond the end, it means all steps are completed - reset for full re-run
    if (startIndex >= stepComponents.length) {
      dispatch({ type: 'RESET_SECTION' });
      startIndex = 0;
      // Persist the cleared set so a mid-run unmount (auto-dock from
      // fullscreen) doesn't restore stale "all complete" state and
      // skip the re-run on the next mount.
      persistCompletedSteps(new Set());
    }

    // Check section-level requirements first and apply same priority logic
    if (requirements) {
      const sectionRequirementsData = {
        requirements: requirements,
        targetaction: 'section',
        reftarget: `section-${sectionId}`,
        targetvalue: undefined,
        textContent: title || 'Interactive section',
        tagName: 'section',
      };

      try {
        const sectionRequirementsResult = await checkRequirementsFromData(sectionRequirementsData);
        if (!sectionRequirementsResult.pass) {
          // Section requirements not met - try to fix
          if (sectionRequirementsResult.error?.some((e: any) => e.canFix)) {
            const fixableError = sectionRequirementsResult.error.find((e: any) => e.canFix);

            try {
              // Try to fix the section requirement automatically
              const { NavigationManager } = await import('../../interactive-engine');
              const navigationManager = new NavigationManager();

              if (fixableError?.fixType === 'expand-parent-navigation' && fixableError.targetHref) {
                await navigationManager.expandParentNavigationSection(fixableError.targetHref);
              } else if (fixableError?.fixType === 'location' && fixableError.targetHref) {
                await navigationManager.fixLocationRequirement(fixableError.targetHref);
              } else if (requirements.includes('navmenu-open')) {
                await navigationManager.fixNavigationRequirements();
              }

              // Recheck section requirements after fix attempt
              await new Promise((resolve) => setTimeout(resolve, 200));
              const sectionRecheckResult = await checkRequirementsFromData(sectionRequirementsData);

              if (!sectionRecheckResult.pass) {
                // Section requirements still not met after fix attempt
                console.warn('Section requirements could not be fixed, stopping execution');
                ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
                setIsRunning(false);
                return;
              }
            } catch (fixError) {
              console.warn('Failed to fix section requirements:', fixError);
              ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
              setIsRunning(false);
              return;
            }
          } else {
            // No fix available for section requirements
            console.warn('Section requirements not met and no fix available, stopping execution');
            ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
            setIsRunning(false);
            return;
          }
        }
      } catch (error) {
        console.warn('Section requirements check failed:', error);
        ActionMonitor.getInstance().forceEnable(); // Re-enable monitor
        setIsRunning(false);
        return;
      }
    }

    // Start section-level blocking (persists for entire section)
    const dummyData = {
      reftarget: `section-${sectionId}`,
      targetaction: 'section',
      targetvalue: undefined,
      requirements: undefined,
      tagName: 'section',
      textContent: title || 'Interactive section',
      timestamp: Date.now(),
      isPartOfSection: true,
    };
    startSectionBlocking(sectionId, dummyData, handleSectionCancel);

    let stoppedDueToRequirements = false;
    let completedStepsCount = startIndex; // Track number of completed steps for analytics (starts at startIndex since those are already done)
    // Track the accumulated set OUTSIDE the React state so we can call
    // persistCompletedSteps directly each step. The previous pattern wrapped
    // the persist inside `setCompletedSteps((prev) => { ...; persistCompletedSteps(newSet); return newSet; })`,
    // but React skips functional updater invocation when the component is
    // unmounted — which happens mid-section when an auto-dock fires (a
    // navigate step pushes a Grafana URL → FullScreenPanel unmounts and the
    // orphaned do-section loop's per-step persists silently dropped). The
    // all-complete sweep at the end of the loop still persisted, but the
    // newly-mounted sidebar's InteractiveSection had already done its
    // mount-time restore and only saw the pre-unmount snapshot. Keeping the
    // accumulator local makes persists a direct side-effect that runs
    // regardless of mount state. Verified via runtime logs (hypothesis H3).
    let accumulatedCompleted = new Set(completedSteps);

    try {
      for (let i = startIndex; i < stepComponents.length; i++) {
        // Check for cancellation before each step
        if (isCancelledRef.current) {
          break;
        }

        const stepInfo = stepComponents[i]!;

        // PAUSE: If this is a guided step, stop automated execution
        // User must manually click the guided step's "Do it" button
        // Once complete, they can click "Resume" to continue
        if (stepInfo.isGuided) {
          ActionMonitor.getInstance().forceEnable(); // Re-enable monitor for guided mode
          // (cursor is already at `i` via the prior COMPLETE_STEP dispatches)
          setIsRunning(false); // Stop the automated loop
          stopSectionBlocking(sectionId); // Remove blocking overlay

          // Don't set currentlyExecutingStep - let the guided step handle its own execution
          return; // Exit the section execution loop
        }

        setCurrentlyExecutingStep(stepInfo.stepId);
        setExecutingStepNumber(i + 1); // 1-indexed for display
        scrollToStep(stepInfo.stepId); // Auto-scroll to the step

        // Check step requirements before attempting execution
        if (stepInfo.requirements) {
          const stepRequirementsData = {
            requirements: stepInfo.requirements,
            targetaction: stepInfo.targetAction || 'button',
            reftarget: stepInfo.refTarget || '',
            targetvalue: stepInfo.targetValue,
            textContent: stepInfo.stepId,
            tagName: 'div',
          };

          try {
            const requirementsResult = await checkRequirementsFromData(stepRequirementsData);
            if (!requirementsResult.pass) {
              // Requirements not met - apply priority logic

              // Priority 2: Try to fix the requirement if possible
              if (requirementsResult.error?.some((e: any) => e.canFix)) {
                const fixableError = requirementsResult.error.find((e: any) => e.canFix);

                try {
                  // Try to fix the requirement automatically
                  const { NavigationManager } = await import('../../interactive-engine');
                  const navigationManager = new NavigationManager();

                  if (fixableError?.fixType === 'expand-parent-navigation' && fixableError.targetHref) {
                    await navigationManager.expandParentNavigationSection(fixableError.targetHref);
                  } else if (fixableError?.fixType === 'location' && fixableError.targetHref) {
                    await navigationManager.fixLocationRequirement(fixableError.targetHref);
                  } else if (fixableError?.fixType === 'navigation') {
                    await navigationManager.fixNavigationRequirements();
                  } else if (stepInfo.requirements?.includes('navmenu-open')) {
                    // Only fix navigation requirements if no other specific fix type is available
                    await navigationManager.fixNavigationRequirements();
                  }

                  // Recheck requirements after fix attempt
                  await new Promise((resolve) => setTimeout(resolve, 200)); // Wait for UI to settle
                  const recheckResult = await checkRequirementsFromData(stepRequirementsData);

                  if (!recheckResult.pass) {
                    // Fix didn't work - check if step is skippable
                    // Priority 3: Skip if possible
                    if (stepInfo.skippable) {
                      // Skip this step properly using the step's own markSkipped function
                      const stepRef = stepRefs.current.get(stepInfo.stepId);
                      if (stepRef?.markSkipped) {
                        stepRef.markSkipped(); // This handles the blue state properly
                        handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                      }
                      continue; // Continue to next step
                    } else {
                      // Priority 4: Stop execution if not skippable.
                      // (cursor is already at `i` via the prior
                      // COMPLETE_STEP dispatches — no explicit setter
                      // needed.)
                      stoppedDueToRequirements = true;
                      break;
                    }
                  }
                  // If recheck passed, continue with normal execution below
                } catch (fixError) {
                  console.warn(`Failed to fix requirements for step ${i + 1}:`, fixError);

                  // Fix failed - check if step is skippable
                  if (stepInfo.skippable) {
                    // Skip this step properly using the step's own markSkipped function
                    const stepRef = stepRefs.current.get(stepInfo.stepId);
                    if (stepRef?.markSkipped) {
                      stepRef.markSkipped(); // This handles the blue state properly
                      handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                    }
                    continue;
                  } else {
                    // Stop execution (cursor already at `i`)
                    stoppedDueToRequirements = true;
                    break;
                  }
                }
              } else {
                // No fix available - check if step is skippable
                // Priority 3: Skip if possible
                if (stepInfo.skippable) {
                  // Skip this step properly using the step's own markSkipped function
                  const stepRef = stepRefs.current.get(stepInfo.stepId);
                  if (stepRef?.markSkipped) {
                    stepRef.markSkipped(); // This handles the blue state properly
                    handleStepComplete(stepInfo.stepId, true); // This handles the flow continuation
                  }
                  continue; // Continue to next step
                } else {
                  // Priority 4: Stop execution if not skippable and no fix available
                  // (cursor already at `i`)
                  stoppedDueToRequirements = true;
                  break;
                }
              }
            }
          } catch (error) {
            console.warn(`Step ${i + 1} requirements check failed, stopping section execution:`, error);
            stoppedDueToRequirements = true;
            break;
          }
        }

        // First, show the step (highlight it) - skip for multi-step components OR if showMe is false
        if (!stepInfo.isMultiStep && stepInfo.showMe !== false) {
          await executeInteractiveAction(
            stepInfo.targetAction!,
            stepInfo.refTarget!,
            stepInfo.targetValue,
            'show',
            stepInfo.targetComment
          );

          // Wait for highlight to be visible and animation to complete
          // Check cancellation during wait
          for (let j = 0; j < INTERACTIVE_CONFIG.delays.section.showPhaseIterations; j++) {
            if (isCancelledRef.current) {
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.section.baseInterval));
          }
          if (isCancelledRef.current) {
            continue;
          } // Skip to cancellation check at loop start
        }

        // Then, execute the step (verifyStepResult already has retry logic)
        const success = await executeStep(stepInfo);

        if (success) {
          // Track completed step for analytics
          completedStepsCount = i + 1; // i is 0-indexed, so +1 gives count of completed steps

          // Mark step as completed immediately and persistently.
          // `persistCompletedSteps` is called DIRECTLY so it survives a
          // mid-section unmount — see the long comment on
          // `accumulatedCompleted` above for the auto-dock race. The
          // reducer dispatch is best-effort (also dropped on unmount);
          // localStorage is the source of truth across remounts.
          accumulatedCompleted = new Set([...accumulatedCompleted, stepInfo.stepId]);
          dispatch({
            type: 'COMPLETE_STEP',
            stepId: stepInfo.stepId,
            cursorAdvancedTo: i + 1,
          });
          persistCompletedSteps(accumulatedCompleted);

          // Also call the standard completion handler for other side effects (skip state update to avoid double-setting)
          handleStepComplete(stepInfo.stepId, true);

          // Wait between steps for both visual feedback AND DOM settling
          // This ensures the next step's requirements are ready before checking
          if (i < stepComponents.length - 1) {
            // First: Wait for React updates to propagate
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

            // Then: Wait for visual feedback with cancellation checks
            for (let j = 0; j < INTERACTIVE_CONFIG.delays.section.betweenStepsIterations; j++) {
              if (isCancelledRef.current) {
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.section.baseInterval));
            }
          }
        } else {
          // Step execution failed after retries - stop and don't auto-complete remaining steps
          // (cursor already at `i` via the prior COMPLETE_STEP dispatches)
          stoppedDueToRequirements = true;

          // Wait for state to settle, then trigger reactive check
          // This ensures remaining steps update their eligibility based on completed steps
          setTimeout(() => {
            import('../../requirements-manager').then(({ SequentialRequirementsManager }) => {
              const manager = SequentialRequirementsManager.getInstance();
              manager.triggerReactiveCheck();
            });
          }, 200);

          break;
        }
      }

      // Section sequence completed or cancelled
      if (!isCancelledRef.current && !stoppedDueToRequirements) {
        // Only auto-complete all steps if we actually completed the entire sequence
        // Don't auto-complete if we stopped due to requirements failure
        const allStepIds = stepComponents.map((step) => step.stepId);
        dispatch({ type: 'COMPLETE_ALL_STEPS', stepIds: allStepIds });
        // Persist so the user-visible "all done" state survives a
        // remount triggered by the final step's navigation (the
        // fullscreen auto-dock path) — without this, the new mount's
        // restoration sees only the per-step persists from the loop
        // and the section appears half-done despite finishing.
        persistCompletedSteps(new Set(allStepIds));

        // Force re-evaluation of section completion state
        setTimeout(() => {
          // This will trigger the completion effects now that all steps are marked complete
        }, 100);
      }
    } catch (error) {
      console.error('Error running section sequence:', error);
    } finally {
      // Re-enable action monitor after section execution completes
      ActionMonitor.getInstance().forceEnable();

      // Stop section-level blocking
      stopSectionBlocking(sectionId);
      setIsRunning(false);
      setCurrentlyExecutingStep(null);
      setExecutingStepNumber(0);
      // Reset programmatic scroll flag now that section is done.
      endProgrammaticScroll();
      // Keep isCancelled state for UI feedback, will be reset on next run

      // Track "Do Section" analytics after completion (success or cancel)
      const wasCanceled = isCancelledRef.current || stoppedDueToRequirements;
      const docInfo = getSourceDocument(sectionId);

      // Section-scoped metrics (completedStepsCount is the count of steps completed in this section)
      const currentSectionStep = completedStepsCount;
      const currentSectionPercentage = Math.round((completedStepsCount / stepComponents.length) * 100);

      // Document-scoped metrics (use last completed step's index for position)
      // If no steps completed, use 0 as the index; otherwise use completedStepsCount - 1
      const lastCompletedStepIndex = completedStepsCount > 0 ? completedStepsCount - 1 : 0;
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        lastCompletedStepIndex
      );
      const documentCompletionPercentage = calculateStepCompletion(documentStepIndex, documentTotalSteps);

      reportAppInteraction(UserInteraction.DoSectionButtonClick, {
        ...docInfo,
        content_type: 'interactive_guide',
        section_title: title,
        // Section-scoped
        total_steps: stepComponents.length,
        current_section_step: currentSectionStep,
        current_section_percentage: currentSectionPercentage,
        // Document-scoped
        total_document_steps: documentTotalSteps,
        current_step: documentStepIndex + 1, // 1-indexed for analytics
        ...(documentCompletionPercentage !== undefined && { completion_percentage: documentCompletionPercentage }),
        // Completion status
        canceled: wasCanceled,
        resumed: startIndex > 0, // true if user resumed from a previous position
        interaction_location: 'interactive_section',
      });
    }
  }, [
    disabled,
    isRunning,
    stepComponents,
    sectionId,
    executeStep,
    executeInteractiveAction,
    handleStepComplete,
    startSectionBlocking,
    stopSectionBlocking,
    title,
    handleSectionCancel,
    currentStepIndex,
    requirements,
    checkRequirementsFromData,
    persistCompletedSteps,
    scrollToStep,
    beginProgrammaticScroll,
    endProgrammaticScroll,
    completedSteps,
  ]);

  /**
   * Handle complete section reset
   * Clears all completion state and resets all steps to initial state
   */
  const handleResetSection = useCallback(() => {
    if (disabled || isRunning) {
      return;
    }

    // Clear section state immediately. The reducer also clears the
    // acknowledgement flag in lockstep — keeping the post-#842
    // invariant ("ack requires completion") true at all times.
    dispatch({ type: 'RESET_SECTION' });
    setCurrentlyExecutingStep(null);

    // Expand the section and clear the auto-collapse-once guard so a
    // future completion re-fires the auto-collapse.
    resetCollapse();

    // Signal all child steps to reset their local state
    setResetTrigger((prev) => prev + 1);

    // Clear storage persistence. In preview mode none of the section-
    // scoped storage namespaces are written to (see persistCompletedSteps,
    // sectionCollapseStorage, sectionAcknowledgementStorage call sites)
    // so the clears would be no-ops — skip them to mirror the rest of
    // the file's preview-mode contract.
    const contentKey = getContentKey();
    if (!isPreviewMode) {
      interactiveStepStorage.clear(contentKey, sectionId);
      sectionCollapseStorage.clear(contentKey, sectionId); // Clear collapse state
      sectionAcknowledgementStorage.clear(contentKey, sectionId); // Clear ack so the gate re-arms on next pass
    }

    // Notify listeners that progress for this content was cleared (#842, Bug 2).
    // Mirrors the dispatch in BlockPreview's reset() so any consumer driving
    // ephemeral UI off `interactive-progress-cleared` — most importantly
    // `useGuidePreviewProgress`, which controls the "Reset guide" button
    // visibility — sees the section-level reset path too. Without this the
    // block-editor preview's Reset guide button stays visible after a
    // per-section reset, even when no progress is left.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey },
        })
      );
    }

    // Reset all step states in the global manager
    import('../../requirements-manager').then(({ SequentialRequirementsManager }) => {
      const manager = SequentialRequirementsManager.getInstance();

      // Temporarily stop DOM monitoring during reset
      manager.stopDOMMonitoring();

      // Reset all step states including completion and skipped status
      stepComponents.forEach((step) => {
        manager.updateStep(step.stepId, {
          isEnabled: false,
          isCompleted: false,
          isChecking: false,
          isSkipped: false, // Clear skipped state on reset
          completionReason: 'none',
          explanation: undefined,
          error: undefined,
        });
      });

      // Re-enable monitoring and trigger check for first step after reset
      setTimeout(() => {
        manager.triggerReactiveCheck();
        setTimeout(() => {
          manager.startDOMMonitoring();
        }, 100);
      }, 200);
    });
  }, [disabled, isRunning, stepComponents, sectionId, isPreviewMode, resetCollapse]);

  /**
   * Mark the section as acknowledged (issue #842).
   *
   * Available only when the gate is active and pending — i.e. the
   * derived state is 'awaiting-ack'. For all-passive sections we
   * synthesise a marker completion so the reducer's ACKNOWLEDGE
   * invariant ("ack requires at least one completed step") is
   * satisfied; the marker is internal and never user-visible.
   */
  const handleMarkSectionComplete = useCallback(() => {
    if (disabled || isRunning || sectionKind !== 'awaiting-ack') {
      return;
    }

    const contentKey = getContentKey();

    if (gateAnalysis.isAllPassive) {
      // All-passive section: the reducer needs at least one entry in
      // `completed` before it accepts ACKNOWLEDGE. Inject a synthetic
      // marker step id keyed to the section so it can't collide.
      const markerId = `${sectionId}::ack-marker`;
      dispatch({ type: 'COMPLETE_STEP', stepId: markerId, cursorAdvancedTo: 0 });
      // Accumulate rather than overwrite. Safe today (gate's `isAllPassive`
      // implies an empty completed set) but mirrors the reducer's add
      // semantics so we don't clobber prior entries if classification ever
      // changes.
      persistCompletedSteps(new Set([...completedSteps, markerId]));
    }

    dispatch({ type: 'ACKNOWLEDGE' });
    if (!isPreviewMode) {
      sectionAcknowledgementStorage.set(contentKey, sectionId, true);
    }
  }, [
    disabled,
    isRunning,
    sectionKind,
    gateAnalysis.isAllPassive,
    isPreviewMode,
    persistCompletedSteps,
    sectionId,
    completedSteps,
  ]);

  // Register this section's steps in the global registry BEFORE rendering children
  // This must happen in useMemo (not useEffect) to ensure totalDocumentSteps is correct
  // when getDocumentStepPosition is called during the enhancedChildren memo
  useMemo(() => {
    registerSectionSteps(sectionId, stepComponents.length);
  }, [sectionId, stepComponents.length]);

  // Expose current step context globally for analytics + drive the
  // top-bar progress chip in FullScreenLayout / FloatingPanel.
  //
  // Globals (`__DocsPluginCurrentStepIndex`, `__DocsPluginTotalSteps`)
  // are kept for backwards compatibility with anything reading them, but
  // they're an "execution-only" signal — they go stale the moment a step
  // finishes. The new `pathfinder-step-progress` event publishes the full
  // `{ documentStepIndex, totalSteps, completedCount }` whenever
  // execution state OR completion changes, so consumers can show
  // "completed / total" instead of "currently-running" and update
  // immediately on completion / reset.
  useEffect(() => {
    try {
      // `totalDocumentSteps` is a module-level mutable counter (not React
      // state), so it's read fresh inside the effect rather than as a dep.
      const totalSteps = getTotalDocumentSteps();
      (window as any).__DocsPluginTotalSteps = totalSteps;

      let documentStepIndex: number | undefined;
      if (currentlyExecutingStep) {
        const executingStepInfo = stepComponents.find((s) => s.stepId === currentlyExecutingStep);
        if (executingStepInfo) {
          const { stepIndex } = getDocumentStepPosition(sectionId, executingStepInfo.index);
          documentStepIndex = stepIndex;
          (window as any).__DocsPluginCurrentStepIndex = stepIndex;
        }
      }

      // Total completed across ALL sections in the document — read from
      // shared storage (the same source persistCompletedSteps writes to)
      // so the chip reflects unified progress, not just this section.
      const contentKey = getContentKey();
      const completedDocumentCount = interactiveStepStorage.countAllCompleted(contentKey);

      window.dispatchEvent(
        new CustomEvent('pathfinder-step-progress', {
          detail: {
            sectionId,
            totalSteps,
            documentStepIndex,
            completedCount: completedDocumentCount,
          },
        })
      );
    } catch {
      // no-op
    }
  }, [currentlyExecutingStep, stepComponents, sectionId, completedSteps]);

  // Render enhanced children with coordination props. For each child:
  //   1. Look up its `StepTypeSchema` (undefined → pass-through).
  //   2. Build the cloneElement bag via `schema.toEnhancedProps(ctx)`.
  //   3. Attach a `ref` callback based on `schema.refTarget`
  //      ('stepRefs' / 'multiStepRefs' / 'none').
  const enhancedChildren = useMemo(() => {
    let stepIndex = 0;

    const makeRefCallback =
      (target: 'stepRefs' | 'multiStepRefs', stepId: string) =>
      (ref: { executeStep: () => Promise<boolean>; markSkipped?: () => void } | null) => {
        const map = target === 'stepRefs' ? stepRefs.current : multiStepRefs.current;
        if (ref) {
          map.set(stepId, ref);
        } else {
          map.delete(stepId);
        }
      };

    return React.Children.map(children, (child) => {
      const schema = lookupStepSchema(child);
      if (!schema) {
        return child;
      }
      const stepInfo = stepComponents[stepIndex];
      if (!stepInfo) {
        return child;
      }

      const isEligibleForChecking = stepEligibility[stepIndex] ?? false;
      const isCompleted = completedSteps.has(stepInfo.stepId);
      const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        stepIndex
      );

      const enhanceCtx: EnhanceContext = {
        stepInfo,
        isEligibleForChecking,
        isCompleted,
        isCurrentlyExecuting,
        documentStepIndex,
        documentTotalSteps,
        sectionId,
        sectionTitle: title,
        baseDisabled: disabled,
        isRunning,
        sectionRequirementsPassed: sectionRequirementsStatus.passed,
        resetTrigger,
        onStepComplete: handleStepComplete,
        onStepReset: handleStepReset,
      };

      const enhancedProps = schema.toEnhancedProps(enhanceCtx);

      // `ref` and `key` are React-special — they must go onto the
      // cloneElement props directly, not into `enhancedProps`.
      const refCallback = schema.refTarget === 'none' ? undefined : makeRefCallback(schema.refTarget, stepInfo.stepId);

      stepIndex++;

      return React.cloneElement(child as React.ReactElement<any>, {
        ...(child as React.ReactElement<any>).props,
        ...enhancedProps,
        key: stepInfo.stepId,
        ...(refCallback ? { ref: refCallback } : {}),
      });
    });
  }, [
    children,
    stepComponents,
    stepEligibility,
    completedSteps,
    currentlyExecutingStep,
    handleStepComplete,
    handleStepReset,
    disabled,
    isRunning,
    resetTrigger,
    sectionId,
    title,
    sectionRequirementsStatus.passed,
  ]);

  // Computed once per render so the catch-all action button's `title`
  // and label IIFEs share a single result instead of recomputing.
  const resumeInfo = getResumeInfo();

  return (
    <div
      id={sectionId}
      className={`interactive-section${className ? ` ${className}` : ''}${isCompleted ? ' completed' : ''}${
        isCollapsed ? ' collapsed' : ''
      }`}
      data-testid={testIds.interactive.section(sectionId)}
      data-interactive-section="true"
    >
      <div className={`interactive-section-header${isCollapsed ? ' collapsed' : ''}`}>
        {/* Show collapse toggle when completed OR when in preview mode (for guide authors) */}
        {(isCompleted || isPreviewMode) && (
          <button
            className="interactive-section-toggle-button"
            onClick={toggleCollapse}
            type="button"
            title={isCollapsed ? 'Expand section' : 'Collapse section'}
            aria-label={isCollapsed ? 'Expand section' : 'Collapse section'}
            data-testid={testIds.interactive.sectionToggle(sectionId)}
          >
            <span className="interactive-section-toggle-icon">{isCollapsed ? '▶' : '▼'}</span>
          </button>
        )}
        <div className="interactive-section-title-container">
          <span className="interactive-section-title">{title}</span>
          {isCompleted && <span className="interactive-section-checkmark">✓</span>}
        </div>
        {hints && (
          <span className="interactive-section-hint" title={hints}>
            ⓘ
          </span>
        )}
      </div>

      {!isCollapsed && description && <div className="interactive-section-description">{description}</div>}

      {/* Section requirements status banner */}
      {!isCollapsed && requirements && !sectionRequirementsStatus.passed && (
        <div className="interactive-section-requirements-banner">
          <span className="interactive-section-requirements-icon">🔒</span>
          <span className="interactive-section-requirements-message">Requirements not yet met</span>
        </div>
      )}

      {/* Implied-0th-step alignment hint: surfaces in every section while a
          prompt is up, so users who scroll past the top banner still see why
          steps are inactive. */}
      {!isCollapsed && isAlignmentPaused && alignmentStartingLocation && (
        <div className="interactive-section-alignment-banner" data-testid={testIds.alignmentPrompt.sectionHint}>
          <span className="interactive-section-alignment-message">
            Steps are paused.{' '}
            <button
              type="button"
              className="interactive-section-alignment-link"
              onClick={() => {
                const target = document.querySelector(`[data-testid="${testIds.alignmentPrompt.container}"]`);
                if (target) {
                  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            >
              Open the navigation prompt
            </button>{' '}
            to continue.
          </span>
        </div>
      )}

      {!isCollapsed && (
        <ol className="interactive-section-content">{wrapSectionChildrenForNumbering(enhancedChildren)}</ol>
      )}

      <div className={`interactive-section-actions${isCollapsed ? ' collapsed' : ''}`}>
        {isCollapsed ? (
          <Button
            onClick={handleResetSection}
            disabled={disabled || isRunning || isCompletedByObjectives}
            size="sm"
            variant="secondary"
            className="interactive-section-reset-button"
            data-testid={testIds.interactive.resetSectionButton(sectionId)}
            title="Reset section and clear all step completion"
          >
            Reset Section
          </Button>
        ) : isRunning ? (
          /* Running state - show progress bar and status */
          <div className="interactive-guided-executing">
            <div className="interactive-guided-step-indicator">
              <span className="interactive-guided-step-badge">
                Step {executingStepNumber || 1} of {stepComponents.length}
              </span>
            </div>
            <div className="interactive-guided-instruction">
              <span className="interactive-guided-instruction-icon">⚡</span>
              <span className="interactive-guided-instruction-text">Running step {executingStepNumber || 1}...</span>
            </div>
            <div className="interactive-guided-progress">
              <div
                className="interactive-guided-progress-fill"
                style={{ width: `${((executingStepNumber - 1) / stepComponents.length) * 100}%` }}
              />
              <div
                className="interactive-guided-progress-active"
                style={{
                  left: `${((executingStepNumber - 1) / stepComponents.length) * 100}%`,
                  width: `${(1 / stepComponents.length) * 100}%`,
                }}
              />
            </div>
            <Button
              onClick={handleSectionCancel}
              disabled={disabled}
              size="sm"
              variant="secondary"
              className="interactive-guided-cancel-btn"
              title="Cancel section execution"
            >
              Cancel
            </Button>
          </div>
        ) : sectionKind === 'awaiting-ack' ? (
          /* Acknowledgement gate (issue #842) — surfaces only when every
             interactive step is done (or the section is 100% passive) AND
             the user hasn't yet clicked Mark. */
          <Button
            onClick={handleMarkSectionComplete}
            disabled={disabled}
            size="md"
            variant="primary"
            className="interactive-section-do-button"
            data-testid={testIds.interactive.markSectionCompleteButton(sectionId)}
            title="Mark section as complete and continue"
          >
            Mark section as complete
          </Button>
        ) : (
          // Catch-all action button. The disabled clause's
          // `stepComponents.length === 0` guard only applies to the Do-
          // Section path — an all-passive section has zero interactive
          // children but reaches `done(ack)` via the Mark gate and must
          // still be Reset-able afterwards.
          <Button
            onClick={stepsCompleted && !isCompletedByObjectives ? handleResetSection : handleDoSection}
            disabled={
              disabled ||
              !sectionRequirementsStatus.passed ||
              isCompletedByObjectives ||
              (!(stepsCompleted && !isCompletedByObjectives) && stepComponents.length === 0)
            }
            size="md"
            variant={isCompleted ? 'secondary' : 'primary'}
            className="interactive-section-do-button"
            data-testid={
              stepsCompleted && !isCompletedByObjectives
                ? testIds.interactive.resetSectionButton(sectionId)
                : testIds.interactive.doSectionButton(sectionId)
            }
            title={(() => {
              if (isCompletedByObjectives) {
                return 'Already done!';
              }
              if (stepsCompleted && !isCompletedByObjectives) {
                return 'Reset section and clear all step completion to allow manual re-interaction';
              }
              if (resumeInfo.isResume) {
                return `Resume from step ${resumeInfo.nextStepIndex + 1}, ${resumeInfo.remainingSteps} steps remaining`;
              }
              return hints || `Run through all ${nonNoopSteps.length} steps in sequence`;
            })()}
          >
            {(() => {
              if (isCompletedByObjectives) {
                return 'Already done!';
              }
              if (stepsCompleted && !isCompletedByObjectives) {
                return 'Reset section';
              }
              if (resumeInfo.isResume) {
                return `▶ Resume (${resumeInfo.remainingSteps} steps)`;
              }
              return `▶ Do Section (${nonNoopSteps.length} steps)`;
            })()}
          </Button>
        )}
      </div>
    </div>
  );
}
