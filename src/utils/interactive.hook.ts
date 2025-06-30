import { useEffect, useCallback, useRef } from 'react';
import { fetchDataSources } from './context-data-fetcher';

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
        !['data-reftarget', 'data-targetaction', 'data-targetvalue', 'data-requirements'].includes(attr.name)) {
      const key = attr.name.substring(5); // Remove 'data-' prefix
      customData[key] = attr.value;
    }
  });

  // Extract core attributes with validation
  const reftarget = element.getAttribute('data-reftarget') || '';
  const targetaction = element.getAttribute('data-targetaction') || '';
  const targetvalue = element.getAttribute('data-targetvalue') || undefined;
  const requirements = element.getAttribute('data-requirements') || undefined;
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
 * Find button elements that contain the specified text (case-insensitive, substring match)
 * Searches through all child text nodes, not just direct textContent
 */
function findButtonByText(targetText: string): HTMLButtonElement[] {
  if (!targetText || typeof targetText !== 'string') {
    return [];
  }

  const buttons = document.querySelectorAll('button');
  const searchText = targetText.toLowerCase().trim();
  
  return Array.from(buttons).filter((button) => {
    // Get all text content from the button and its descendants
    const allText = getAllTextContent(button).toLowerCase();
    return allText.includes(searchText);
  }) as HTMLButtonElement[];
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

export function useInteractiveElements() {
  function highlight(element: HTMLElement) {
    // Add highlight class for better styling
    element.classList.add('interactive-highlighted');
    
    // Create a highlight outline element
    const highlightOutline = document.createElement('div');
    highlightOutline.className = 'interactive-highlight-outline';
    
    // Position the outline around the target element
    const rect = element.getBoundingClientRect();
    const scrollTop = window.scrollY || document.documentElement.scrollTop;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
    
    highlightOutline.style.position = 'absolute';
    highlightOutline.style.top = `${rect.top + scrollTop - 4}px`;
    highlightOutline.style.left = `${rect.left + scrollLeft - 4}px`;
    highlightOutline.style.width = `${rect.width + 8}px`;
    highlightOutline.style.height = `${rect.height + 8}px`;
    highlightOutline.style.border = '2px solid #FF8800'; // Grafana orange
    highlightOutline.style.borderRadius = '4px';
    highlightOutline.style.pointerEvents = 'none';
    highlightOutline.style.zIndex = '9999';
    highlightOutline.style.backgroundColor = 'rgba(255, 136, 0, 0.1)';
    highlightOutline.style.boxShadow = '0 0 0 4px rgba(255, 136, 0, 0.2)';
    highlightOutline.style.animation = 'highlight-pulse 1.2s ease-in-out';
    
    document.body.appendChild(highlightOutline);
    
    // Remove highlight after animation completes
    setTimeout(() => {
      element.classList.remove('interactive-highlighted');
      if (highlightOutline.parentNode) {
        highlightOutline.parentNode.removeChild(highlightOutline);
      }
    }, 1200);
    
    return element;
  }

  function setInteractiveState(element: HTMLElement, state: 'idle' | 'running' | 'completed' | 'error') {
    // Remove all state classes
    element.classList.remove('interactive-running', 'interactive-completed', 'interactive-error');
    
    // Add the new state class
    if (state !== 'idle') {
      element.classList.add(`interactive-${state}`);
    }
    
    // Dispatch custom event when action completes
    if (state === 'completed') {
      console.log('🎯 Interactive action completed, triggering DIRECT requirement re-check');
      
             // Direct approach: Find and re-check ALL elements with requirements immediately
       setTimeout(() => {
         console.log('🔄 Re-checking all interactive elements...');
         const allElementsWithRequirements = document.querySelectorAll('[data-requirements]');
         
         if (allElementsWithRequirements.length > 0) {
           Promise.all(Array.from(allElementsWithRequirements).map(async (element, index) => {
             const htmlElement = element as HTMLElement;
             
             try {
               const result = await checkElementRequirements(htmlElement);
                             
               // Update element state directly
               htmlElement.classList.remove('requirements-satisfied', 'requirements-failed', 'requirements-checking');
               
               if (result.pass) {
                 htmlElement.classList.add('requirements-satisfied');
                 if (htmlElement.tagName.toLowerCase() === 'button') {
                   (htmlElement as HTMLButtonElement).disabled = false;
                   htmlElement.setAttribute('aria-disabled', 'false');
                   const originalText = htmlElement.getAttribute('data-original-text');
                   if (originalText) {
                     htmlElement.textContent = originalText;
                   }
                 }
               } else {
                 htmlElement.classList.add('requirements-failed');
                 if (htmlElement.tagName.toLowerCase() === 'button') {
                   (htmlElement as HTMLButtonElement).disabled = true;
                   htmlElement.setAttribute('aria-disabled', 'true');
                   const requirements = htmlElement.getAttribute('data-requirements') || '';
                   htmlElement.title = `Requirements not met: ${requirements}`;
                 }
               }
             } catch (error) {
               console.error(`Error checking element ${index + 1}:`, error);
               // Set failed state
               htmlElement.classList.remove('requirements-satisfied', 'requirements-failed', 'requirements-checking');
               htmlElement.classList.add('requirements-failed');
               if (htmlElement.tagName.toLowerCase() === 'button') {
                 (htmlElement as HTMLButtonElement).disabled = true;
                 htmlElement.setAttribute('aria-disabled', 'true');
               }
             }
           })).catch(error => {
             console.error('Error during requirement re-check:', error);
           });
        }
      }, 150); // Small delay to let DOM settle
    }
  }

  function findInteractiveElement(reftarget: string): HTMLElement | null {
    // Try to find the interactive element that triggered this action
    const interactiveElements = document.querySelectorAll('.interactive[data-targetaction]');
    
    for (const element of interactiveElements) {
      const elementReftarget = element.getAttribute('data-reftarget');
      if (elementReftarget === reftarget) {
        return element as HTMLElement;
      }
    }
    
    return null;
  }
  
  const interactiveFocus = useCallback((data: InteractiveElementData, click = true) => {
    console.log("Interactive focus called for:", data.reftarget, "click:", click);
    const interactiveElement = findInteractiveElement(data.reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    const targetElements = document.querySelectorAll(data.reftarget);
    
    try {
      targetElements.forEach(element => {
        if (!click) {
          // Show mode: only highlight, don't click
          highlight((element as HTMLElement));
        } else {
          // Do mode: just click, don't highlight
          (element as HTMLElement).click();
        }
      });
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setTimeout(() => {
          setInteractiveState(interactiveElement, 'completed');
        }, 500);
      }
    } catch (error) {
      console.error("Error in interactiveFocus:", error);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
    }
  }, []);

  const interactiveButton = useCallback((data: InteractiveElementData, click = true) => {
    console.log("Interactive button called for:", data.reftarget, "click:", click);
    const interactiveElement = findInteractiveElement(data.reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }

    try {
      const buttons = findButtonByText(data.reftarget);
      console.log(`Found ${buttons.length} buttons containing text "${data.reftarget}"`);
      
      buttons.forEach(button => {
        if (!click) {
          // Show mode: only highlight, don't click
          highlight(button);
        } else {
          // Do mode: just click, don't highlight
          button.click();
        }
      });
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setTimeout(() => {
          setInteractiveState(interactiveElement, 'completed');
        }, 500);
      }
    } catch (error) {
      console.error("Error in interactiveButton:", error);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
    }
  }, []);

  // Create stable refs for helper functions to avoid circular dependencies
  const activeRefsRef = useRef(new Set<string>());
  const runInteractiveSequenceRef = useRef<(elements: Element[], showMode: boolean) => Promise<void>>();
  const runStepByStepSequenceRef = useRef<(elements: Element[]) => Promise<void>>();

  async function runSequence(sequence: HTMLButtonElement[]): Promise<HTMLButtonElement[]> {
    for(const button of sequence) {
      console.log("Clicking button: ", button);
      button.click();

      // This is not the right way to do this but will have to wait for now.
      console.log("Sleep");
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log("requestAnimationFrame");
      await new Promise(requestAnimationFrame);
    }

    return sequence;
  }

  const interactiveSequence = useCallback(async (data: InteractiveElementData, showOnly = false): Promise<string> => {
    // This is here so recursion cannot happen
    if(activeRefsRef.current.has(data.reftarget)) {
      console.log("Interactive sequence already active for:", data.reftarget);
      return data.reftarget;
    }

    console.log("Interactive sequence called for:", data.reftarget, "showOnly:", showOnly);
    const interactiveElement = findInteractiveElement(data.reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    try {
      const targetElements = document.querySelectorAll(data.reftarget);

      if(targetElements.length === 0 || targetElements.length > 1) {
        const msg = (targetElements.length + 
          " interactive sequence elements found matching selector: " + data.reftarget + 
          " - this is not supported");
        throw new Error(msg);
      } 

      activeRefsRef.current.add(data.reftarget);

      // Find all interactive elements within the sequence container
      const interactiveElements = Array.from(targetElements[0].querySelectorAll('.interactive[data-targetaction]:not([data-targetaction="sequence"])'));
      
      if (!showOnly) {
        // Full sequence: Show each step, then do each step, one by one
        await runStepByStepSequenceRef.current!(interactiveElements);
      } else {
        // Show only mode
        await runInteractiveSequenceRef.current!(interactiveElements, true);
      }
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'completed');
      }
      
      activeRefsRef.current.delete(data.reftarget);
      return data.reftarget;
    } catch (error) {
      console.error("Error in interactiveSequence:", error);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
      activeRefsRef.current.delete(data.reftarget);
      throw error;
    }
  }, []);

  const interactiveFormFill = useCallback((data: InteractiveElementData, fillForm = true) => {
    const value = data.targetvalue || '';
    console.log(`Interactive form fill called, targeting: ${data.reftarget} with ${value}, fillForm: ${fillForm}`);
    const interactiveElement = findInteractiveElement(data.reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    try {
      const targetElements = document.querySelectorAll(data.reftarget);
      
      if (targetElements.length === 0) {
        console.warn(`No elements found matching selector: ${data.reftarget}`);
        return;
      }
      
      targetElements.forEach(function(te, index) {
         const targetElement = te as HTMLElement;

         if (!fillForm) {
           // Show mode: only highlight, don't fill the form
           highlight(targetElement);
           return;
         }

         // Do mode: don't highlight, just fill the form
         const tagName = targetElement.tagName.toLowerCase();
         const inputType = (targetElement as HTMLInputElement).type ? (targetElement as HTMLInputElement).type.toLowerCase() : '';
         
         if (tagName === 'input') {
           if (inputType === 'checkbox' || inputType === 'radio') {
             (targetElement as HTMLInputElement).checked = value !== 'false' && value !== '0' && value !== '';
           } else {
             (targetElement as HTMLInputElement).value = value;
           }
         } else if (tagName === 'textarea') {
           (targetElement as HTMLTextAreaElement).value = value;
         } else if (tagName === 'select') {
           (targetElement as HTMLSelectElement).value = value;
         } else {
           targetElement.textContent = value;
         }
        
        // Trigger multiple events to notify all possible listeners
        targetElement.focus();
        const focusEvent = new Event('focus', { bubbles: true });
        targetElement.dispatchEvent(focusEvent);
        
        const inputEvent = new Event('input', { bubbles: true });
        targetElement.dispatchEvent(inputEvent);
        
        const keyDownEvent = new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' });
        targetElement.dispatchEvent(keyDownEvent);
        
        const keyUpEvent = new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' });
        targetElement.dispatchEvent(keyUpEvent);
        
        const changeEvent = new Event('change', { bubbles: true });
        targetElement.dispatchEvent(changeEvent);
        
        const blurEvent = new Event('blur', { bubbles: true });
        targetElement.dispatchEvent(blurEvent);
        targetElement.blur();
        
        // For React specifically, manually trigger React's internal events
        if ((targetElement as any)._valueTracker) {
          (targetElement as any)._valueTracker.setValue('');
        }
        
        // Custom property descriptor approach for React/Vue compatibility
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter && (tagName === 'input' || tagName === 'textarea')) {
          nativeInputValueSetter.call(targetElement, value);
          
          const syntheticEvent = new Event('input', { bubbles: true }) as any;
          syntheticEvent.simulated = true;
          targetElement.dispatchEvent(syntheticEvent);
        }
      });
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setTimeout(() => {
          setInteractiveState(interactiveElement, 'completed');
        }, 500);
      }
      
    } catch (error) {
      console.error('Error applying interactive action for selector ' + data.reftarget);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
    }
  }, []);

  // Define helper functions using refs to avoid circular dependencies
  runInteractiveSequenceRef.current = async (elements: Element[], showMode: boolean): Promise<void> => {
    for (const element of elements) {
      const data = extractInteractiveDataFromElement(element as HTMLElement);

      if (!data.targetaction || !data.reftarget) {
        console.warn("Skipping element with missing targetAction or reftarget:", element);
        continue;
      }

      try {
        if (data.targetaction === 'highlight') {
          interactiveFocus(data, !showMode); // Show mode = don't click, Do mode = click
        } else if (data.targetaction === 'button') {
          interactiveButton(data, !showMode); // Show mode = don't click, Do mode = click
        } else if (data.targetaction === 'formfill') {
          interactiveFormFill(data, !showMode); // Show mode = don't fill, Do mode = fill
        }

        // Wait for animation to complete between each action
        await new Promise(resolve => setTimeout(resolve, 1300));
      } catch (error) {
        console.error(`Error processing interactive element ${data.targetaction} ${data.reftarget}:`, error);
      }
    }
  };

  runStepByStepSequenceRef.current = async (elements: Element[]): Promise<void> => {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = extractInteractiveDataFromElement(element as HTMLElement);

      if (!data.targetaction || !data.reftarget) {
        console.warn("Skipping element with missing targetAction or reftarget:", element);
        continue;
      }

      try {
        // Step 1: Show what we're about to do
        if (data.targetaction === 'highlight') {
          interactiveFocus(data, false); // Show mode - highlight only
        } else if (data.targetaction === 'button') {
          interactiveButton(data, false); // Show mode - highlight only
        } else if (data.targetaction === 'formfill') {
          interactiveFormFill(data, false); // Show mode - highlight only
        }

        // Wait for highlight animation to complete before doing the action
        await new Promise(resolve => setTimeout(resolve, 1300));

        // Step 2: Actually do the action
        if (data.targetaction === 'highlight') {
          interactiveFocus(data, true); // Do mode - click
        } else if (data.targetaction === 'button') {
          interactiveButton(data, true); // Do mode - click
        } else if (data.targetaction === 'formfill') {
          interactiveFormFill(data, true); // Do mode - fill form
        }

        // Brief pause before next step (if not the last step)
        if (i < elements.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (error) {
        console.error(`Error in step ${i + 1} for ${data.targetaction} ${data.reftarget}:`, error);
      }
    }
  };

  const reftargetExistsCHECK = async (data: InteractiveElementData, check: string): Promise<CheckResult> => {
    // For button actions, check if buttons with matching text exist
    if (data.targetaction === 'button') {
      // console.log(`🔍 Checking for buttons containing text: "${data.reftarget}"`);
      const buttons = findButtonByText(data.reftarget);
      // console.log(`🔍 Found ${buttons.length} buttons with matching text`);
      
      if (buttons.length > 0) {
        // buttons.forEach((button, index) => {
        //   console.log(`🔍 Button ${index + 1}: "${getAllTextContent(button)}" (${button.tagName})`);
        // });
        return {
          requirement: check,
          pass: true,
        };
      } else {
        console.warn(`❌ No buttons found containing text: "${data.reftarget}"`);
        return {
          requirement: check,
          pass: false,
          error: `No buttons found containing text: "${data.reftarget}"`,
          context: data,
        };
      }
    }
    
    // For other actions, check if the CSS selector matches an element
    const targetElement = document.querySelector(data.reftarget);
    if (targetElement) {
      return {
        requirement: check,
        pass: true,
      };
    } 
      
    return {
      requirement: check,
      pass: false,
      error: "Element not found",
      context: data,
    };
  }

  const hasDatasourcesCHECK = async (data: InteractiveElementData, check: string): Promise<CheckResult> => {
    const dataSources = await fetchDataSources();
    if(dataSources.length > 0) {
      return {
        requirement: check,
        pass: true,
      }
    }

    return {
      requirement: check,
      pass: false,
      error: "No data sources found",
      context: dataSources,
    }
  }      

  /**
   * Core requirement checking logic that works with InteractiveElementData
   */
  const checkRequirementsFromData = async (data: InteractiveElementData): Promise<InteractiveRequirementsCheck> => {
    console.log("Checking requirements for interactive element:", data);

    const requirements = data.requirements;
    if (!requirements) {
      console.warn("No requirements found for interactive element");
      return {
        requirements: requirements || '',
        pass: true,
        error: []
      }
    }

    const checks: string[] = requirements.split(',').map(check => check.trim());    

    async function performCheck(check: string, data: InteractiveElementData): Promise<CheckResult> {
      if(check === 'exists-reftarget') {
        return reftargetExistsCHECK(data, check);
      } else if(check === 'has-datasources') {
        return hasDatasourcesCHECK(data, check);
      }

      return {
        requirement: check,
        pass: false,
        error: "Unknown requirement",
        context: data,
      }
    }

    const results = await Promise.all(checks.map(check => performCheck(check, data)));

    return {
      requirements: requirements,
      pass: results.every(result => result.pass),
      error: results,  
    }
  }

  /**
   * Check requirements directly from a DOM element
   */
  const checkElementRequirements = async (element: HTMLElement): Promise<InteractiveRequirementsCheck> => {
    const data = extractInteractiveDataFromElement(element);
    console.log("Checking requirements for element:", data);
    return checkRequirementsFromData(data);
  }

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



  useEffect(() => {
    // Note, that rather than use await here we're using regular promises, because this is an 
    // event handler (which doesn't return promises, fire and forget)
    const handleCustomEvent = (event: CustomEvent) => {
      console.log("React got the event!", event);
      
      // Find the interactive element that triggered this event
      let interactiveElement: HTMLElement | null = null;
      
      // Check if the event has an element reference in the detail (temporary compatibility)
      if (event.detail && event.detail.sourceElement) {
        interactiveElement = event.detail.sourceElement as HTMLElement;
      } else {
        // For events dispatched on document, we need to find the interactive element
        // that was clicked. We'll use a combination of approaches:
        
        // 1. Check recently focused element
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && activeElement.hasAttribute('data-targetaction')) {
          interactiveElement = activeElement;
        } else if (activeElement && typeof activeElement.closest === 'function') {
          interactiveElement = activeElement.closest('[data-targetaction]') as HTMLElement;
        }
        
        // 2. If still not found, look for elements that match the event type pattern
        if (!interactiveElement) {
          // Extract the action type from event name (e.g., 'highlight' from 'interactive-highlight-show')
          const eventAction = event.type.replace('interactive-', '').replace('-show', '');
          const candidateElements = document.querySelectorAll(`[data-targetaction="${eventAction}"]`);
          
          if (candidateElements.length === 1) {
            // If there's only one element with this action type, it's likely the one
            interactiveElement = candidateElements[0] as HTMLElement;
          } else if (candidateElements.length > 1) {
            console.warn(`Multiple elements found with action "${eventAction}". Cannot determine which triggered the event.`);
            // Use the first one as fallback, but this is not ideal
            interactiveElement = candidateElements[0] as HTMLElement;
          }
        }
      }
      
      if (!interactiveElement) {
        console.warn("No interactive element found for event:", event.type);
        console.warn("Available interactive elements:", document.querySelectorAll('[data-targetaction]'));
        return;
      }

      console.log("Found interactive element:", interactiveElement);

      // Extract data from the element instead of using event.detail
      const data = extractInteractiveDataFromElement(interactiveElement);
      
      // Check requirements is important. You can't click a button if it doesn't exist on the 
      // screen.  You can't fill a form out that doesn't exist, and so forth.  This gives us the
      // ability to represent any number of requirements (you must have log data in order to use Explore Logs)
      // that have to be satisifed before an interactive element will "work".
      checkRequirementsFromData(data).then(requirementsCheck => {
        if(!requirementsCheck.pass) {
          console.warn("Requirements not met for interactive element:", data);
          console.warn("Requirements check results:", requirementsCheck);
          return;
        }

        // Dispatch interactive event, depending on its type.
        if (event.type === "interactive-highlight") {
          interactiveFocus(data, true); // Do mode - click
        } else if (event.type === "interactive-highlight-show") {
          interactiveFocus(data, false); // Show mode - don't click
        } else if (event.type === "interactive-button") {
          interactiveButton(data, true); // Do mode - click
        } else if (event.type === "interactive-button-show") {
          interactiveButton(data, false); // Show mode - don't click
        } else if (event.type === "interactive-formfill") {
          interactiveFormFill(data, true); // Do mode - fill form
        } else if (event.type === "interactive-formfill-show") {
          interactiveFormFill(data, false); // Show mode - don't fill
        } else if(event.type === 'interactive-sequence') {
          interactiveSequence(data, false); // Do mode - full sequence
        } else if(event.type === 'interactive-sequence-show') {
          interactiveSequence(data, true); // Show mode - highlight only
        } else {
          console.warn("Unknown event type:", event.type);
        }
      })
      .catch(error => {
        console.error("Error in handleCustomEvent/checkRequirements:", error);
      });
    };

    const events = [
      'interactive-highlight',
      'interactive-highlight-show',
      'interactive-formfill',
      'interactive-formfill-show',
      'interactive-button',
      'interactive-button-show',
      'interactive-sequence',
      'interactive-sequence-show',
    ];

    events.forEach(e => document.addEventListener(e, handleCustomEvent as EventListener));

    return () => {
      events.forEach(e => document.removeEventListener(e, handleCustomEvent as EventListener));
    };
  }, [interactiveButton, interactiveFocus, interactiveFormFill, interactiveSequence]);

  return {
    interactiveFocus,
    interactiveButton,
    interactiveSequence,
    interactiveFormFill,
    checkElementRequirements,
    checkRequirementsFromData,
    checkRequirementsWithData,
  };
} 
