import { useEffect } from 'react';

export function useInteractiveElements() {
  function highlight(element: HTMLElement) {
    // Add highlight class for better styling
    element.classList.add('interactive-highlighted');
    
    // Create a highlight outline element
    const highlightOutline = document.createElement('div');
    highlightOutline.className = 'interactive-highlight-outline';
    
    // Position the outline around the target element
    const rect = element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
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
    highlightOutline.style.animation = 'highlight-pulse 2s ease-in-out';
    
    document.body.appendChild(highlightOutline);
    
    // Remove highlight after animation completes
    setTimeout(() => {
      element.classList.remove('interactive-highlighted');
      if (highlightOutline.parentNode) {
        highlightOutline.parentNode.removeChild(highlightOutline);
      }
    }, 2000);
    
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
  
  function interactiveFocus(reftarget: string, click: boolean = true) {
    console.log("Interactive focus called for:", reftarget);
    const interactiveElement = findInteractiveElement(reftarget);
    
    if (interactiveElement) {
      setInteractiveState(interactiveElement, 'running');
    }
    
    const targetElements = document.querySelectorAll(reftarget);
    
    try {
      targetElements.forEach(element => {
        highlight((element as HTMLElement));
        if (click) {
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
  }

  function interactiveButton(reftarget: string, click: boolean = true) {
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
        highlight(button);
        if (click) {
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
  }

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

  const activeRefs = new Set<string>();

  async function interactiveSequence(reftarget: string): Promise<string> {
    // This is here so recursion cannot happen
    if(activeRefs.has(reftarget)) {
      console.log("Interactive sequence already active for:", reftarget);
      return reftarget;
    }

    console.log("Interactive sequence called for:", reftarget);
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

      activeRefs.add(reftarget);

      // Find all button elements with onClick attributes, no matter how deeply nested
      const buttonsWithOnClick = Array.from(targetElements[0].querySelectorAll('button[onclick]')) as HTMLButtonElement[];
      
      console.log(`Found ${buttonsWithOnClick.length} buttons with onClick in element:`, targetElements[0]);
      console.log("Buttons in sequence:", buttonsWithOnClick);      
      
      await runSequence(buttonsWithOnClick);
      
      // Mark as completed after successful execution
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'completed');
      }
      
      activeRefs.delete(reftarget);
      return reftarget;
    } catch (error) {
      console.error("Error in interactiveSequence:", error);
      if (interactiveElement) {
        setInteractiveState(interactiveElement, 'error');
      }
      activeRefs.delete(reftarget);
      throw error;
    }
  } 

  function interactiveFormFill(reftarget: string, value: string) {
    console.log(`Interactive link clicked, targeting: ${reftarget} with ${value}`);
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
  }

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      console.log("React got the event!", event);

      if (event.type === "interactive-highlight") {
        interactiveFocus(event.detail.reftarget);
      } else if (event.type === "interactive-button") {
        interactiveButton(event.detail.reftarget);
      } else if (event.type === "interactive-formfill") {
        interactiveFormFill(event.detail.reftarget, event.detail.value);
      } else if(event.type === 'interactive-sequence') {
        interactiveSequence(event.detail.reftarget);
      } else {
        console.warn("Unknown event type:", event.type);
      }
    };

    const events = [
      'interactive-highlight',
      'interactive-formfill',
      'interactive-button',
      'interactive-sequence',
    ];

    events.forEach(e => document.addEventListener(e, handleCustomEvent as EventListener));

    return () => {
      events.forEach(e => document.removeEventListener(e, handleCustomEvent as EventListener));
    };
  }, []);

  return {
    interactiveFocus,
    interactiveButton,
    interactiveSequence,
    interactiveFormFill,
  };
} 