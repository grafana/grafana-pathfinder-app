import { useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import { useTheme2 } from '@grafana/ui';
import { addGlobalInteractiveStyles, updateInteractiveThemeColors } from '../styles/interactive.styles';
import { sleep, waitForReactUpdates } from '../lib/async-utils';
import { logger } from '../lib/logging';
import { withFaroUserAction } from '../lib/faro';
import { createInteractionName, UserInteraction } from '../lib/analytics';
import type { StepOutcome } from '../lib/telemetry';
import { assertExhaustive } from '../lib/assert-exhaustive';
// eslint-disable-next-line no-restricted-imports -- [ratchet] ALLOWED_LATERAL_VIOLATIONS: interactive-engine -> requirements-manager
import { useGuideRequirements, RequirementsCheckOptions } from '../requirements-manager';
import { extractInteractiveDataFromElement } from '../lib/dom';
import {
  ActionExecutionResult,
  InteractiveActionRequest,
  InteractiveElementData,
  InteractiveRequirementsData,
} from '../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { isGrafanaDrivingHandoffNeeded, requestSidebarHandoffAndWait } from '../global-state/panel-mode';
import { InteractiveStateManager } from './interactive-state-manager';
import { NavigationManager } from './navigation-manager';
import {
  FocusHandler,
  ButtonHandler,
  NavigateHandler,
  FormFillHandler,
  HoverHandler,
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

export function useInteractiveElements(_options: UseInteractiveElementsOptions = {}) {
  const activeRuns = useRef(new Set<{ controller: AbortController; handoff: boolean }>());
  useEffect(
    () => () => {
      activeRuns.current.forEach((run) => {
        if (!run.handoff) {
          run.controller.abort();
        }
      });
    },
    []
  );

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
      return focusHandler.execute(data, click);
    },
    [focusHandler]
  );

  const interactiveButton = useCallback(
    async (data: InteractiveElementData, click: boolean) => {
      return buttonHandler.execute(data, click);
    },
    [buttonHandler]
  );

  const interactiveFormFill = useCallback(
    async (data: InteractiveElementData, fillForm: boolean) => {
      return formFillHandler.execute(data, fillForm);
    },
    [formFillHandler]
  );

  const interactiveNavigate = useCallback(
    async (data: InteractiveElementData, navigate: boolean) => {
      return navigateHandler.execute(data, navigate);
    },
    [navigateHandler]
  );

  const interactiveHover = useCallback(
    async (data: InteractiveElementData, performHover: boolean) => {
      return hoverHandler.execute(data, performHover);
    },
    [hoverHandler]
  );

  const interactivePopout = useCallback(
    async (data: InteractiveElementData, perform: boolean) => {
      return popoutHandler.execute(data, perform);
    },
    [popoutHandler]
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
        lazyRender: data.lazyRender,
        scrollContainer: data.scrollContainer,
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
      if (activeRuns.current.size > 0) {
        return 'error';
      }
      const run = { controller: new AbortController(), handoff: false };
      activeRuns.current.add(run);
      const abort = () => run.controller.abort();
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted) {
        abort();
      }
      try {
        const {
          targetAction,
          refTarget = '',
          targetValue,
          targetState,
          targetComment,
          buttonType = 'do',
          fullScreenFallbackLocation,
        } = request;
        // Create InteractiveElementData directly from parameters
        const elementData: InteractiveElementData = {
          refTarget: refTarget,
          signal: run.controller.signal,
          lazyRender: request.lazyRender,
          scrollContainer: request.scrollContainer,
          targetAction: targetAction,
          targetValue: targetValue,
          targetState: targetState,
          targetComment: targetComment,
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
        // there yet; handlers report failed resolution without completing it.
        if (isGrafanaDrivingHandoffNeeded(targetAction)) {
          run.handoff = true;
          await requestSidebarHandoffAndWait({ targetPath: fullScreenFallbackLocation });
        }

        let executionResult: ActionExecutionResult = { outcome: 'ok' };
        await withFaroUserAction(
          isShowMode
            ? createInteractionName(UserInteraction.ShowMeButtonClick)
            : createInteractionName(UserInteraction.DoItButtonClick),
          { target_action: targetAction, ref_target: refTarget },
          async () => {
            try {
              run.controller.signal.throwIfAborted();
              switch (targetAction) {
                case 'highlight':
                  executionResult = await interactiveFocus(elementData, !isShowMode);
                  break;

                case 'button':
                  executionResult = await interactiveButton(elementData, !isShowMode);
                  break;

                case 'formfill':
                  executionResult = await interactiveFormFill(elementData, !isShowMode);
                  break;

                case 'navigate':
                  executionResult = await interactiveNavigate(elementData, !isShowMode);
                  break;

                case 'hover':
                  executionResult = await interactiveHover(elementData, !isShowMode);
                  break;

                case 'guided':
                  executionResult = { outcome: 'error', reason: 'unsupported_action' };
                  break;

                case 'popout':
                  executionResult = await interactivePopout(elementData, !isShowMode);
                  break;

                case 'multistep':
                  executionResult = { outcome: 'error', reason: 'unsupported_action' };
                  break;

                case 'noop':
                  if (isShowMode && targetComment) {
                    navigationManager.showNoopComment(targetComment);
                    await sleep(2000, run.controller.signal);
                    navigationManager.clearOwnedHighlights();
                  }
                  break;

                default:
                  logger.warn(`Unknown interactive action: ${targetAction}`);
                  assertExhaustive(targetAction);
              }
            } catch (error) {
              stateManager.handleError(error as Error, 'executeInteractiveAction', elementData, false);
              executionResult = run.controller.signal.aborted
                ? { outcome: 'cancelled' }
                : { outcome: 'error', reason: 'action_failed' };
            }
          },
          undefined,
          {
            critical: !isShowMode,
            outcomeFrom: () => executionResult.outcome,
          }
        );
        return executionResult.outcome === 'ok' && !run.controller.signal.aborted ? 'ok' : 'error';
      } finally {
        request.signal?.removeEventListener('abort', abort);
        if (run.controller.signal.aborted) {
          navigationManager.clearOwnedHighlights();
        }
        activeRuns.current.delete(run);
      }
    },
    [
      interactiveFocus,
      interactiveButton,
      interactiveFormFill,
      interactiveNavigate,
      interactiveHover,
      interactivePopout,
      stateManager,
      navigationManager,
    ]
  );

  return {
    // Low-level action methods - primarily for testing, use executeInteractiveAction for new code
    interactiveFocus,
    interactiveButton,
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
