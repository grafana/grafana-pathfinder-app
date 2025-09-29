import { useEffect, useCallback, useRef, useMemo } from 'react';
import { addGlobalInteractiveStyles } from '../styles/interactive.styles';
import { waitForReactUpdates } from './requirements-checker.hook';
import { checkRequirements, checkPostconditions, RequirementsCheckOptions } from './requirements-checker.utils';
import { extractInteractiveDataFromElement } from './dom-utils';
import { InteractiveElementData } from '../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { InteractiveStateManager } from './interactive-state-manager';
import { SequenceManager } from './sequence-manager';
import { NavigationManager } from './navigation-manager';
import { FocusHandler, ButtonHandler, NavigateHandler, FormFillHandler } from './action-handlers';

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

interface UseInteractiveElementsOptions {
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * This function is a guard to ensure that the interactive element data is valid.  It can encapsulte
 * new rules and checks as we go.
 * @param data - The interactive element data
 * @returns boolean - true if the interactive element data is valid, false otherwise
 */
function isValidInteractiveElement(data: InteractiveElementData): boolean {
  // Double negative coerces string into boolean
  return !!data.targetaction && !!data.reftarget;
}

export function useInteractiveElements(options: UseInteractiveElementsOptions = {}) {
  const { containerRef } = options;

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

  // Initialize global interactive styles
  useEffect(() => {
    addGlobalInteractiveStyles();
  }, []);

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

  // Define helper functions using refs to avoid circular dependencies
  const dispatchInteractiveAction = useCallback(
    async (data: InteractiveElementData, click: boolean) => {
      if (data.targetaction === 'highlight') {
        await interactiveFocus(data, click);
      } else if (data.targetaction === 'button') {
        await interactiveButton(data, click);
      } else if (data.targetaction === 'formfill') {
        await interactiveFormFill(data, click);
      } else if (data.targetaction === 'navigate') {
        interactiveNavigate(data, click);
      }
    },
    [interactiveFocus, interactiveButton, interactiveFormFill, interactiveNavigate]
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
    } else {
      await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.perceptual.base));
    }
    await waitForReactUpdates();
  }, []);

  /**
   * Core requirement checking logic using the new pure requirements utility
   */
  const checkRequirementsFromData = useCallback(
    async (data: InteractiveElementData): Promise<InteractiveRequirementsCheck> => {
      const options: RequirementsCheckOptions = {
        requirements: data.requirements || '',
        targetAction: data.targetaction,
        refTarget: data.reftarget,
        targetValue: data.targetvalue,
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
    []
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
    [waitForActionToSettle]
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
    async (data: InteractiveElementData, showOnly: boolean): Promise<string> => {
      // This is here so recursion cannot happen
      if (activeRefsRef.current.has(data.reftarget)) {
        return data.reftarget;
      }

      stateManager.setState(data, 'running');

      try {
        const searchContainer = containerRef?.current || document;
        const targetElements = searchContainer.querySelectorAll(data.reftarget);

        if (targetElements.length === 0) {
          const msg = `No interactive sequence container found matching selector: ${data.reftarget}`;
          stateManager.handleError(msg, 'interactiveSequence', data, true);
        }

        if (targetElements.length > 1) {
          const msg = `${targetElements.length} interactive sequence containers found matching selector: ${data.reftarget} - this is not supported (must be exactly 1)`;
          stateManager.handleError(msg, 'interactiveSequence', data, true);
        }

        activeRefsRef.current.add(data.reftarget);

        // Find all interactive elements within the sequence container
        const interactiveElements = Array.from(
          targetElements[0].querySelectorAll('.interactive[data-targetaction]:not([data-targetaction="sequence"])')
        );

        if (interactiveElements.length === 0) {
          const msg = `No interactive elements found within sequence container: ${data.reftarget}`;
          stateManager.handleError(msg, 'interactiveSequence', data, true);
        }

        if (!showOnly) {
          // Full sequence: Show each step, then do each step, one by one
          await sequenceManager.runStepByStepSequence(interactiveElements);
        } else {
          // Show only mode
          await sequenceManager.runInteractiveSequence(interactiveElements, true);
        }

        // Mark as completed after successful execution
        stateManager.setState(data, 'completed');

        activeRefsRef.current.delete(data.reftarget);
        return data.reftarget;
      } catch (error) {
        stateManager.handleError(error as Error, 'interactiveSequence', data, false);
        activeRefsRef.current.delete(data.reftarget);
      }

      return data.reftarget;
    },
    [containerRef, activeRefsRef, sequenceManager, stateManager]
  );

  /**
   * Check requirements directly from a DOM element
   */
  const checkElementRequirements = useCallback(
    async (element: HTMLElement): Promise<InteractiveRequirementsCheck> => {
      const data = extractInteractiveDataFromElement(element);
      return checkRequirementsFromData(data);
    },
    [checkRequirementsFromData]
  );

  /**
   * Enhanced function that returns both requirements check and extracted data
   */
  const checkRequirementsWithData = async (
    element: HTMLElement
  ): Promise<{
    requirementsCheck: InteractiveRequirementsCheck;
    interactiveData: InteractiveElementData;
  }> => {
    const data = extractInteractiveDataFromElement(element);
    const requirementsCheck = await checkRequirementsFromData(data);
    return { requirementsCheck, interactiveData: data };
  };

  // Legacy custom event system removed - all interactions now handled by modern direct click handlers

  /**
   * Direct interface for React components to execute interactive actions
   * without needing DOM elements or the bridge pattern
   */
  const executeInteractiveAction = useCallback(
    async (
      targetAction: string,
      refTarget: string,
      targetValue?: string,
      buttonType: 'show' | 'do' = 'do',
      targetComment?: string
    ): Promise<void> => {
      // Create InteractiveElementData directly from parameters
      const elementData: InteractiveElementData = {
        reftarget: refTarget,
        targetaction: targetAction,
        targetvalue: targetValue,
        targetcomment: targetComment,
        requirements: undefined,
        tagName: 'button', // Simulated for React components
        textContent: `${buttonType === 'show' ? 'Show me' : 'Do'}: ${refTarget}`,
        timestamp: Date.now(),
      };

      // No DOM element needed - React components manage their own state
      const isShowMode = buttonType === 'show';

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

          case 'sequence':
            await interactiveSequence(elementData, isShowMode);
            break;

          default:
            console.warn(`Unknown interactive action: ${targetAction}`);
        }
      } catch (error) {
        stateManager.handleError(error as Error, 'executeInteractiveAction', elementData, true);
      }
    },
    [interactiveFocus, interactiveButton, interactiveFormFill, interactiveNavigate, interactiveSequence, stateManager]
  );

  return {
    interactiveFocus,
    interactiveButton,
    interactiveSequence,
    interactiveFormFill,
    interactiveNavigate,
    checkElementRequirements,
    checkRequirementsFromData,
    verifyStepResult,
    checkRequirementsWithData,
    executeInteractiveAction, // New direct interface for React components
    fixNavigationRequirements: () => navigationManager.fixNavigationRequirements(), // Add the new function to the return object

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
