// Interactive Bridge Service
// Connects new React components to existing interactive.hook.ts logic
// Enables gradual migration from DOM processing to React components

import { 
  InteractiveElementData 
} from '../interactive.hook';

/**
 * Bridge service that translates between new React component props and existing interactive system
 * This allows gradual migration without breaking existing functionality
 */
export class InteractiveBridge {
  private static instance: InteractiveBridge;
  
  // Store active interactive functions from the hook
  private interactiveFunctions: {
    interactiveFocus?: (data: InteractiveElementData, click: boolean, element: HTMLElement) => void;
    interactiveButton?: (data: InteractiveElementData, click: boolean, element: HTMLElement) => void;
    interactiveFormFill?: (data: InteractiveElementData, fillForm: boolean, element: HTMLElement) => void;
    interactiveNavigate?: (data: InteractiveElementData, navigate: boolean, element: HTMLElement) => void;
    interactiveSequence?: (data: InteractiveElementData, showOnly: boolean, element: HTMLElement) => Promise<string>;
    checkElementRequirements?: (element: HTMLElement) => Promise<any>;
  } = {};

  private constructor() {}

  public static getInstance(): InteractiveBridge {
    if (!InteractiveBridge.instance) {
      InteractiveBridge.instance = new InteractiveBridge();
    }
    return InteractiveBridge.instance;
  }

  /**
   * Initialize the bridge with functions from the interactive hook
   * This should be called once when the interactive hook is initialized
   */
  public initializeWithHook(hookFunctions: {
    interactiveFocus: (data: InteractiveElementData, click: boolean, element: HTMLElement) => void;
    interactiveButton: (data: InteractiveElementData, click: boolean, element: HTMLElement) => void;
    interactiveFormFill: (data: InteractiveElementData, fillForm: boolean, element: HTMLElement) => void;
    interactiveNavigate: (data: InteractiveElementData, navigate: boolean, element: HTMLElement) => void;
    interactiveSequence: (data: InteractiveElementData, showOnly: boolean, element: HTMLElement) => Promise<string>;
    checkElementRequirements: (element: HTMLElement) => Promise<any>;
  }) {
    this.interactiveFunctions = hookFunctions;
  }

  /**
   * Execute an interactive action using the existing interactive system
   * This bridges React component calls to the existing DOM-based system
   */
  public async executeAction(
    targetAction: string,
    refTarget: string,
    targetValue?: string,
    buttonType: 'show' | 'do' = 'do',
    uniqueId?: string
  ): Promise<void> {
    // Create InteractiveElementData object that matches the existing system
    const elementData: InteractiveElementData = {
      reftarget: refTarget,
      targetaction: targetAction,
      targetvalue: targetValue,
      requirements: undefined, // Will be handled by requirements checking
      tagName: 'button', // Simulated as button
      textContent: `${buttonType === 'show' ? 'Show me' : 'Do'}: ${refTarget}`,
      timestamp: Date.now(),
    };

    // Use provided unique ID or generate one if not provided (no prefix - system will add it)
    const resolvedUniqueId = uniqueId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create a temporary DOM element for compatibility with existing system
    const tempElement = document.createElement('button');
    tempElement.setAttribute('data-reftarget', refTarget);
    tempElement.setAttribute('data-targetaction', targetAction);
    if (targetValue) {
      tempElement.setAttribute('data-targetvalue', targetValue);
    }
    tempElement.setAttribute('data-button-type', buttonType);
    
    // Add required unique step ID - use step-id for non-sequence actions
    if (targetAction === 'sequence') {
      tempElement.setAttribute('data-section-id', resolvedUniqueId);
    } else {
      tempElement.setAttribute('data-step-id', resolvedUniqueId);
    }
    
    // Add to DOM temporarily so the interactive system can find it for step grouping
    // We need a requirements attribute for the system to find it
    tempElement.setAttribute('data-requirements', 'bridge-element');
    tempElement.style.display = 'none'; // Hide it visually
    document.body.appendChild(tempElement);

    const isShowMode = buttonType === 'show';

    try {
      // Route to appropriate existing function based on action type
      switch (targetAction) {
        case 'highlight':
          if (this.interactiveFunctions.interactiveFocus) {
            this.interactiveFunctions.interactiveFocus(elementData, !isShowMode, tempElement);
          }
          break;

        case 'button':
          if (this.interactiveFunctions.interactiveButton) {
            this.interactiveFunctions.interactiveButton(elementData, !isShowMode, tempElement);
          }
          break;

        case 'formfill':
          if (this.interactiveFunctions.interactiveFormFill) {
            this.interactiveFunctions.interactiveFormFill(elementData, !isShowMode, tempElement);
          }
          break;

        case 'navigate':
          if (this.interactiveFunctions.interactiveNavigate) {
            this.interactiveFunctions.interactiveNavigate(elementData, !isShowMode, tempElement);
          }
          break;

        case 'sequence':
          if (this.interactiveFunctions.interactiveSequence) {
            await this.interactiveFunctions.interactiveSequence(elementData, isShowMode, tempElement);
          }
          break;

        default:
          console.warn(`Unknown interactive action: ${targetAction}`);
      }
    } finally {
      // Clean up temporary element from DOM
      if (tempElement.parentNode) {
        tempElement.parentNode.removeChild(tempElement);
      }
    }
  }

  /**
   * Check requirements for an interactive element
   * Bridges React component requirements to existing system
   */
  public async checkRequirements(
    targetAction: string,
    refTarget: string,
    requirements?: string,
    uniqueId?: string
  ): Promise<{ pass: boolean; error?: string }> {
    if (!requirements || !this.interactiveFunctions.checkElementRequirements) {
      return { pass: true };
    }

    // Use provided unique ID or generate one if not provided (no prefix - system will add it)
    const resolvedUniqueId = uniqueId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create temporary element with requirements
    const tempElement = document.createElement('button');
    tempElement.setAttribute('data-reftarget', refTarget);
    tempElement.setAttribute('data-targetaction', targetAction);
    tempElement.setAttribute('data-requirements', requirements);
    
    // Add required unique step ID - use step-id for non-sequence actions
    if (targetAction === 'sequence') {
      tempElement.setAttribute('data-section-id', resolvedUniqueId);
    } else {
      tempElement.setAttribute('data-step-id', resolvedUniqueId);
    }
    
    // Add to DOM temporarily so the system can find it if needed
    tempElement.style.display = 'none';
    document.body.appendChild(tempElement);

    try {
      const result = await this.interactiveFunctions.checkElementRequirements(tempElement);
      return {
        pass: result.pass,
        error: result.pass ? undefined : result.error?.map((e: any) => e.error).join(', ')
      };
    } catch (error) {
      console.error('Requirements check failed:', error);
      return {
        pass: false,
        error: error instanceof Error ? error.message : 'Requirements check failed'
      };
    } finally {
      // Clean up temporary element from DOM
      if (tempElement.parentNode) {
        tempElement.parentNode.removeChild(tempElement);
      }
    }
  }

  /**
   * Check if the bridge is properly initialized
   */
  public isInitialized(): boolean {
    return Object.keys(this.interactiveFunctions).length > 0;
  }
}

/**
 * Convenience function for React components to execute interactive actions
 */
export async function executeInteractiveAction(
  targetAction: string,
  refTarget: string,
  targetValue?: string,
  buttonType: 'show' | 'do' = 'do',
  uniqueId?: string
): Promise<void> {
  const bridge = InteractiveBridge.getInstance();
  
  if (!bridge.isInitialized()) {
    console.warn('Interactive bridge not initialized. Action will be simulated.');
    // Fallback to simulation for now
    await new Promise(resolve => setTimeout(resolve, 800));
    return;
  }

  await bridge.executeAction(targetAction, refTarget, targetValue, buttonType, uniqueId);
}

/**
 * Convenience function for React components to check requirements
 */
export async function checkInteractiveRequirements(
  targetAction: string,
  refTarget: string,
  requirements?: string,
  uniqueId?: string
): Promise<{ pass: boolean; error?: string }> {
  const bridge = InteractiveBridge.getInstance();
  
  if (!bridge.isInitialized()) {
    console.warn('Interactive bridge not initialized. Requirements check will pass.');
    return { pass: true };
  }

  return bridge.checkRequirements(targetAction, refTarget, requirements, uniqueId);
} 
