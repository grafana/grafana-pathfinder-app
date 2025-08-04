import { useEffect, useCallback, useRef, useMemo } from 'react';
import { locationService } from '@grafana/runtime';
import { addGlobalInteractiveStyles } from '../styles/interactive.styles';
import { waitForReactUpdates } from './requirements-checker.hook';
import { 
  checkRequirements, 
  RequirementsCheckOptions, 
  CheckResultError,
  DOMCheckFunctions 
} from './requirements-checker.utils';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { 
  extractInteractiveDataFromElement, 
  findButtonByText, 
  resetValueTracker 
} from './dom-utils';
import { InteractiveElementData } from '../types/interactive.types';
import { InteractiveStateManager } from './interactive-state-manager';
import { SequenceManager } from './sequence-manager';

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
const ensureElementVisible = async (element: HTMLElement): Promise<void> => {
  // Check if element is visible in viewport
  const rect = element.getBoundingClientRect();
  const isVisible = (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
  
  if (!isVisible) {
    console.warn('📜 Scrolling element into view for better visibility');
    element.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center', 
      inline: 'center' 
    });
    
    // Wait for scroll animation to complete using DOM settling detection
    await waitForReactUpdates();
  }      
}

const highlight = async (element: HTMLElement) => {
  // First, ensure navigation is open and element is visible
  await ensureNavigationOpen(element);
  await ensureElementVisible(element);
  
  // Add highlight class for better styling
  element.classList.add('interactive-highlighted');
  
  // Create a highlight outline element
  const highlightOutline = document.createElement('div');
  highlightOutline.className = 'interactive-highlight-outline';
  
  // Position the outline around the target element using CSS custom properties
  const rect = element.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
  
  // Use CSS custom properties instead of inline styles to avoid CSP violations
  highlightOutline.style.setProperty('--highlight-top', `${rect.top + scrollTop - 4}px`);
  highlightOutline.style.setProperty('--highlight-left', `${rect.left + scrollLeft - 4}px`);
  highlightOutline.style.setProperty('--highlight-width', `${rect.width + 8}px`);
  highlightOutline.style.setProperty('--highlight-height', `${rect.height + 8}px`);
  
  document.body.appendChild(highlightOutline);
  
  // Remove highlight after animation completes using DOM settling detection
  setTimeout(() => {
    element.classList.remove('interactive-highlighted');
    if (highlightOutline.parentNode) {
      highlightOutline.parentNode.removeChild(highlightOutline);
    }
  }, INTERACTIVE_CONFIG.delays.technical.highlight); // Use configuration instead of magic number
  
  return element;
};

/**
 * Fix navigation requirements by opening and docking the navigation menu
 * This function can be called by the "Fix this" button for navigation requirements
 */
function fixNavigationRequirements(): Promise<void> {
  return openAndDockNavigation(undefined, {
    checkContext: false,   // Always run regardless of element
    logWarnings: true,     // Verbose logging
    ensureDocked: true     // Always dock if open
  });    
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
const ensureNavigationOpen = (element: HTMLElement): Promise<void> => {
  return openAndDockNavigation(element, {
    checkContext: true,    // Only run if element is in navigation
    logWarnings: false,    // Silent operation
    ensureDocked: true     // Always dock if open
  });
}

/**
 * Interactive steps that use the nav require that it be open.  This function will ensure
 * that it's open so that other steps can be executed.
 * @param element - The element that may require navigation to be open
 * @param options - The options for the navigation
 * @param options.checkContext - Whether to check if the element is within navigation (default false)
 * @param options.logWarnings - Whether to log warnings (default true)
 * @param options.ensureDocked - Whether to ensure the navigation is docked when we're done. (default true)
 * @returns 
 */
const openAndDockNavigation = async (
  element?: HTMLElement,
  options: {
    checkContext?: boolean;
    logWarnings?: boolean;
    ensureDocked?: boolean;
  } = {}
): Promise<void> => {
  const {
    checkContext = false,
    logWarnings = true,
    ensureDocked = true
  } = options;

  // Check if element is within navigation (only if checkContext is true)
  if (checkContext && element) {
    const isInNavigation = element.closest('nav, [class*="nav"], [class*="menu"], [class*="sidebar"]') !== null;
    if (!isInNavigation) {
      return;
    }
  }
  
  // Look for the mega menu toggle button
  const megaMenuToggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement;
  if (!megaMenuToggle) {
    if (logWarnings) {
      console.warn('⚠️ Mega menu toggle button not found');
    }
    return;
  }
  
  // Check if navigation appears to be closed
  const ariaExpanded = megaMenuToggle.getAttribute('aria-expanded');
  const isNavClosed = ariaExpanded === 'false' || ariaExpanded === null;
  
  if (isNavClosed) {
    if (logWarnings) {
      console.warn('�� Opening navigation menu for interactive element access');
    }
    megaMenuToggle.click();
    
    await waitForReactUpdates();
    
    const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
    if (dockMenuButton) {
      if (logWarnings) {
        console.warn('�� Docking navigation menu to keep it in place');
      }
      dockMenuButton.click();
      
      await waitForReactUpdates();
      return;
    } else {
      if (logWarnings) {
        console.warn('⚠️ Dock menu button not found, navigation will remain in modal mode');
      }
      return;
    }
  } else if (ensureDocked) {
    // Navigation is already open, just try to dock it if needed
    const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
    if (dockMenuButton) {
      if (logWarnings) {
        console.warn('�� Navigation already open, ensuring it is docked');
      }
      dockMenuButton.click();
      await waitForReactUpdates();
      return;
    } else {
      if (logWarnings) {
        console.warn('✅ Navigation already open and accessible');
      }
      return;
    }
  } 

  return;
};

export function useInteractiveElements(options: UseInteractiveElementsOptions = {}) {
  const { containerRef } = options;
  
  // Initialize state manager
  const stateManager = useMemo(() => new InteractiveStateManager(), []);
  
  // Initialize global interactive styles
  useEffect(() => {
    addGlobalInteractiveStyles();
  }, []);
  
  /**
   * This is a guard function to track progress through the lifecycle events of an interactive action.
   * This allows us to fire lifecycle events as needed or perform other checks we may implement in the
   * future. 
   * @param data - The interactive element data
   * @param state - The currentstate of the interactive action
   * @returns void
   */
  

  const interactiveFocus = useCallback(async (data: InteractiveElementData, click: boolean) => {
    stateManager.setState(data, 'running');
    
    // Search entire document for the target, which is outside of docs plugin frame.
    const targetElements = document.querySelectorAll(data.reftarget);
    
    try {
      if (!click) {
        // Show mode: ensure visibility and highlight, don't click - NO step completion
        for (const element of targetElements) {
          const htmlElement = element as HTMLElement;
          await ensureNavigationOpen(htmlElement);
          await ensureElementVisible(htmlElement);
          await highlight(htmlElement);
        }
        return; // Early return - don't mark as completed in show mode
      }

      // Do mode: ensure visibility then click, don't highlight
      for (const element of targetElements) {
        const htmlElement = element as HTMLElement;
        await ensureNavigationOpen(htmlElement);
        await ensureElementVisible(htmlElement);
        htmlElement.click();
      }
      
      // Mark as completed after successful execution (only in Do mode)
      waitForReactUpdates().then(() => {
        stateManager.setState(data, 'completed');
      });
    } catch (error) {
      stateManager.handleError(error as Error, 'interactiveFocus', data, false);
    }
  }, [stateManager]);

  const interactiveButton = useCallback(async (data: InteractiveElementData, click: boolean) => {
    stateManager.setState(data, 'running');

    try {
      const buttons = findButtonByText(data.reftarget);
      
      if (!click) {
        // Show mode: ensure visibility and highlight, don't click - NO step completion
        for (const button of buttons) {
          await ensureNavigationOpen(button);
          await ensureElementVisible(button);
          await highlight(button);
        }
        return; // Early return - don't mark as completed in show mode
      }

      // Do mode: ensure visibility then click, don't highlight
      for (const button of buttons) {
        await ensureNavigationOpen(button);
        await ensureElementVisible(button);
        button.click();
      }
      
      // Mark as completed after successful execution (only in Do mode)
      waitForReactUpdates().then(() => {
        stateManager.setState(data, 'completed');
      });
    } catch (error) {
      stateManager.handleError(error as Error, 'interactiveButton', data, false);
    }
  }, [stateManager]);

  // Create stable refs for helper functions to avoid circular dependencies
  const activeRefsRef = useRef(new Set<string>());

  const interactiveFormFill = useCallback(async (data: InteractiveElementData, fillForm: boolean) => { // eslint-disable-line react-hooks/exhaustive-deps
    const value = data.targetvalue || '';
    
    stateManager.setState(data, 'running');
    
    try {
      // Search entire document for the target, which is outside of docs plugin frame.
      console.warn(`🔍 FormFill: Searching for selector: ${data.reftarget}`);
      const targetElements = document.querySelectorAll(data.reftarget);
      
      console.warn(`🔍 FormFill: Found ${targetElements.length} elements matching selector`);
      if (targetElements.length === 0) {
        stateManager.handleError(
          `❌ No elements found matching selector: ${data.reftarget}`, 
          'interactiveFormFill', data, false);
        return;
      } else if(targetElements.length > 1) {
        console.warn(`⚠️ Multiple elements found matching selector: ${data.reftarget}`);
      }

      const targetElement = targetElements[0] as HTMLElement;
      console.warn(`🎯 FormFill: Target element found:`, targetElement);
      
      // Always ensure navigation is open and element is visible first
      await ensureNavigationOpen(targetElement);
      await ensureElementVisible(targetElement);
      
      if (!fillForm) {
        // Show mode: only highlight, don't fill the form
        await highlight(targetElement);
        return;
      }

      // Do mode: don't highlight, just fill the form
      const tagName = targetElement.tagName.toLowerCase();
      const inputType = (targetElement as HTMLInputElement).type ? (targetElement as HTMLInputElement).type.toLowerCase() : '';
      
      // Check if this is a Monaco editor textarea (special handling required)
      const isMonacoEditor = targetElement.classList.contains('inputarea') && 
                            targetElement.classList.contains('monaco-mouse-cursor-text');
        
      // CONSOLIDATED APPROACH: Set value once using the most compatible method
      if (tagName === 'input') {
        if (inputType === 'checkbox' || inputType === 'radio') {
          // Handle checkbox/radio inputs - no duplicate events issue here
          (targetElement as HTMLInputElement).checked = value !== 'false' && value !== '0' && value !== '';
        } else {
          // Use React-compatible native setter approach for text inputs
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(targetElement, value);
            
            resetValueTracker(targetElement);
          } else {
            // Fallback for edge cases where native setter isn't available
            (targetElement as HTMLInputElement).value = value;
          }
        }
      } else if (tagName === 'textarea') {
        if (isMonacoEditor) {
          // Special handling for Monaco editors
          console.warn('🎯 Detected Monaco editor, using enhanced approach for value setting');
          
          // Focus the editor first to make it active
          targetElement.focus();
          
          // Clear any existing content using Ctrl+A and Delete
          targetElement.dispatchEvent(new KeyboardEvent('keydown', { 
            key: 'a', 
            code: 'KeyA', 
            ctrlKey: true, 
            bubbles: true 
          }));
          
          targetElement.dispatchEvent(new KeyboardEvent('keydown', { 
            key: 'Delete', 
            code: 'Delete', 
            bubbles: true 
          }));
          
          // Wait a moment for the clear to process
          await new Promise(resolve => setTimeout(resolve, INTERACTIVE_CONFIG.delays.technical.monacoClear));
          
          // Now set the value and trigger comprehensive events
          const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeTextareaSetter) {
            nativeTextareaSetter.call(targetElement, value);
          } else {
            (targetElement as HTMLTextAreaElement).value = value;
          }
          
          resetValueTracker(targetElement);
          
          // Dispatch comprehensive input events to trigger Monaco's change detection
          targetElement.dispatchEvent(new Event('input', { bubbles: true }));
          targetElement.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Simulate typing the last character to trigger Monaco's update
          const lastChar = value.slice(-1);
          if (lastChar) {
            targetElement.dispatchEvent(new KeyboardEvent('keydown', { 
              key: lastChar, 
              bubbles: true 
            }));
            targetElement.dispatchEvent(new KeyboardEvent('keyup', { 
              key: lastChar, 
              bubbles: true 
            }));
          }
          
        } else {
          // Standard textarea handling
          const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (nativeTextareaSetter) {
            nativeTextareaSetter.call(targetElement, value);
            resetValueTracker(targetElement);            
          } else {
            // Fallback for edge cases
            (targetElement as HTMLTextAreaElement).value = value;
          }
        }
      } else if (tagName === 'select') {
        // Select elements don't have the same React issues, use direct assignment
        (targetElement as HTMLSelectElement).value = value;
      } else {
        // For other elements, set text content
        targetElement.textContent = value;
      }
      
      // Dispatch events ONCE in proper sequence to notify all listeners
      // This mimics natural user interaction: focus -> input -> change -> blur
      targetElement.focus();
      targetElement.dispatchEvent(new Event('focus', { bubbles: true }));
      
      // Only dispatch input/change events for form controls that support them (skip for Monaco as already handled)
      if ((tagName === 'input' || tagName === 'textarea' || tagName === 'select') && !isMonacoEditor) {
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      targetElement.blur();
      targetElement.dispatchEvent(new Event('blur', { bubbles: true }));
      
      // Mark as completed after successful execution
      waitForReactUpdates().then(() => {
        stateManager.setState(data, 'completed');
      });      
    } catch (error) {
      stateManager.handleError(error as Error, 'interactiveFormFill', data, false);
    }
    return data;
  }, [stateManager]);

  const interactiveNavigate = useCallback(async (data: InteractiveElementData, navigate: boolean) => {
    stateManager.setState(data, 'running');
    
    try {
      if (!navigate) {
        // Show mode: highlight the current location or show where we would navigate
        // For navigation, we can highlight the current URL or show a visual indicator
        // Since there's no specific element to highlight, we'll just show a brief visual feedback
        console.log(`🔍 Show mode: Would navigate to ${data.reftarget}`);
        
        // Provide visual feedback by briefly highlighting the browser location bar concept
        // or show a toast/notification (for now, just log and complete)
        waitForReactUpdates().then(() => {
          stateManager.setState(data, 'completed');
        });
        return;
      }

      // Do mode: actually navigate to the target URL
      console.log(`🧭 Navigating to: ${data.reftarget}`);
      
      // Use Grafana's idiomatic navigation pattern via locationService
      // This handles both internal Grafana routes and external URLs appropriately
      if (data.reftarget.startsWith('http://') || data.reftarget.startsWith('https://')) {
        // External URL - open in new tab to preserve current Grafana session
        window.open(data.reftarget, '_blank', 'noopener,noreferrer');
      } else {
        // Internal Grafana route - use locationService for proper routing
        locationService.push(data.reftarget);
      }
      
      // Mark as completed after successful navigation
      waitForReactUpdates().then(() => {
        stateManager.setState(data, 'completed');
      });
    } catch (error) {
      stateManager.handleError(error as Error, 'interactiveNavigate', data);
    }
  }, [stateManager]);

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
    fixNavigationRequirements, // Add the new function to the return object
  };
} 
