import { useEffect, useCallback, useRef } from 'react';

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
  
  const interactiveFocus = useCallback((reftarget: string, click = true) => {
    console.log("Interactive focus called for:", reftarget, "click:", click);
    const interactiveElement = findInteractiveElement(reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    const targetElements = document.querySelectorAll(reftarget);
    
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

  const interactiveButton = useCallback((reftarget: string, click = true) => {
    console.log("Interactive button called for:", reftarget, "click:", click);
    const interactiveElement = findInteractiveElement(reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    function findButtonByText(targetText: string) {
      const buttons = document.querySelectorAll('button');
    
      return Array.from(buttons).filter((button) => {
        const text = (button.textContent || '').trim().toLowerCase();
        return text.toLowerCase() === targetText.toLowerCase();
      });
    }

    try {
      const buttons = findButtonByText(reftarget);
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

  const interactiveSequence = useCallback(async (reftarget: string, showOnly = false): Promise<string> => {
    // This is here so recursion cannot happen
    if(activeRefsRef.current.has(reftarget)) {
      console.log("Interactive sequence already active for:", reftarget);
      return reftarget;
    }

    console.log("Interactive sequence called for:", reftarget, "showOnly:", showOnly);
    const interactiveElement = findInteractiveElement(reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    try {
      const targetElements = document.querySelectorAll(reftarget);

      if(targetElements.length === 0 || targetElements.length > 1) {
        const msg = (targetElements.length + 
          " interactive sequence elements found matching selector: " + reftarget + 
          " - this is not supported");
        throw new Error(msg);
      } 

      activeRefsRef.current.add(reftarget);

      // Find all interactive elements within the sequence container
      const interactiveElements = Array.from(targetElements[0].querySelectorAll('.interactive[data-targetaction]:not([data-targetaction="sequence"])'));
      
      console.log(`Found ${interactiveElements.length} interactive elements in sequence:`, targetElements[0]);
      
      if (!showOnly) {
        // Full sequence: Show each step, then do each step, one by one
        console.log("Starting step-by-step sequence...");
        await runStepByStepSequenceRef.current!(interactiveElements);
      } else {
        // Show only mode
        console.log("Running sequence in SHOW ONLY mode...");
        await runInteractiveSequenceRef.current!(interactiveElements, true);
      }
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'completed');
      }
      
      activeRefsRef.current.delete(reftarget);
      return reftarget;
    } catch (error) {
      console.error("Error in interactiveSequence:", error);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
      activeRefsRef.current.delete(reftarget);
      throw error;
    }
  }, []);

  const interactiveFormFill = useCallback((reftarget: string, value: string, fillForm = true) => {
    console.log(`Interactive form fill called, targeting: ${reftarget} with ${value}, fillForm: ${fillForm}`);
    const interactiveElement = findInteractiveElement(reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    try {
      const targetElements = document.querySelectorAll(reftarget);
      
      if (targetElements.length === 0) {
        console.warn(`No elements found matching selector: ${reftarget}`);
        return;
      }
      
      console.log('Found ' + targetElements.length + ' elements matching selector' + reftarget);
      
      targetElements.forEach(function(te, index) {
         const targetElement = te as HTMLElement;

         if (!fillForm) {
           // Show mode: only highlight, don't fill the form
           highlight(targetElement);
           console.log('Show mode: Only highlighting element ' + (index + 1));
           return;
         }

         // Do mode: don't highlight, just fill the form

         const tagName = targetElement.tagName.toLowerCase();
         const inputType = (targetElement as HTMLInputElement).type ? (targetElement as HTMLInputElement).type.toLowerCase() : '';
         
         console.log('Processing element ' + (index + 1) + ' - Tag: ' + tagName + ', Type: ' + inputType);
         
         if (tagName === 'input') {
           if (inputType === 'checkbox' || inputType === 'radio') {
             (targetElement as HTMLInputElement).checked = value !== 'false' && value !== '0' && value !== '';
             console.log('Set checked state to: ' + (targetElement as HTMLInputElement).checked);
           } else {
             (targetElement as HTMLInputElement).value = value;
             console.log('Set input value to: ' + value);
           }
         } else if (tagName === 'textarea') {
           (targetElement as HTMLTextAreaElement).value = value;
           console.log('Set textarea value to: ' + value);
         } else if (tagName === 'select') {
           (targetElement as HTMLSelectElement).value = value;
           console.log('Set select value to: ' + value);
         } else {
           targetElement.textContent = value;
           console.log('Set text content to: ' + value);
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
        
        console.log('Triggered comprehensive event sequence for form element');            
      });
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setTimeout(() => {
          setInteractiveState(interactiveElement, 'completed');
        }, 500);
      }
      
    } catch (error) {
      console.error('Error applying interactive action for selector ' + reftarget);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
    }
  }, []);

  // Define helper functions using refs to avoid circular dependencies
  runInteractiveSequenceRef.current = async (elements: Element[], showMode: boolean): Promise<void> => {
    for (const element of elements) {
      const targetAction = element.getAttribute('data-targetaction');
      const reftarget = element.getAttribute('data-reftarget');
      const value = element.getAttribute('data-targetvalue') || '';

      if (!targetAction || !reftarget) {
        console.warn("Skipping element with missing targetAction or reftarget:", element);
        continue;
      }

      console.log(`Processing interactive element: ${targetAction} ${reftarget} (show mode: ${showMode})`);

      try {
        if (targetAction === 'highlight') {
          interactiveFocus(reftarget, !showMode); // Show mode = don't click, Do mode = click
        } else if (targetAction === 'button') {
          interactiveButton(reftarget, !showMode); // Show mode = don't click, Do mode = click
        } else if (targetAction === 'formfill') {
          interactiveFormFill(reftarget, value, !showMode); // Show mode = don't fill, Do mode = fill
        }

        // Wait for animation to complete between each action
        await new Promise(resolve => setTimeout(resolve, 1300));
      } catch (error) {
        console.error(`Error processing interactive element ${targetAction} ${reftarget}:`, error);
      }
    }
  };

  runStepByStepSequenceRef.current = async (elements: Element[]): Promise<void> => {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const targetAction = element.getAttribute('data-targetaction');
      const reftarget = element.getAttribute('data-reftarget');
      const value = element.getAttribute('data-targetvalue') || '';

      if (!targetAction || !reftarget) {
        console.warn("Skipping element with missing targetAction or reftarget:", element);
        continue;
      }

      console.log(`Step ${i + 1}: SHOW ${targetAction} ${reftarget}`);

      try {
        // Step 1: Show what we're about to do
        if (targetAction === 'highlight') {
          interactiveFocus(reftarget, false); // Show mode - highlight only
        } else if (targetAction === 'button') {
          interactiveButton(reftarget, false); // Show mode - highlight only
        } else if (targetAction === 'formfill') {
          interactiveFormFill(reftarget, value, false); // Show mode - highlight only
        }

        // Wait for highlight animation to complete before doing the action
        await new Promise(resolve => setTimeout(resolve, 1300));

        console.log(`Step ${i + 1}: DO ${targetAction} ${reftarget}`);

        // Step 2: Actually do the action
        if (targetAction === 'highlight') {
          interactiveFocus(reftarget, true); // Do mode - click
        } else if (targetAction === 'button') {
          interactiveButton(reftarget, true); // Do mode - click
        } else if (targetAction === 'formfill') {
          interactiveFormFill(reftarget, value, true); // Do mode - fill form
        }

        // Brief pause before next step (if not the last step)
        if (i < elements.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (error) {
        console.error(`Error in step ${i + 1} for ${targetAction} ${reftarget}:`, error);
      }
    }
  };

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      console.log("React got the event!", event);

      if (event.type === "interactive-highlight") {
        interactiveFocus(event.detail.reftarget, true); // Do mode - click
      } else if (event.type === "interactive-highlight-show") {
        interactiveFocus(event.detail.reftarget, false); // Show mode - don't click
      } else if (event.type === "interactive-button") {
        interactiveButton(event.detail.reftarget, true); // Do mode - click
      } else if (event.type === "interactive-button-show") {
        interactiveButton(event.detail.reftarget, false); // Show mode - don't click
      } else if (event.type === "interactive-formfill") {
        interactiveFormFill(event.detail.reftarget, event.detail.value, true); // Do mode - fill form
      } else if (event.type === "interactive-formfill-show") {
        interactiveFormFill(event.detail.reftarget, event.detail.value, false); // Show mode - don't fill
      } else if(event.type === 'interactive-sequence') {
        interactiveSequence(event.detail.reftarget, false); // Do mode - full sequence
      } else if(event.type === 'interactive-sequence-show') {
        interactiveSequence(event.detail.reftarget, true); // Show mode - highlight only
      } else {
        console.warn("Unknown event type:", event.type);
      }
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
  };
} 
