import { useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { useTheme2 } from '@grafana/ui';
import { addGlobalInteractiveStyles, updateInteractiveThemeColors } from '../styles/interactive.styles';
import { waitForReactUpdates } from '../lib/async-utils';
import { logger } from '../lib/logging';
import { USER_ACTION_TIMEOUT_LONG_MS, withFaroUserAction } from '../lib/faro';
import { createInteractionName, UserInteraction } from '../lib/analytics';
import type { SequenceRunResult, StepOutcome } from '../lib/telemetry';
import { outcomeFromSequenceRun } from './outcome-classifier';
import { assertExhaustive } from '../lib/assert-exhaustive';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_LATERAL_VIOLATIONS: interactive-engine -> requirements-manager
import { useGuideRequirements, RequirementsCheckOptions } from '../requirements-manager';
import { extractInteractiveDataFromElement } from '../lib/dom';
import {
  InteractiveActionRequest,
  InteractiveElementData,
  InteractiveRequirementsData,
} from '../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { isGrafanaDrivingHandoffNeeded, requestSidebarHandoffAndWait } from '../global-state/panel-mode';
import { InteractiveStateManager } from './interactive-state-manager';
import { SequenceManager } from './sequence-manager';
import { NavigationManager } from './navigation-manager';
import {
  FocusHandler,
  ButtonHandler,
  NavigateHandler,
  FormFillHandler,
  HoverHandler,
  GuidedHandler,
  PopoutHandler,
} from './action-handlers';
import type { UseInteractiveElementsOptions } from '../types/hooks.types';

// Re-export CheckResult and InteractiveRequirementsCheck for backward compatibility
export interface InteractiveRequirementsCheck {
  requirements: string;
  pass: boolean;
  error: CheckResult[];
}

export interface CheckResult {
  requirement: string;
  pass: boolean;
  error?: string;
  context?: any;
  canFix?: boolean;
  fixType?: string;
  targetHref?: string;
}

function isValidInteractiveElement(data: InteractiveElementData): boolean {
  return Boolean(data.refTarget);
}

export function useInteractiveElements(options: UseInteractiveElementsOptions = {}) {
  const { containerRef } = options;
  const { checkRequirements, checkPostconditions } = useGuideRequirements();

  // Get current theme for CSS custom property updates
  const theme = useTheme2();

  // Initialize state manager
  const stateManager = useMemo(() => new InteractiveStateManager(), []);

  // Initialize navigation manager
  const navigationManager = useMemo(() => new NavigationManager(), []);

  // Initialize action handlers
  const focusHandler = useMemo(
    () => new FocusHandler(stateManager, navigationManager, waitForReactUpdates),
    [stateManager, navigationManager]
  );

  const buttonHandler = useMemo(
    () => new ButtonHandler(stateManager, navigationManager, waitForReactUpdates),
    [stateManager, navigationManager]
  );

  const navigateHandler = useMemo(() => new NavigateHandler(stateManager, waitForReactUpdates), [stateManager]);

  const formFillHandler = useMemo(
    () => new FormFillHandler(stateManager, navigationManager, waitForReactUpdates),
    [stateManager, navigationManager]
  );

  const hoverHandler = useMemo(
    () => new HoverHandler(stateManager, navigationManager, waitForReactUpdates),
    [stateManager, navigationManager]
  );

  const guidedHandler = useMemo(
    () => new GuidedHandler(stateManager, navigationManager, waitForReactUpdates),
    [stateManager, navigationManager]
  );

  const popoutHandler = useMemo(() => new PopoutHandler(stateManager, waitForReactUpdates), [stateManager]);

  // Inject the global style tag once on mount — idempotent, no cleanup needed.
  useEffect(() => {
    addGlobalInteractiveStyles();
  }, []);

  // Update CSS custom properties whenever the theme changes (light/dark mode switch).
  // useLayoutEffect runs before paint, eliminating any flash of dark fallback colors on
  // light-mode Grafana. Separate from the style injection above so addGlobalInteractiveStyles()
  // is not re-called on every theme toggle.
  useLayoutEffect(() => {
    updateInteractiveThemeColors(theme);
  }, [theme]);

  const interactiveFocus = useCallback(
    async (data: InteractiveElementData, click: boolean) => {
      await focusHandler.execute(data, click);
    },
    [focusHandler]
  );

  const interactiveButton = useCallback(
    async (data: InteractiveElementData, click: boolean) => {
      await buttonHandler.execute(data, click);
    },
    [buttonHandler]
  );

  // Create stable refs for helper functions to avoid circular dependencies
  const activeRefsRef = useRef(new Set<string>());

  const interactiveFormFill = useCallback(
    async (data: InteractiveElementData, fillForm: boolean) => {
      await formFillHandler.execute(data, fillForm);
    },
    [formFillHandler]
  );

  const interactiveNavigate = useCallback(
    async (data: InteractiveElementData, navigate: boolean) => {
      await navigateHandler.execute(data, navigate);
    },
    [navigateHandler]
  );

  const interactiveHover = useCallback(
    async (data: InteractiveElementData, performHover: boolean) => {
      await hoverHandler.execute(data, performHover);
    },
    [hoverHandler]
  );

  const interactiveGuided = useCallback(
    async (data: InteractiveElementData, performGuided: boolean) => {
      await guidedHandler.execute(data, performGuided);
    },
    [guidedHandler]
  );

  const interactivePopout = useCallback(
    async (data: InteractiveElementData, perform: boolean) => {
      await popoutHandler.execute(data, perform);
    },
    [popoutHandler]
  );

  // Define helper functions using refs to avoid circular dependencies
  const dispatchInteractiveAction = useCallback(
    async (data: InteractiveElementData, click: boolean) => {
      await withFaroUserAction(
        click
          ? createInteractionName(UserInteraction.DoItButtonClick)
          : createInteractionName(UserInteraction.ShowMeButtonClick),
        { target_action: data.targetAction, ref_target: data.refTarget },
        async () => {
          if (data.targetAction === 'highlight') {
            await interactiveFocus(data, click);
          } else if (data.targetAction === 'button') {
            await interactiveButton(data, click);
          } else if (data.targetAction === 'formfill') {
            await interactiveFormFill(data, click);
          } else if (data.targetAction === 'navigate') {
            interactiveNavigate(data, click);
          } else if (data.targetAction === 'hover') {
            await interactiveHover(data, click);
          } else if (data.targetAction === 'guided') {
            await interactiveGuided(data, click);
          } else if (data.targetAction === 'popout') {
            await interactivePopout(data, click);
          }
        },
        undefined,
        // "Do it" is the funnel action; "Show me" is just a preview.
        { critical: click }
      );
    },
    [
      interactiveFocus,
      interactiveButton,
      interactiveFormFill,
      interactiveNavigate,
      interactiveHover,
      interactiveGuided,
      interactivePopout,
    ]
  );

  /**
   * Utility to wait for async effects triggered by actions (network, UI updates)
   */
  const waitForActionToSettle = useCallback(async (targetAction?: string) => {
    // Heuristic delays by action type plus double RAF
    await waitForReactUpdates();
    if (targetAction === 'button' || targetAction === 'formfill') {
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.button));
    } else if (targetAction === 'highlight') {
      // Highlight actions in "Do" mode click elements, so need same delay as buttons
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.button));
    } else if (targetAction === 'navigate') {
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.technical.navigation));
    } else if (targetAction === 'hover') {
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.hover));
    } else {
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.base));
    }
    await waitForReactUpdates();
  }, []);

  /**
   * Core requirement checking logic using the new pure requirements utility
   */
  const checkRequirementsFromData = useCallback(
    async (data: InteractiveRequirementsData): Promise<InteractiveRequirementsCheck> => {
      const options: RequirementsCheckOptions = {
        requirements: data.requirements || '',
        targetAction: data.targetAction,
        refTarget: data.refTarget,
        targetValue: data.targetValue,
        stepId: data.textContent || 'unknown',
      };

      // Use the new pure requirements checker
      const result = await checkRequirements(options);

      // Convert to the expected format for backward compatibility
      return {
        requirements: result.requirements,
        pass: result.pass,
        error: result.error.map((e) => ({
          requirement: e.requirement,
          pass: e.pass,
          error: e.error,
          context: e.context,
          canFix: e.canFix,
          fixType: e.fixType,
          targetHref: e.targetHref,
        })),
      };
    },
    [checkRequirements]
  );

  /**
   * Postconditions checker using the new verification path
   */
  const verifyStepResult = useCallback(
    async (
      verifyString: string,
      targetAction?: string,
      refTarget?: string,
      targetValue?: string,
      stepId?: string
    ): Promise<InteractiveRequirementsCheck> => {
      const options: RequirementsCheckOptions = {
        requirements: verifyString || '',
        targetAction,
        refTarget,
        targetValue,
        stepId,
      };
      // Ensure any action-triggered async operations have time to settle
      await waitForActionToSettle(targetAction);
      const result = await checkPostconditions(options);
      return {
        requirements: result.requirements,
        pass: result.pass,
        error: result.error.map((e) => ({
          requirement: e.requirement,
          pass: e.pass,
          error: e.error,
          context: e.context,
          canFix: e.canFix,
          fixType: e.fixType,
          targetHref: e.targetHref,
        })),
      };
    },
    [checkPostconditions, waitForActionToSettle]
  );

  // SequenceManager instance - moved here to be available for interactiveSequence
  const sequenceManager = useMemo(
    () =>
      new SequenceManager(
        stateManager,
        checkRequirementsFromData,
        dispatchInteractiveAction,
        waitForReactUpdates,
        isValidInteractiveElement,
        extractInteractiveDataFromElement
      ),
    [stateManager, checkRequirementsFromData, dispatchInteractiveAction]
  );

  const interactiveSequence = useCallback(
    async (data: InteractiveElementData, showOnly: boolean): Promise<SequenceRunResult> => {
      // Recursion guard — a re-entrant call is a no-op, not a failure.
      if (activeRefsRef.current.has(data.refTarget)) {
        return 'completed';
      }

      stateManager.setState(data, 'running');

      try {
        // Resolve grafana: prefix if present
        const { resolveSelector } = await import('../lib/dom');
        const resolvedSelector = resolveSelector(data.refTarget);

        const searchContainer = containerRef?.current || document;
        const targetElements = searchContainer.querySelectorAll(resolvedSelector);

        if (targetElements.length === 0) {
          const msg = `No interactive sequence container found matching selector: ${resolvedSelector}`;
          stateManager.handleError(msg, 'interactiveSequence', data, true);
        }

        if (targetElements.length > 1) {
          const msg = `${targetElements.length} interactive sequence containers found matching selector: ${resolvedSelector} - this is not supported (must be exactly 1)`;
          stateManager.handleError(msg, 'interactiveSequence', data, true);
        }

        activeRefsRef.current.add(data.refTarget);

        // Find all interactive elements within the sequence container
        const interactiveElements = Array.from(
          targetElements[0]!.querySelectorAll('.interactive[data-targetaction]:not([data-targetaction="sequence"])')
        );

        if (interactiveElements.length === 0) {
          const msg = `No interactive elements found within sequence container: ${data.refTarget}`;
          stateManager.handleError(msg, 'interactiveSequence', data, true);
        }

        const result = !showOnly
          ? // Full sequence: Show each step, then do each step, one by one
            await sequenceManager.runStepByStepSequence(interactiveElements)
          : // Show only mode
            await sequenceManager.runInteractiveSequence(interactiveElements, true);

        // Only a fully completed run may emit interactive-action-completed —
        // retry exhaustion resolves without throwing.
        stateManager.setState(data, result === 'completed' ? 'completed' : 'error');

        activeRefsRef.current.delete(data.refTarget);
        return result;
      } catch (error) {
        stateManager.handleError(error as Error, 'interactiveSequence', data, false);
        activeRefsRef.current.delete(data.refTarget);
      }

      return 'action_error';
    },
    [containerRef, activeRefsRef, sequenceManager, stateManager]
  );

  /**
   * Check requirements directly from a DOM element
   */
  const checkElementRequirements = useCallback(
    async (element: HTMLElement): Promise<InteractiveRequirementsCheck> => {
      const data = extractInteractiveDataFromElement(element);
      if (data === null) {
        return {
          requirements: '',
          pass: false,
          error: [
            {
              requirement: 'data-targetaction',
              pass: false,
              error: 'Missing or unknown data-targetaction',
            },
          ],
        };
      }
      return checkRequirementsFromData(data);
    },
    [checkRequirementsFromData]
  );

  // Legacy custom event system removed - all interactions now handled by modern direct click handlers

  /**
   * Direct interface for React components to execute interactive actions
   * without needing DOM elements or the bridge pattern
   */
  const executeInteractiveAction = useCallback(
    async (request: InteractiveActionRequest): Promise<StepOutcome> => {
      const {
        targetAction,
        refTarget = '',
        targetValue,
        targetState,
        targetComment,
        openGuide,
        buttonType = 'do',
        fullScreenFallbackLocation,
      } = request;
      // Create InteractiveElementData directly from parameters
      const elementData: InteractiveElementData = {
        refTarget: refTarget,
        targetAction: targetAction,
        targetValue: targetValue,
        targetState: targetState,
        targetComment: targetComment,
        openGuide,
        requirements: undefined,
        tagName: 'button', // Simulated for React components
        textContent: `${buttonType === 'show' ? 'Show me' : 'Do'}: ${refTarget}`,
        timestamp: Date.now(),
        fullScreenFallbackLocation,
      };

      // No DOM element needed - React components manage their own state
      const isShowMode = buttonType === 'show';

      // Full screen has no live Grafana UI behind it. A Grafana-driving
      // action — "Show me" or "Do it" alike — hands off to the sidebar
      // first, navigating to the resolved fallback location
      // (step/milestone/course — see content-renderer.tsx) so the click has
      // something to preview or act on once docked. Waits for the sidebar to
      // actually mount before proceeding, rather than expanding the action
      // handler's own resolveWithRetry budget. The target may still not be
      // there yet (navigation itself can be slow) — skipCompletionOnEmptyTarget
      // stops that from being silently reported as done.
      if (isGrafanaDrivingHandoffNeeded(targetAction)) {
        await requestSidebarHandoffAndWait({ targetPath: fullScreenFallbackLocation });
        elementData.skipCompletionOnEmptyTarget = true;
      }

      // Sequence runs resolve on failure, so the captured result — not
      // promise settlement — stamps the action outcome.
      let sequenceResult: SequenceRunResult | undefined;
      await withFaroUserAction(
        isShowMode
          ? createInteractionName(UserInteraction.ShowMeButtonClick)
          : createInteractionName(UserInteraction.DoItButtonClick),
        { target_action: targetAction, ref_target: refTarget },
        async () => {
          try {
            switch (targetAction) {
              case 'highlight':
                await interactiveFocus(elementData, !isShowMode);
                break;

              case 'button':
                await interactiveButton(elementData, !isShowMode);
                break;

              case 'formfill':
                await interactiveFormFill(elementData, !isShowMode);
                break;

              case 'navigate':
                interactiveNavigate(elementData, !isShowMode);
                break;

              case 'hover':
                await interactiveHover(elementData, !isShowMode);
                break;

              case 'guided':
                await interactiveGuided(elementData, !isShowMode);
                break;

              case 'popout':
                await interactivePopout(elementData, !isShowMode);
                break;

              case 'sequence':
                sequenceResult = await interactiveSequence(elementData, isShowMode);
                break;

              case 'multistep':
                logger.warn('multistep is executed by InteractiveMultiStep, not the element action path');
                break;

              case 'noop':
                // Noop actions are informational - no element interaction needed
                // In show mode, briefly display the comment if provided
                // In do mode, just mark as completed (nothing to execute)
                if (isShowMode && targetComment) {
                  // Show a brief notification with the comment
                  // Use navigationManager to show a floating comment briefly
                  navigationManager.showNoopComment(targetComment);
                  // Auto-dismiss after a delay
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                  navigationManager.clearAllHighlights();
                }
                // Do mode: nothing to do - noop steps complete immediately
                break;

              default:
                logger.warn(`Unknown interactive action: ${targetAction}`);
                assertExhaustive(targetAction);
            }
          } catch (error) {
            stateManager.handleError(error as Error, 'executeInteractiveAction', elementData, true);
          }
        },
        targetAction === 'sequence' ? USER_ACTION_TIMEOUT_LONG_MS : undefined,
        {
          critical: !isShowMode,
          // Checked here (not just after the span closes below) so a handler
          // that suppressed its own completion doesn't get its Faro span
          // stamped 'ok' before the suppression is known — completionSuppressed
          // is set synchronously inside the awaited handler, before this runs.
          outcomeFrom: () => (elementData.completionSuppressed ? 'error' : outcomeFromSequenceRun(sequenceResult)),
        }
      );
      // A handler that suppressed its own completion (skipCompletionOnEmptyTarget)
      // reports it here — otherwise the return value would say 'ok' and the
      // caller's own completion persistence, which only checks this outcome,
      // would mark the step done anyway.
      if (elementData.completionSuppressed) {
        return 'error';
      }
      // Sequence runs resolve rather than throw on requirements-exhausted/
      // action-error, so callers must check this instead of assuming
      // settlement means success — see the outcomeFrom mapping above.
      return sequenceResult === undefined || sequenceResult === 'completed' ? 'ok' : 'error';
    },
    [
      interactiveFocus,
      interactiveButton,
      interactiveFormFill,
      interactiveNavigate,
      interactiveHover,
      interactiveGuided,
      interactivePopout,
      interactiveSequence,
      stateManager,
      navigationManager,
    ]
  );

  return {
    // Low-level action methods - primarily for testing, use executeInteractiveAction for new code
    interactiveFocus,
    interactiveButton,
    interactiveSequence,
    interactiveFormFill,
    interactiveNavigate,

    // Requirements checking
    checkElementRequirements,
    checkRequirementsFromData, // Keep - used in step-checker, multi-step, and section components
    verifyStepResult,

    // High-level action method - preferred for new code
    executeInteractiveAction,
    fixNavigationRequirements: () => navigationManager.fixNavigationRequirements(),

    // Emergency method for safety
    forceUnblock: () => stateManager.forceUnblock(),

    // Section-level blocking methods
    startSectionBlocking: (sectionId: string, data: InteractiveElementData, cancelCallback?: () => void) =>
      stateManager.startSectionBlocking(sectionId, data, cancelCallback),
    stopSectionBlocking: (sectionId: string) => stateManager.stopSectionBlocking(sectionId),
    isSectionBlocking: () => stateManager.isSectionBlocking(),
    cancelSection: () => stateManager.cancelSection(),
  };
}
