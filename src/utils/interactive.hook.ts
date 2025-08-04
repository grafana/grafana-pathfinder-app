import { useEffect, useCallback, useRef, useMemo } from 'react';
import { addGlobalInteractiveStyles } from '../styles/interactive.styles';
import { waitForReactUpdates } from './requirements-checker.hook';
import { 
  checkRequirements, 
  RequirementsCheckOptions, 
  CheckResultError,
  DOMCheckFunctions 
} from './requirements-checker.utils';
import { 
  extractInteractiveDataFromElement, 
  findButtonByText, 
} from './dom-utils';
import { InteractiveElementData } from '../types/interactive.types';
import { InteractiveStateManager } from './interactive-state-manager';
import { SequenceManager } from './sequence-manager';
import { NavigationManager } from './navigation-manager';
import { 
  FocusHandler, 
  ButtonHandler, 
  NavigateHandler, 
  FormFillHandler 
} from './action-handlers';

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
}

interface UseInteractiveElementsOptions {
  containerRef?: React.RefObject<HTMLElement>;
}

/**
 * Ensure element is visible in the viewport by scrolling it into view
 * 
 * @param element - The element to make visible
 * @returns Promise that resolves when element is visible in viewport
 * 
 * @example
 * ```typescript
 * await ensureElementVisible(hiddenElement);
 * // Element is now visible and centered in viewport
 * ```
 */




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

/**
 * Ensure navigation is open if the target element is in the navigation area
 * 
 * @param element - The target element that may require navigation to be open
 * @returns Promise that resolves when navigation is open and accessible
 * 
 * @example
 * ```typescript
 * await ensureNavigationOpen(targetElement);
 * // Navigation menu is now open and docked if needed
 * ```
 */

export function useInteractiveElements(options: UseInteractiveElementsOptions = {}) {
  const { containerRef } = options;
  
  // Initialize state manager
  const stateManager = useMemo(() => new InteractiveStateManager(), []);
  
  // Initialize navigation manager
  const navigationManager = useMemo(() => new NavigationManager(), []);
  
  // Initialize action handlers
  const focusHandler = useMemo(() => new FocusHandler(
    stateManager,
    navigationManager,
    waitForReactUpdates
  ), [stateManager, navigationManager]);

  const buttonHandler = useMemo(() => new ButtonHandler(
    stateManager,
    navigationManager,
    waitForReactUpdates
  ), [stateManager, navigationManager]);

  const navigateHandler = useMemo(() => new NavigateHandler(
    stateManager,
    waitForReactUpdates
  ), [stateManager]);

  const formFillHandler = useMemo(() => new FormFillHandler(
    stateManager,
    navigationManager,
    waitForReactUpdates
  ), [stateManager, navigationManager]);
  
  // Initialize global interactive styles
  useEffect(() => {
    addGlobalInteractiveStyles();
  }, []);
  
  const interactiveFocus = useCallback(async (data: InteractiveElementData, click: boolean) => {
    await focusHandler.execute(data, click);
  }, [focusHandler]);
  
  const interactiveButton = useCallback(async (data: InteractiveElementData, click: boolean) => {
    await buttonHandler.execute(data, click);
  }, [buttonHandler]);

  // Create stable refs for helper functions to avoid circular dependencies
  const activeRefsRef = useRef(new Set<string>());

  const interactiveFormFill = useCallback(async (data: InteractiveElementData, fillForm: boolean) => {
    await formFillHandler.execute(data, fillForm);
  }, [formFillHandler]);

  const interactiveNavigate = useCallback(async (data: InteractiveElementData, navigate: boolean) => {
    await navigateHandler.execute(data, navigate);
  }, [navigateHandler]);

  // Define helper functions using refs to avoid circular dependencies
  const dispatchInteractiveAction = useCallback(async (data: InteractiveElementData, click: boolean) => {
    if (data.targetaction === 'highlight') {
      await interactiveFocus(data, click);
    } else if (data.targetaction === 'button') {
      await interactiveButton(data, click);
    } else if (data.targetaction === 'formfill') {
      await interactiveFormFill(data, click);
    } else if (data.targetaction === 'navigate') {
      interactiveNavigate(data, click);
    }
  }, [interactiveFocus, interactiveButton, interactiveFormFill, interactiveNavigate]);

  /**
   * Create DOM check functions for requirements that need DOM access
   */
    const domCheckFunctions = useMemo((): DOMCheckFunctions => ({
      reftargetExistsCHECK: async (reftarget: string, targetAction: string): Promise<CheckResultError> => {
        // For button actions, check if buttons with matching text exist
        if (targetAction === 'button') {
          const buttons = findButtonByText(reftarget);
          
          if (buttons.length > 0) {
            return {
              requirement: 'exists-reftarget',
              pass: true,
            };
          } else {
            return {
              requirement: 'exists-reftarget',
              pass: false,
              error: `No buttons found containing text: "${reftarget}"`,
            };
          }
        }
        
        // For other actions, check if the CSS selector matches an element
        const targetElement = document.querySelector(reftarget);
        if (targetElement) {
          return {
            requirement: 'exists-reftarget',
            pass: true,
          };
        } 
          
        return {
          requirement: 'exists-reftarget',
          pass: false,
          error: "Element not found",
        };
      },
  
      navmenuOpenCHECK: async (): Promise<CheckResultError> => {
        // Based on your HTML structure, try these selectors in order of preference
        const selectorsToTry = [
          // Most specific to your Grafana version
          'div[data-testid="data-testid navigation mega-menu"]',
          'ul[aria-label="Navigation"]',
          'nav.css-rs8tod',
          // Fallbacks for other versions
          'div[data-testid*="navigation"]',
          'nav[aria-label="Navigation"]',
          'ul[aria-label="Main navigation"]'
        ];
        
        for (const selector of selectorsToTry) {
          const element = document.querySelector(selector);
          if (element) {
            return {
              requirement: 'navmenu-open',
              pass: true,
            };
          }
        }
  
        return {
          requirement: 'navmenu-open',
          pass: false,
          error: "Navigation menu not detected - menu may be closed or selector mismatch",
        };
      }
    }), []);

  /**
   * Core requirement checking logic using the new pure requirements utility
   * Replaces the mock element anti-pattern with direct requirements checking
   */
  const checkRequirementsFromData = useCallback(async (data: InteractiveElementData): Promise<InteractiveRequirementsCheck> => {
    const options: RequirementsCheckOptions = {
      requirements: data.requirements || '',
      targetAction: data.targetaction,
      refTarget: data.reftarget,
      targetValue: data.targetvalue,
      stepId: data.textContent || 'unknown'
    };

    // Use the new pure requirements checker
    const result = await checkRequirements(options, domCheckFunctions);
    
    // Convert to the expected format for backward compatibility
    return {
      requirements: result.requirements,
      pass: result.pass,
      error: result.error.map(e => ({
        requirement: e.requirement,
        pass: e.pass,
        error: e.error,
        context: e.context,
      }))
    };
  }, [domCheckFunctions]);

  // SequenceManager instance - moved here to be available for interactiveSequence
  const sequenceManager = useMemo(() => new SequenceManager(
    stateManager,
    checkRequirementsFromData,
    dispatchInteractiveAction,
    waitForReactUpdates,
    isValidInteractiveElement,
    extractInteractiveDataFromElement
  ), [stateManager, checkRequirementsFromData, dispatchInteractiveAction]);

  const interactiveSequence = useCallback(async (data: InteractiveElementData, showOnly: boolean): Promise<string> => {
    // This is here so recursion cannot happen
    if(activeRefsRef.current.has(data.reftarget)) {
      return data.reftarget;
    }
    
    stateManager.setState(data, 'running');
    
    try {
      const searchContainer = containerRef?.current || document;
      const targetElements = searchContainer.querySelectorAll(data.reftarget);

      if(targetElements.length === 0) {
        const msg = `No interactive sequence container found matching selector: ${data.reftarget}`;
        stateManager.handleError(msg, 'interactiveSequence', data, true);
      }
      
      if(targetElements.length > 1) {
        const msg = `${targetElements.length} interactive sequence containers found matching selector: ${data.reftarget} - this is not supported (must be exactly 1)`;
        stateManager.handleError(msg, 'interactiveSequence', data, true);
      } 

      activeRefsRef.current.add(data.reftarget);

      // Find all interactive elements within the sequence container
      const interactiveElements = Array.from(targetElements[0].querySelectorAll('.interactive[data-targetaction]:not([data-targetaction="sequence"])'));
      
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
  }, [containerRef, activeRefsRef, sequenceManager, stateManager]);

  /**
   * Check requirements directly from a DOM element
   */
  const checkElementRequirements = useCallback(async (element: HTMLElement): Promise<InteractiveRequirementsCheck> => {
    const data = extractInteractiveDataFromElement(element);
    return checkRequirementsFromData(data);
  }, [checkRequirementsFromData]);

  /**
   * Enhanced function that returns both requirements check and extracted data
   */
  const checkRequirementsWithData = async (element: HTMLElement): Promise<{
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
  const executeInteractiveAction = useCallback(async (
    targetAction: string,
    refTarget: string,
    targetValue?: string,
    buttonType: 'show' | 'do' = 'do'
  ): Promise<void> => {
    // Create InteractiveElementData directly from parameters
    const elementData: InteractiveElementData = {
      reftarget: refTarget,
      targetaction: targetAction,
      targetvalue: targetValue,
      requirements: undefined,
      tagName: 'button', // Simulated for React components
      textContent: `${buttonType === 'show' ? 'Show me' : 'Do'}: ${refTarget}`,
      timestamp: Date.now(),
    };

    // No DOM element needed - React components manage their own state
    const isShowMode = buttonType === 'show';

    try {
      // Route to appropriate function based on action type
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
  }, [interactiveFocus, interactiveButton, interactiveFormFill, interactiveNavigate, interactiveSequence, stateManager]);

  /**
   * ============================================================================
   * DOM-DEPENDENT CHECK FUNCTIONS
   * These functions require DOM access and stay in the interactive hook
   * Pure requirement checks have been moved to requirements-checker.utils.ts
   * ============================================================================
   */

  return {
    interactiveFocus,
    interactiveButton,
    interactiveSequence,
    interactiveFormFill,
    interactiveNavigate,
    checkElementRequirements,
    checkRequirementsFromData,
    checkRequirementsWithData,
    executeInteractiveAction, // New direct interface for React components
    fixNavigationRequirements: () => navigationManager.fixNavigationRequirements(), // Add the new function to the return object
  };
} 
