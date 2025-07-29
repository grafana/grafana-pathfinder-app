/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useCallback, useRef } from 'react';
import { locationService } from '@grafana/runtime';
import { addGlobalInteractiveStyles } from '../styles/interactive.styles';
import { waitForReactUpdates } from './requirements-checker.hook';
import { 
  checkRequirements, 
  RequirementsCheckOptions, 
  CheckResultError,
  DOMCheckFunctions 
} from './requirements-checker.utils';

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

export interface InteractiveElementData {
  // Core interactive attributes
  reftarget: string;
  targetaction: string;
  targetvalue?: string;
  requirements?: string;
  objectives?: string;
  
  // Element context
  tagName: string;
  className?: string;
  id?: string;
  textContent?: string;
  
  // Position/hierarchy context
  elementPath?: string; // CSS selector path to element
  parentTagName?: string;
  
  // Timing context
  timestamp?: number;
  
  // Custom data attributes (extensible)
  customData?: Record<string, string>;
}



/**
 * Extract interactive data from a DOM element
 */
export function extractInteractiveDataFromElement(element: HTMLElement): InteractiveElementData {
  const customData: Record<string, string> = {};
  
  // Extract all data-* attributes except the core ones
  Array.from(element.attributes).forEach(attr => {
    if (attr.name.startsWith('data-') && 
        !['data-reftarget', 'data-targetaction', 'data-targetvalue', 'data-requirements', 'data-objectives'].includes(attr.name)) {
      const key = attr.name.substring(5); // Remove 'data-' prefix
      customData[key] = attr.value;
    }
  });

  // Extract core attributes with validation
  const reftarget = element.getAttribute('data-reftarget') || '';
  const targetaction = element.getAttribute('data-targetaction') || '';
  const targetvalue = element.getAttribute('data-targetvalue') || undefined;
  const requirements = element.getAttribute('data-requirements') || undefined;
  const objectives = element.getAttribute('data-objectives') || undefined;
  const textContent = element.textContent?.trim() || undefined;

  // Basic validation: Check if reftarget looks suspicious (only warn on obvious issues)
  if (reftarget && textContent && reftarget === textContent && reftarget.length > 5) {
    console.warn(`⚠️ reftarget "${reftarget}" matches element text - check data-reftarget attribute`);
  }

  return {
    reftarget: reftarget,
    targetaction: targetaction,
    targetvalue: targetvalue,
    requirements: requirements,
    objectives: objectives,
    tagName: element.tagName.toLowerCase(),
    className: element.className || undefined,
    id: element.id || undefined,
    textContent: textContent,

    parentTagName: element.parentElement?.tagName.toLowerCase() || undefined,
    timestamp: Date.now(),
    customData: Object.keys(customData).length > 0 ? customData : undefined,
  };
}





/**
 * Recursively get all text content from an element and its descendants
 */
function getAllTextContent(element: Element): string {
  let text = '';
  
  // Process all child nodes
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // Add text node content
      text += (node.textContent || '').trim() + ' ';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Recursively get text from child elements
      text += getAllTextContent(node as Element) + ' ';
    }
  }
  
  return text.trim();
}

interface UseInteractiveElementsOptions {
  containerRef?: React.RefObject<HTMLElement>;
}

export function useInteractiveElements(options: UseInteractiveElementsOptions = {}) {
  const { containerRef } = options;
  
  // Initialize global interactive styles
  useEffect(() => {
    addGlobalInteractiveStyles();
  }, []);

  /**
   * Find button elements that contain the specified text (case-insensitive)
   * Prioritizes exact matches over partial matches
   */
  function findButtonByText(targetText: string): HTMLButtonElement[] {
    if (!targetText || typeof targetText !== 'string') {
      return [];
    }

    // In this special case we want to look through the entire document, since for finding
    // buttons we want to click, we have to look outside the docs plugin frame.
    const buttons = document.querySelectorAll('button');
    const searchText = targetText.toLowerCase().trim();
    
    const exactMatches: HTMLButtonElement[] = [];
    const partialMatches: HTMLButtonElement[] = [];
    
    Array.from(buttons).forEach((button) => {
      // Get all text content from the button and its descendants
      const allText = getAllTextContent(button).toLowerCase().trim();
      
      if (!allText) {return;}
      
      if (allText === searchText) {
        // Exact match
        exactMatches.push(button as HTMLButtonElement);
      } else if (allText.includes(searchText)) {
        // Partial match
        partialMatches.push(button as HTMLButtonElement);
      }
    });
    
    // Return exact matches if any exist, otherwise return partial matches
    if (exactMatches.length > 0) {
      console.warn(`🎯 Found ${exactMatches.length} exact matches for "${targetText}"`);
      return exactMatches;
    } else if (partialMatches.length > 0) {
      console.warn(`🔍 Found ${partialMatches.length} partial matches for "${targetText}"`);
      return partialMatches;
    }
    
    return [];
  }

  /**
   * Ensure navigation is open if the target element is in the navigation area
   */
  function ensureNavigationOpen(element: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
      // Check if element is within navigation (common nav selectors)
      const isInNavigation = element.closest('nav, [class*="nav"], [class*="menu"], [class*="sidebar"]') !== null;
      
      if (!isInNavigation) {
        resolve();
        return;
      }
      
      // Look for the mega menu toggle button
      const megaMenuToggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement;
      if (!megaMenuToggle) {
        resolve();
        return;
      }
      
      // Check if navigation appears to be closed (button has certain attributes/classes that indicate closed state)
      const ariaExpanded = megaMenuToggle.getAttribute('aria-expanded');
      const isNavClosed = ariaExpanded === 'false' || ariaExpanded === null;
      
      if (isNavClosed) {
        console.warn('🚪 Opening navigation menu for interactive element access');
        megaMenuToggle.click();
        
        // Give the navigation time to open, then dock it
        setTimeout(() => {
          // Look for the dock menu button and click it to keep the menu docked
          const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
          if (dockMenuButton) {
            console.warn('📌 Docking navigation menu to keep it in place');
            dockMenuButton.click();
            
            // Give the dock animation time to complete
            setTimeout(() => {
              resolve();
            }, 200);
          } else {
            console.warn('⚠️ Dock menu button not found, navigation will remain in modal mode');
            resolve();
          }
        }, 300);
      } else {
        resolve();
      }
    });
  }
  
  /**
   * Ensure element is visible in the viewport by scrolling it into view
   */
  function ensureElementVisible(element: HTMLElement): Promise<void> {
    return new Promise((resolve) => {
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
        
        // Give scroll animation time to complete
        setTimeout(() => {
          resolve();
        }, 500);
      } else {
        resolve();
      }
    });
  }

  async function highlight(element: HTMLElement) {
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
    
    // Remove highlight after animation completes
    setTimeout(() => {
      element.classList.remove('interactive-highlighted');
      if (highlightOutline.parentNode) {
        highlightOutline.parentNode.removeChild(highlightOutline);
      }
    }, 2000); // Match animation duration
    
    return element;
  }

  /**
   * Bridge elements don't need complex state management since React components
   * handle their own state. This simplified version just logs completion.
   */
  function setInteractiveState(element: HTMLElement, state: 'idle' | 'running' | 'completed' | 'error') {
    if (state === 'completed') {
      console.log('✅ Interactive action completed:', {
        element: element.tagName,
        reftarget: element.getAttribute('data-reftarget'),
        targetaction: element.getAttribute('data-targetaction'),
        buttonType: element.getAttribute('data-button-type'),
      });
      
      // Dispatch event for any listeners
      waitForReactUpdates().then(() => {
        const event = new CustomEvent('interactive-action-completed', {
          detail: { element, state }
        });
        document.dispatchEvent(event);
      });
    }
  }

  const interactiveFocus = useCallback(async (data: InteractiveElementData, click: boolean, clickedElement?: HTMLElement) => {
    if (clickedElement) {
      setInteractiveState(clickedElement, 'running');
    }
    
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
      if (clickedElement) {
        waitForReactUpdates().then(() => {
          setInteractiveState(clickedElement, 'completed');
        });
      }
    } catch (error) {
      console.error("Error in interactiveFocus:", error);
      if (clickedElement) {
        setInteractiveState(clickedElement, 'error');
      }
    }
  }, []);

  const interactiveButton = useCallback(async (data: InteractiveElementData, click: boolean, clickedElement?: HTMLElement) => { // eslint-disable-line react-hooks/exhaustive-deps
    if (clickedElement) {
      setInteractiveState(clickedElement, 'running');
    }

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
      if (clickedElement) {
        waitForReactUpdates().then(() => {
          setInteractiveState(clickedElement, 'completed');
        });
      }
    } catch (error) {
      console.error("Error in interactiveButton:", error);
      if (clickedElement) {
        setInteractiveState(clickedElement, 'error');
      }
    }
  }, []);

  // Create stable refs for helper functions to avoid circular dependencies
  const activeRefsRef = useRef(new Set<string>());
  const runInteractiveSequenceRef = useRef<(elements: Element[], showMode: boolean) => Promise<void>>();
  const runStepByStepSequenceRef = useRef<(elements: Element[]) => Promise<void>>();

  const interactiveSequence = useCallback(async (data: InteractiveElementData, showOnly: boolean, clickedElement?: HTMLElement): Promise<string> => { // eslint-disable-line react-hooks/exhaustive-deps
    // This is here so recursion cannot happen
    if(activeRefsRef.current.has(data.reftarget)) {
      return data.reftarget;
    }
    
    if (clickedElement) {
      setInteractiveState(clickedElement, 'running');
    }
    
    try {
      const searchContainer = containerRef?.current || document;
      const targetElements = searchContainer.querySelectorAll(data.reftarget);

      if(targetElements.length === 0) {
        const msg = `No interactive sequence container found matching selector: ${data.reftarget}`;
        console.error(msg);
        throw new Error(msg);
      }
      
      if(targetElements.length > 1) {
        const msg = `${targetElements.length} interactive sequence containers found matching selector: ${data.reftarget} - this is not supported (must be exactly 1)`;
        console.error(msg);
        throw new Error(msg);
      } 

      activeRefsRef.current.add(data.reftarget);

      // Find all interactive elements within the sequence container
      const interactiveElements = Array.from(targetElements[0].querySelectorAll('.interactive[data-targetaction]:not([data-targetaction="sequence"])'));
      
      if (interactiveElements.length === 0) {
        const msg = `No interactive elements found within sequence container: ${data.reftarget}`;
        throw new Error(msg);
      }
      
      if (!showOnly) {
        // Full sequence: Show each step, then do each step, one by one
        await runStepByStepSequenceRef.current!(interactiveElements);
      } else {
        // Show only mode
        await runInteractiveSequenceRef.current!(interactiveElements, true);
      }
      
      // Mark as completed after successful execution
      if (clickedElement) {
        setInteractiveState(clickedElement, 'completed');
      }
      
      activeRefsRef.current.delete(data.reftarget);
      return data.reftarget;
    } catch (error) {
      console.error(`Error in interactiveSequence for ${data.reftarget}:`, error);
      if (clickedElement) {
        setInteractiveState(clickedElement, 'error');
      }
      activeRefsRef.current.delete(data.reftarget);
      throw error;
    }
  }, []);

  const interactiveFormFill = useCallback(async (data: InteractiveElementData, fillForm: boolean, clickedElement?: HTMLElement) => { // eslint-disable-line react-hooks/exhaustive-deps
    const value = data.targetvalue || '';
    
    if (clickedElement) {
      setInteractiveState(clickedElement, 'running');
    }
    
    try {
      // Search entire document for the target, which is outside of docs plugin frame.
      const targetElements = document.querySelectorAll(data.reftarget);
      
      if (targetElements.length === 0) {
        console.warn(`No elements found matching selector: ${data.reftarget}`);
        return;
      } else if(targetElements.length > 1) {
        console.warn(`Multiple elements found matching selector: ${data.reftarget}`);
      }

      const targetElement = targetElements[0] as HTMLElement;
      
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
            
            // Reset React's value tracker if present (must be done after setting value)
            if ((targetElement as any)._valueTracker) {
              (targetElement as any)._valueTracker.setValue('');
            }
          } else {
            // Fallback for edge cases where native setter isn't available
            (targetElement as HTMLInputElement).value = value;
          }
        }
      } else if (tagName === 'textarea') {
        // Use React-compatible native setter approach for textareas
        const nativeTextareaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
        if (nativeTextareaSetter) {
          nativeTextareaSetter.call(targetElement, value);
          
          // Reset React's value tracker if present
          if ((targetElement as any)._valueTracker) {
            (targetElement as any)._valueTracker.setValue('');
          }
        } else {
          // Fallback for edge cases
          (targetElement as HTMLTextAreaElement).value = value;
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
      
      // Only dispatch input/change events for form controls that support them
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        targetElement.dispatchEvent(new Event('input', { bubbles: true }));
        targetElement.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      targetElement.blur();
      targetElement.dispatchEvent(new Event('blur', { bubbles: true }));
      
      // Mark as completed after successful execution
      if (clickedElement) {
        waitForReactUpdates().then(() => {
          setInteractiveState(clickedElement, 'completed');
        });
      }
      
    } catch (error) {
      console.error('Error applying interactive action for selector ' + data.reftarget);
      if (clickedElement) {
        setInteractiveState(clickedElement, 'error');
      }
    }
  }, []);

  const interactiveNavigate = useCallback((data: InteractiveElementData, navigate: boolean, clickedElement?: HTMLElement) => {
    if (clickedElement) {
      setInteractiveState(clickedElement, 'running');
    }
    
    try {
      if (!navigate) {
        // Show mode: highlight the current location or show where we would navigate
        // For navigation, we can highlight the current URL or show a visual indicator
        // Since there's no specific element to highlight, we'll just show a brief visual feedback
        console.log(`🔍 Show mode: Would navigate to ${data.reftarget}`);
        
        // Provide visual feedback by briefly highlighting the browser location bar concept
        // or show a toast/notification (for now, just log and complete)
        if (clickedElement) {
          waitForReactUpdates().then(() => {
            setInteractiveState(clickedElement, 'completed');
          });
        }
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
      if (clickedElement) {
        waitForReactUpdates().then(() => {
          setInteractiveState(clickedElement, 'completed');
        });
      }
      
    } catch (error) {
      console.error('Error in interactiveNavigate:', error);
      if (clickedElement) {
        setInteractiveState(clickedElement, 'error');
      }
    }
  }, []);

  /**
   * Fix navigation requirements by opening and docking the navigation menu
   * This function can be called by the "Fix this" button for navigation requirements
   */
  function fixNavigationRequirements(): Promise<void> {
    return new Promise((resolve) => {
      // Look for the mega menu toggle button
      const megaMenuToggle = document.querySelector('#mega-menu-toggle') as HTMLButtonElement;
      if (!megaMenuToggle) {
        console.warn('⚠️ Mega menu toggle button not found');
        resolve();
        return;
      }
      
      // Check if navigation is already open
      const ariaExpanded = megaMenuToggle.getAttribute('aria-expanded');
      const isNavClosed = ariaExpanded === 'false' || ariaExpanded === null;
      
      if (isNavClosed) {
        console.warn('🔧 Fixing navigation: Opening and docking menu');
        megaMenuToggle.click();
        
        // Give the navigation time to open, then dock it
        setTimeout(() => {
          const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
          if (dockMenuButton) {
            console.warn('📌 Docking navigation menu to keep it in place');
            dockMenuButton.click();
            
            // Give the dock animation time to complete
            setTimeout(() => {
              resolve();
            }, 200);
          } else {
            console.warn('⚠️ Dock menu button not found, navigation opened but not docked');
            resolve();
          }
        }, 300);
      } else {
        // Navigation is already open, just try to dock it if needed
        const dockMenuButton = document.querySelector('#dock-menu-button') as HTMLButtonElement;
        if (dockMenuButton) {
          console.warn('📌 Navigation already open, ensuring it is docked');
          dockMenuButton.click();
          setTimeout(() => {
            resolve();
          }, 200);
        } else {
          console.warn('✅ Navigation already open and accessible');
          resolve();
        }
      }
    });
  }

  // Define helper functions using refs to avoid circular dependencies
  runInteractiveSequenceRef.current = async (elements: Element[], showMode: boolean): Promise<void> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds between retries
    
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = extractInteractiveDataFromElement(element as HTMLElement);

      if (!data.targetaction || !data.reftarget) {
        continue;
      }

      // Retry logic for each element
      let retryCount = 0;
      let elementCompleted = false;
      
      while (!elementCompleted && retryCount < MAX_RETRIES) {
        try {
          // Check requirements using the existing system
          const requirementsCheck = await checkRequirementsFromData(data);
          
          if (!requirementsCheck.pass) {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              // Wait and retry
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              continue;
            } else {
              // Max retries reached, skip this element
              break;
            }
          }

          if (data.targetaction === 'highlight') {
            await interactiveFocus(data, !showMode, element as HTMLElement); // Show mode = don't click, Do mode = click
          } else if (data.targetaction === 'button') {
            await interactiveButton(data, !showMode, element as HTMLElement); // Show mode = don't click, Do mode = click
          } else if (data.targetaction === 'formfill') {
            await interactiveFormFill(data, !showMode, element as HTMLElement); // Show mode = don't fill, Do mode = fill
          } else if (data.targetaction === 'navigate') {
            interactiveNavigate(data, !showMode, element as HTMLElement); // Show mode = show target, Do mode = navigate
          }

          // Mark element as completed
          elementCompleted = true;

          // Wait for animation to complete between each action
          await new Promise(resolve => setTimeout(resolve, 1300));
          
        } catch (error) {
          console.error(`Error processing interactive element ${data.targetaction} ${data.reftarget}:`, error);
          retryCount++;
          
          if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          } else {
            // Max retries reached, skip this element
            break;
          }
        }
      }
    }
  };

  runStepByStepSequenceRef.current = async (elements: Element[]): Promise<void> => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds between retries
    
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = extractInteractiveDataFromElement(element as HTMLElement);

      if (!data.targetaction || !data.reftarget) {
        continue;
      }

      // Retry logic for each step
      let retryCount = 0;
      let stepCompleted = false;
      
      while (!stepCompleted && retryCount < MAX_RETRIES) {
        try {
          // Check requirements using the existing system
          const requirementsCheck = await checkRequirementsFromData(data);
          
          if (!requirementsCheck.pass) {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              // Wait and retry
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              continue;
            } else {
              // Max retries reached, skip this step
              break;
            }
          }

          // Step 1: Show what we're about to do
          if (data.targetaction === 'highlight') {
            await interactiveFocus(data, false, element as HTMLElement); // Show mode - highlight only
          } else if (data.targetaction === 'button') {
            await interactiveButton(data, false, element as HTMLElement); // Show mode - highlight only
          } else if (data.targetaction === 'formfill') {
            await interactiveFormFill(data, false, element as HTMLElement); // Show mode - highlight only
          } else if (data.targetaction === 'navigate') {
            interactiveNavigate(data, false, element as HTMLElement); // Show mode - show target only
          }

          // Wait for highlight animation to complete before doing the action
          await new Promise(resolve => setTimeout(resolve, 1300));

          // Check requirements again before performing the action
          const secondCheck = await checkRequirementsFromData(data);
          if (!secondCheck.pass) {
            retryCount++;
            if (retryCount < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              continue;
            } else {
              break;
            }
          }

          // Step 2: Actually do the action
          if (data.targetaction === 'highlight') {
            await interactiveFocus(data, true, element as HTMLElement); // Do mode - click
          } else if (data.targetaction === 'button') {
            await interactiveButton(data, true, element as HTMLElement); // Do mode - click
          } else if (data.targetaction === 'formfill') {
            await interactiveFormFill(data, true, element as HTMLElement); // Do mode - fill form
          } else if (data.targetaction === 'navigate') {
            interactiveNavigate(data, true, element as HTMLElement); // Do mode - navigate
          }

          // Mark step as completed
          stepCompleted = true;

          // Wait after actions that might cause state changes
          const baseDelay = 800;
          const actionDelay = data.targetaction === 'button' ? 1500 : baseDelay;
          
          if (i < elements.length - 1) {
            await new Promise(resolve => setTimeout(resolve, actionDelay));
          }
          
        } catch (error) {
          console.error(`Error in interactive step for ${data.targetaction} ${data.reftarget}:`, error);
          retryCount++;
          
          if (retryCount < MAX_RETRIES) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
          } else {
            // Max retries reached, skip this step
            break;
          }
        }
      }
    }
  };



  /**
   * Create DOM check functions for requirements that need DOM access
   */
  const domCheckFunctions: DOMCheckFunctions = {
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
  };

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
  }, []);

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
          await interactiveFocus(elementData, !isShowMode, undefined);
          break;

        case 'button':
          await interactiveButton(elementData, !isShowMode, undefined);
          break;

        case 'formfill':
          await interactiveFormFill(elementData, !isShowMode, undefined);
          break;

        case 'navigate':
          interactiveNavigate(elementData, !isShowMode, undefined);
          break;

        case 'sequence':
          await interactiveSequence(elementData, isShowMode, undefined);
          break;

        default:
          console.warn(`Unknown interactive action: ${targetAction}`);
      }
    } catch (error) {
      console.error(`Error executing interactive action ${targetAction}:`, error);
      throw error;
    }
  }, [interactiveFocus, interactiveButton, interactiveFormFill, interactiveNavigate, interactiveSequence]);

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
