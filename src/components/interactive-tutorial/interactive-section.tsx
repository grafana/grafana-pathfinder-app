import React, { useState, useCallback, useMemo, useEffect, useReducer, useRef } from 'react';
import { Button } from '@grafana/ui';
import { usePluginContext } from '@grafana/data';

import { useInteractiveElements, ActionMonitor } from '../../interactive-engine';
import { useStepChecker, stripTabLocalRequirements } from '../../requirements-manager';
import { useIsAlignmentPaused, useAlignmentStartingLocation } from '../../global-state/alignment-pending-context';
import { useInteractiveMode } from '../../global-state/interactive-mode-context';
import { InteractiveStep, resetStepCounter } from './interactive-step';
import { InteractiveMultiStep, resetMultiStepCounter } from './interactive-multi-step';
import { InteractiveGuided, resetGuidedCounter } from './interactive-guided';
import { InteractiveQuiz, resetQuizCounter } from './interactive-quiz';
import { TerminalStep, resetTerminalStepCounter } from './terminal-step';
import { TerminalConnectStep, resetTerminalConnectStepCounter } from './terminal-connect-step';
import { CodeBlockStep, resetCodeBlockStepCounter } from './code-block-step';
import { ChallengeBlock, resetChallengeCounter } from './challenge-block';
import { wrapSectionChildrenForNumbering } from './section-numbering';
// Re-exports preserved for back-compat with `section-numbering.test.tsx`,
// which imports both helpers from this module. New code should import
// directly from `./section-numbering`.
export { shouldNumberSectionChild, wrapSectionChildrenForNumbering } from './section-numbering';

// ⚠ TRACKED STEP TYPE REGISTRY — orchestration site. Zips each React
// component identity to its schema from `step-type-registry.ts` (site 1
// of 2). The other site that must be edited when adding a step type is
// `section-child-classifier.ts` `INTERACTIVE_STEP_COMPONENT_TYPES`.
// See .cursor/rules/tracked-step-types.mdc for the full checklist.
export const STEP_TYPE_LOOKUP: ReadonlyMap<React.ComponentType<any>, StepTypeSchema> = new Map<
  React.ComponentType<any>,
  StepTypeSchema
>([
  [InteractiveStep, INTERACTIVE_STEP_SCHEMA],
  [InteractiveMultiStep, INTERACTIVE_MULTISTEP_SCHEMA],
  [InteractiveGuided, INTERACTIVE_GUIDED_SCHEMA],
  [InteractiveQuiz, INTERACTIVE_QUIZ_SCHEMA],
  [TerminalStep, TERMINAL_STEP_SCHEMA],
  [TerminalConnectStep, TERMINAL_CONNECT_STEP_SCHEMA],
  [CodeBlockStep, CODE_BLOCK_STEP_SCHEMA],
  [ChallengeBlock, CHALLENGE_BLOCK_SCHEMA],
]);

/** Resolve the schema for a child element, or `undefined` if the child
 *  is not a tracked step type (markdown / media / wrapper). */
function lookupStepSchema(child: React.ReactNode): StepTypeSchema | undefined {
  if (!React.isValidElement(child)) {
    return undefined;
  }
  return STEP_TYPE_LOOKUP.get(child.type as React.ComponentType<any>);
}
import { reportAppInteraction, UserInteraction, getSourceDocument, calculateStepCompletion } from '../../lib/analytics';
import { sectionDoneStorage } from '../../lib/user-storage';
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
import { useDocumentStepProgress } from './hooks/use-document-step-progress';
import { useSectionAutoCollapse } from './hooks/use-section-auto-collapse';
import { useSectionPersistence } from './hooks/use-section-persistence';
import { useSectionRequirements } from './hooks/use-section-requirements';
import { useSectionScroll } from './hooks/use-section-scroll';
import {
  evictSectionCache,
  markStepCompleted,
  markStepsCompleted,
  reconcileSection,
  refreshAndNotifyGuideProgress,
  resetSection as resetSectionStore,
  resetSteps,
  useSectionCompletion,
} from '../../global-state/completion-store';
import { dispatchProgress } from '../../global-state/progress-events';
import { computeCursor, deriveSectionState, initialSectionState, sectionReducer } from './section-state';
import {
  getDocumentStepPosition,
  nextSectionCounter,
  registerSectionSteps,
  resetRegistry,
} from '../../global-state/section-registry';
import {
  CHALLENGE_BLOCK_SCHEMA,
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

// Re-exports preserved for back-compat with `content-renderer.tsx`. New code
// should import directly from `./section-registry`.
export {
  registerSectionSteps,
  getTotalDocumentSteps,
  getDocumentStepPosition,
} from '../../global-state/section-registry';

// Interactive Section title fallback
export const DEFAULT_INTERACTIVE_SECTION_TITLE = 'Interactive section';

// Interactive Section title fallback for sections with no interactive steps (passive content only)
export const PASSIVE_SECTION_TITLE = 'Steps';

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
  // Post-C2 the reducer owns one bit: `acknowledged`. Step completion
  // lives in the canonical `completion-store` (read via
  // `useSectionCompletion`); the cursor is a pure derivation of the
  // step roster + the completed set.
  const [sectionState, dispatch] = useReducer(sectionReducer, initialSectionState);
  const mode = useInteractiveMode();
  // In controller mode, drop requirements that probe this tab (nav menu, current
  // page, ...) — the live tab enforces them; session requirements still gate.
  const controllerRequirements = useMemo(
    () => (mode === 'controller' ? stripTabLocalRequirements(requirements) : requirements),
    [mode, requirements]
  );
  const [currentlyExecutingStep, setCurrentlyExecutingStep] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [executingStepNumber, setExecutingStepNumber] = useState(0); // Track which step is being executed (1-indexed for display)
  const [resetTrigger, setResetTrigger] = useState(0); // Trigger to reset child steps

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

  // Use ref for cancellation to avoid closure issues
  const isCancelledRef = useRef(false);

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

  // Section-level requirements polling (initial check, 4 event listeners,
  // 5-second setInterval) is owned by `useSectionRequirements`. Pattern F
  // timing contract — the 5s cadence is load-bearing for "auto-pickup of
  // out-of-band state changes that don't fire one of the 4 events".
  const { status: sectionRequirementsStatus, fix: fixSectionRequirements } = useSectionRequirements({
    requirements: controllerRequirements,
    sectionId,
    title,
    hints,
    checkRequirementsFromData,
  });

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
      // Prefer the author/parser-supplied stable stepId on the child over
      // the positional fallback. The JSON parser threads `props.stepId`
      // through every interactive-block converter (either the author's
      // `id` or `deriveStepId(...)`); without this preference the
      // `cloneElement` in `enhancedChildren` below would overwrite the
      // stable ID with the positional one on every section render,
      // re-orphaning completion whenever a sibling block is inserted.
      const childProps = (child as React.ReactElement<any>).props;
      const stepId: string =
        typeof childProps?.stepId === 'string' && childProps.stepId.length > 0
          ? childProps.stepId
          : `${sectionId}-${schema.idPrefix}-${stepIndex + 1}`;
      const extension = schema.toStepInfoExtension(childProps);
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

  // Ack + collapse storage IO + the mount-only RESTORE effect are owned
  // by `useSectionPersistence`. Step-completion storage is owned by the
  // completion store directly; this section no longer writes through a
  // local persist callback.
  const { clearStepAcknowledgement, setAcknowledgement, clearAckAndCollapseStorage } = useSectionPersistence({
    sectionId,
    isPreviewMode,
    stepComponents,
    gateAnalysis,
    dispatch,
  });

  // Authoritative completion set for this section — live snapshot from
  // the canonical store. `currentStepIndex` is the cursor derivation
  // (first non-completed step in `stepComponents` order).
  const completedSteps = useSectionCompletion(sectionId);

  // Roster reconciliation (MF-2): drop any stored step IDs that no
  // longer appear in the section's current roster. Self-heals storage
  // after author edits (rename / delete / re-order under stable IDs)
  // so `countAllCompleted` / `getGuideProgress` can't run > 100%. Runs
  // once per roster change; idempotent when storage is already aligned.
  // Skipped in preview mode where storage writes are sandboxed.
  useEffect(() => {
    if (isPreviewMode) {
      return;
    }
    const roster = stepComponents.map((s) => s.stepId);
    if (roster.length === 0) {
      return;
    }
    reconcileSection(sectionId, roster);
  }, [isPreviewMode, sectionId, stepComponents]);

  // Preview-mode sandbox (#842 Bug 3): the store's in-memory cache is
  // module-scope and would otherwise survive an unmount/remount cycle
  // under the same preview content key, leaking the prior session's
  // completion into the next render. Evict the cache on unmount so
  // each preview mount starts fresh — storage is already preview-gated
  // by `persistSection`.
  useEffect(() => {
    if (!isPreviewMode) {
      return;
    }
    return () => {
      evictSectionCache(sectionId);
    };
  }, [isPreviewMode, sectionId]);
  const currentStepIndex = useMemo(
    () =>
      computeCursor(
        stepComponents.map((s) => s.stepId),
        completedSteps
      ),
    [stepComponents, completedSteps]
  );

  // Objectives checking is handled by the step checker hook

  // Calculate base completion (steps completed) - needed for completion logic
  // Noop steps are always considered complete (they're informational only)
  const nonNoopSteps = stepComponents.filter((s) => s.targetAction !== 'noop');

  // Swap "Interactive section" → "Steps" when the title is the default
  // fallback and no child step is interactive. Author-set titles pass through.
  const displayTitle =
    title === DEFAULT_INTERACTIVE_SECTION_TITLE && nonNoopSteps.length === 0 ? PASSIVE_SECTION_TITLE : title;
  const allInteractiveStepsCompleted =
    stepComponents.length > 0 && (nonNoopSteps.length === 0 || nonNoopSteps.every((s) => completedSteps.has(s.stepId)));

  // Add objectives checking for section - disable once interactive steps are done.
  // Note: objectives are *separate* from acknowledgement — when objectives fire
  // the section is done regardless of the gate (`doneVia: 'objectives'`).
  const objectivesChecker = useStepChecker({
    objectives,
    stepId: sectionId,
    isEligibleForChecking: !allInteractiveStepsCompleted,
    // `null` ⇒ the section's own self-check is not a real step; suppress
    // the checker's store-write side effects. The section handles its
    // own completion via `markStepsCompleted` on the child step IDs when
    // objectives fire.
    sectionId: null,
  });

  const isCompletedByObjectives = objectivesChecker.completionReason === 'objectives';

  // Derive the high-level state kind from the reducer's ack bit + the
  // gate analysis + objectives + the live completion set.
  const derived = useMemo(
    () => deriveSectionState(sectionState, stepComponents, gateAnalysis, isCompletedByObjectives, completedSteps),
    [sectionState, stepComponents, gateAnalysis, isCompletedByObjectives, completedSteps]
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
      if (completedSteps.size !== allStepIds.length) {
        // Single bulk write — the store persists + notifies once.
        markStepsCompleted(allStepIds, sectionId, 'objectives');
      }
    }
  }, [isCompletedByObjectives, stepComponents, sectionId, completedSteps]);

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

  // Reset the emission flag when section becomes incomplete (e.g., after reset).
  // Also clear the persisted done bit so `section-completed:` checks on
  // dependent steps re-block until the user re-completes the section.
  useEffect(() => {
    if (!isCompleted) {
      hasEmittedGuideCompletionRef.current = false;
      if (!isPreviewMode) {
        sectionDoneStorage.clear(getContentKey(), sectionId);
      }
    }
  }, [isCompleted, isPreviewMode, sectionId]);

  // Trigger reactive checks when section completion status changes.
  // The `gateAnalysis.isAllPassive` branch lets sections with zero
  // interactive steps still persist `sectionDoneStorage` + refresh
  // guide progress (F-1, #909 follow-up).
  useEffect(() => {
    if (isCompleted && (stepComponents.length > 0 || gateAnalysis.isAllPassive)) {
      // Single unified event — replaces the two legacy CustomEvents
      // (`section-completed` on document + `interactive-section-completed`
      // on window). The `!hasEmittedGuideCompletionRef.current` guard
      // becomes redundant for the section dispatch because `isCompleted`
      // only flips true once per completion, but keep it as a cheap
      // belt-and-braces against future re-dispatch effects.
      if (!hasEmittedGuideCompletionRef.current) {
        hasEmittedGuideCompletionRef.current = true;
        dispatchProgress({ kind: 'section', sectionId, completed: true });
        // Persist the section's done state so `section-completed:`
        // requirement checks work without the section being mounted
        // (other milestones, virtualized regions, conditional branches).
        // Preview mode is sandboxed — keep the ephemeral check DOM-only.
        if (!isPreviewMode) {
          sectionDoneStorage.set(getContentKey(), sectionId, true);
          // All-passive sections bypass `persistSection`, so refresh
          // the guide percentage explicitly.
          if (gateAnalysis.isAllPassive) {
            refreshAndNotifyGuideProgress(getContentKey());
          }
        }
      }

      // Trigger global reactive check to enable next eligible steps
      // Also trigger watchNextStep to help the next step unlock if it has requirements
      import('../../requirements-manager').then(({ SequentialRequirementsManager }) => {
        SequentialRequirementsManager.getInstance().triggerReactiveCheck();
        SequentialRequirementsManager.getInstance().watchNextStep(3000); // Watch for 3 seconds
      });
    }
  }, [isCompleted, sectionId, stepComponents.length, isPreviewMode, gateAnalysis.isAllPassive]);

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

  // Handle individual step completion. The completion write itself goes
  // through `markStepCompleted` (idempotent — re-firing is a no-op once
  // the store has the entry). This callback handles the section's own
  // side effects: clearing the executing-step pointer, firing the legacy
  // event that other listeners still depend on, and surfacing
  // `onComplete` when the section is finished.
  const handleStepComplete = useCallback(
    (stepId: string, skipStateUpdate = false) => {
      // GUARD: short-circuit if already complete. The store is idempotent
      // but cheap callers (auto-detection, multi-firing useEffects) can
      // still benefit from skipping the bookkeeping below.
      if (completedSteps.has(stepId)) {
        return;
      }

      if (!skipStateUpdate) {
        // `markStepCompleted` writes to the store and itself dispatches
        // `pathfinder:progress` (kind === 'step'), so no manual event
        // is needed here — every listener observes the change via the
        // store's notify path.
        markStepCompleted(stepId, sectionId, 'manual');
        setCurrentlyExecutingStep(null);

        // `completedSteps` is the render-snapshot from the most recent
        // commit, so it doesn't yet contain `stepId`. Build the
        // post-write set explicitly and check every step in the roster
        // against it. This is robust to any future change in store
        // sync semantics (e.g. async store) — unlike a `size + 1`
        // arithmetic check, which would lie if the write became
        // asynchronous.
        const postWriteCompleted = new Set(completedSteps);
        postWriteCompleted.add(stepId);
        const allStepsCompleted = stepComponents.every((s) => postWriteCompleted.has(s.stepId));
        if (allStepsCompleted) {
          onComplete?.();
        }
      } else {
        setCurrentlyExecutingStep(null);
      }
    },
    [completedSteps, onComplete, sectionId, stepComponents]
  );

  /**
   * Handle individual step reset (redo functionality)
   * Removes the target step and all subsequent steps from completion state.
   * Any reset path clears the acknowledgement bit so re-completing always
   * re-triggers the #842 gate.
   */
  const handleStepReset = useCallback(
    (stepId: string) => {
      const resetIndex = stepComponents.findIndex((step) => step.stepId === stepId);
      if (resetIndex < 0) {
        return;
      }

      const tailStepIds: string[] = [];
      for (let i = resetIndex; i < stepComponents.length; i++) {
        tailStepIds.push(stepComponents[i]!.stepId);
      }

      // Single bulk write to the store; one notify pass instead of one per step.
      resetSteps(tailStepIds, sectionId);

      // Acknowledgement must clear alongside completion (#842, Bug 1).
      dispatch({ type: 'CLEAR_ACK' });
      clearStepAcknowledgement();

      if (currentlyExecutingStep === stepId) {
        setCurrentlyExecutingStep(null);
      }

      // Notify child steps to clear their local UI state (e.g. quiz selection,
      // guided executor's transient state).
      setResetTrigger((prev) => prev + 1);
    },
    [clearStepAcknowledgement, currentlyExecutingStep, sectionId, stepComponents]
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
      // Single atomic store reset; reducer clears the ack bit too.
      resetSectionStore(sectionId);
      dispatch({ type: 'CLEAR_ACK' });
      startIndex = 0;
    }

    // Check section-level requirements first and apply same priority logic
    if (controllerRequirements) {
      const sectionRequirementsData = {
        requirements: controllerRequirements,
        targetAction: 'section',
        refTarget: `section-${sectionId}`,
        targetValue: undefined,
        textContent: title || DEFAULT_INTERACTIVE_SECTION_TITLE,
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
              } else if (controllerRequirements.includes('navmenu-open')) {
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
      refTarget: `section-${sectionId}`,
      targetAction: 'section',
      targetValue: undefined,
      requirements: undefined,
      tagName: 'section',
      textContent: title || DEFAULT_INTERACTIVE_SECTION_TITLE,
      timestamp: Date.now(),
      isPartOfSection: true,
    };
    startSectionBlocking(sectionId, dummyData, handleSectionCancel);

    let stoppedDueToRequirements = false;
    let completedStepsCount = startIndex; // Track number of completed steps for analytics (starts at startIndex since those are already done)
    // The completion store handles per-step persistence synchronously via
    // `markStepCompleted` — every write hits the store + storage immediately,
    // independent of whether the component is still mounted. This is the
    // mid-section unmount fix (auto-dock from fullscreen): the prior
    // implementation tracked an accumulator + called `persistCompletedSteps`
    // wrapped in a functional setState updater, which React skipped on
    // unmount and silently lost the per-step writes.

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
            targetAction: stepInfo.targetAction || 'button',
            refTarget: stepInfo.refTarget || '',
            targetValue: stepInfo.targetValue,
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
          completedStepsCount = i + 1;

          // Single synchronous write to the store; survives a mid-section
          // unmount because the store is module-scope and storage writes
          // are fire-and-forget.
          markStepCompleted(stepInfo.stepId, sectionId, 'manual');

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
        // Belt-and-braces bulk write so any steps that didn't go through the
        // per-step path (e.g. skipped via fix → `markSkipped` → `handleStepComplete`)
        // also end up in the store. `markStepsCompleted` is idempotent.
        const allStepIds = stepComponents.map((step) => step.stepId);
        markStepsCompleted(allStepIds, sectionId, 'manual');
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
    controllerRequirements,
    checkRequirementsFromData,
    scrollToStep,
    beginProgrammaticScroll,
    endProgrammaticScroll,
  ]);

  /**
   * Handle complete section reset
   * Clears all completion state and resets all steps to initial state
   */
  const handleResetSection = useCallback(() => {
    if (disabled || isRunning) {
      return;
    }

    // Clear step completion via the store, ack via the reducer, ack +
    // collapse storage via the persistence hook. Three writers, one
    // call site — invariants now live with their respective owners.
    resetSectionStore(sectionId);
    dispatch({ type: 'CLEAR_ACK' });
    setCurrentlyExecutingStep(null);

    // Expand the section and clear the auto-collapse-once guard so a
    // future completion re-fires the auto-collapse.
    resetCollapse();

    // Signal all child steps to reset their local state
    setResetTrigger((prev) => prev + 1);

    // Clear ack + collapse storage. Hook gates on preview mode internally.
    clearAckAndCollapseStorage();

    // Notify listeners that progress for this content was cleared (#842, Bug 2).
    // Mirrors the dispatch in BlockPreview's reset() so any consumer driving
    // ephemeral UI off `interactive-progress-cleared` — most importantly
    // `useGuidePreviewProgress`, which controls the "Reset guide" button
    // visibility — sees the section-level reset path too. Without this the
    // block-editor preview's Reset guide button stays visible after a
    // per-section reset, even when no progress is left.
    if (typeof window !== 'undefined') {
      const contentKey = getContentKey();
      window.dispatchEvent(
        new CustomEvent('interactive-progress-cleared', {
          detail: { contentKey },
        })
      );
      // All-passive sections bypass `persistSection` on reset too;
      // recompute so the persisted percentage drops in lockstep.
      if (!isPreviewMode) {
        refreshAndNotifyGuideProgress(contentKey);
      }
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
  }, [disabled, isRunning, stepComponents, resetCollapse, clearAckAndCollapseStorage, sectionId, isPreviewMode]);

  /**
   * Mark the section as acknowledged (issue #842).
   *
   * Available only when the gate is active and pending — i.e. the
   * derived state is 'awaiting-ack'. For all-passive sections there
   * are no real steps to count, so we pass `completedCount: 1` to
   * satisfy the reducer's "ack requires completion" invariant
   * without writing a synthetic step into the store.
   */
  const handleMarkSectionComplete = useCallback(() => {
    if (disabled || isRunning || sectionKind !== 'awaiting-ack') {
      return;
    }
    const completedCount = gateAnalysis.isAllPassive ? 1 : completedSteps.size;
    dispatch({ type: 'ACKNOWLEDGE', completedCount });
    setAcknowledgement();
  }, [disabled, isRunning, sectionKind, gateAnalysis.isAllPassive, completedSteps, setAcknowledgement]);

  // Register this section's steps in the global registry BEFORE rendering children
  // This must happen in useMemo (not useEffect) to ensure totalDocumentSteps is correct
  // when getDocumentStepPosition is called during the enhancedChildren memo
  useMemo(() => {
    registerSectionSteps(sectionId, stepComponents.length);
  }, [sectionId, stepComponents.length]);

  // Document-wide step progress (window globals + `pathfinder-step-progress`
  // CustomEvent) is owned by `useDocumentStepProgress`. Pattern J:
  // contract-surface ownership move; the contracts tripwire pins the
  // payload shape across the seam.
  useDocumentStepProgress({
    sectionId,
    currentlyExecutingStep,
    stepComponents,
    completedSteps,
  });

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

    // eslint-disable-next-line react-hooks/refs -- the stepRefs/multiStepRefs Maps are read inside the ref callback, which runs at commit time, not during render
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
      const isCurrentlyExecuting = currentlyExecutingStep === stepInfo.stepId;
      const { stepIndex: documentStepIndex, totalSteps: documentTotalSteps } = getDocumentStepPosition(
        sectionId,
        stepIndex
      );

      const enhanceCtx: EnhanceContext = {
        stepInfo,
        isEligibleForChecking,
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
          <span className="interactive-section-title">{displayTitle}</span>
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
        <div
          className="interactive-section-requirements-banner"
          data-testid={testIds.interactive.sectionRequirementsBanner(sectionId)}
        >
          <div className="interactive-section-requirements-content">
            <span className="interactive-section-requirements-icon">🔒</span>
            <span className="interactive-section-requirements-message">
              {sectionRequirementsStatus.explanation || 'Requirements not yet met'}
            </span>
          </div>
          {sectionRequirementsStatus.canFix && (
            <div className="interactive-step-requirement-buttons">
              <button
                type="button"
                className="interactive-requirement-retry-btn"
                data-testid={testIds.interactive.requirementFixButton(sectionId)}
                onClick={fixSectionRequirements}
              >
                Fix this
              </button>
            </div>
          )}
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
