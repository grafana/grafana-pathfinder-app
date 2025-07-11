/* eslint-disable react-hooks/exhaustive-deps */
import { InteractiveRequirementsCheck } from './interactive.hook';

/**
 * Wait for React state updates to complete before proceeding
 * This ensures DOM changes from React state updates have been applied
 * before checking requirements or other DOM-dependent operations
 */
export function waitForReactUpdates(): Promise<void> {
  return new Promise(resolve => {
    // Use requestAnimationFrame to wait for React to flush updates
    // Double RAF ensures we're past React's update cycle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

/**
 * Element state types for interactive elements
 */
export type ElementState = 'idle' | 'checking' | 'satisfied' | 'failed' | 'completed' | 'disabled';

/**
 * Interface for element state update configuration
 */
export interface ElementStateConfig {
  satisfied?: boolean;
  isChecking?: boolean;
  isCompleted?: boolean;
  isDisabled?: boolean;
  error?: string;
}

/**
 * Interface for sequential requirement checking result
 */
export interface SequentialRequirementsResult {
  totalElements: number;
  processedElements: number;
  satisfied: number;
  failed: number;
  completed: number;
  disabled: number;
  failedAtIndex?: number;
}

/**
 * Update element visual state based on requirement check results
 * Consolidates all the state management logic that was duplicated across files
 */
export function updateElementState(element: HTMLElement, config: ElementStateConfig): void {
  const { satisfied = false, isChecking = false, isCompleted = false, isDisabled = false, error } = config;
  
  // Remove all requirement state classes
  element.classList.remove(
    'requirements-satisfied', 
    'requirements-failed', 
    'requirements-checking', 
    'requirements-completed',
    'requirements-disabled'
  );
  
  // Handle checking state
  if (isChecking) {
    element.classList.add('requirements-checking');
    
    if (element.tagName.toLowerCase() === 'button') {
      const originalText = element.getAttribute('data-original-text') || element.textContent || '';
      if (!element.getAttribute('data-original-text')) {
        element.setAttribute('data-original-text', originalText);
      }
      element.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: inline-block; margin-right: 4px; animation: spin 1s linear infinite;">
          <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"/>
        </svg>
        Checking...
      `;
    }
    return;
  }
  
  const originalText = element.getAttribute('data-original-text');
  
  // Handle completion state (implicit requirement #2)
  if (isCompleted) {
    element.classList.add('requirements-completed');
    element.setAttribute('data-completed', 'true');
    
    if (element.tagName.toLowerCase() === 'button') {
      (element as HTMLButtonElement).disabled = true;
      element.setAttribute('aria-disabled', 'true');
      element.title = 'This step has been completed';
      if (originalText) {
        element.textContent = `${originalText} ✓`;
      }
    }
    return;
  }
  
  // Handle disabled state (implicit requirement #1 - sequential dependency)
  if (isDisabled) {
    element.classList.add('requirements-disabled');
    
    if (element.tagName.toLowerCase() === 'button') {
      (element as HTMLButtonElement).disabled = true;
      element.setAttribute('aria-disabled', 'true');
      element.title = 'Previous steps must be completed first';
      if (originalText) {
        element.textContent = originalText;
      }
    }
    return;
  }
  
  // Handle satisfied/failed states
  if (satisfied) {
    element.classList.add('requirements-satisfied');
    
    if (element.tagName.toLowerCase() === 'button') {
      (element as HTMLButtonElement).disabled = false;
      element.setAttribute('aria-disabled', 'false');
      element.removeAttribute('title');
      if (originalText) {
        element.textContent = originalText;
      }
    }
  } else {
    element.classList.add('requirements-failed');
    
    if (element.tagName.toLowerCase() === 'button') {
      (element as HTMLButtonElement).disabled = true;
      element.setAttribute('aria-disabled', 'true');
      
      const requirements = element.getAttribute('data-requirements') || '';
      if (error) {
        element.title = `Requirements not met (${requirements}): ${error}`;
      } else {
        element.title = `Requirements not met: ${requirements}`;
      }
      
      if (originalText) {
        element.textContent = originalText;
      }
    }
  }
}

/**
 * Check if an element is already completed (implicit requirement #2)
 */
export function isElementCompleted(element: HTMLElement): boolean {
  return element.hasAttribute('data-completed') || element.classList.contains('requirements-completed');
}

/**
 * Mark an element as completed (implicit requirement #2)
 */
export function markElementCompleted(element: HTMLElement): void {
  updateElementState(element, { isCompleted: true });
}

/**
 * Get all interactive elements in DOM order for sequential processing
 */
export function getInteractiveElementsInOrder(container?: HTMLElement): HTMLElement[] {
  const searchContainer = container || document;
  const elements = searchContainer.querySelectorAll('[data-requirements]') as NodeListOf<HTMLElement>;
  return Array.from(elements);
}

/**
 * Check requirements for interactive steps sequentially with implicit requirements
 * Implements all implicit requirements:
 * 1. Sequential dependency - only one step enabled at a time (One Step at a Time)
 * 2. Completion state - completed steps are skipped and kept disabled
 * 3. Trust but Verify the First Step - when no steps are completed, always check first step
 * 
 * PERFORMANCE OPTIMIZATION: Only checks requirements for ONE step per run
 * - Completed steps: fast-disable without requirements check
 * - Future steps: fast-disable without requirements check  
 * - Current step: the only one that gets an expensive requirements check
 * 
 * CURRENT STEP SELECTION:
 * - If no steps completed: Current step = first step (Trust but Verify rule)
 * - If some steps completed: Current step = first non-completed step (One Step at a Time)
 * 
 * LOGICAL STEP GROUPING:
 * - Elements with same reftarget+targetaction = same logical step
 * - "Show Me" and "Do It" buttons belong to the same step
 * - Requirements checking applies to the entire step, not individual buttons
 */
export async function checkRequirementsSequentially(
  elements: HTMLElement[],
  checkElementRequirements: (element: HTMLElement) => Promise<InteractiveRequirementsCheck>
): Promise<SequentialRequirementsResult> {
  const result: SequentialRequirementsResult = {
    totalElements: elements.length,
    processedElements: 0,
    satisfied: 0,
    failed: 0,
    completed: 0,
    disabled: 0
  };
  
  if (elements.length === 0) {
    return result;
  }
  
  // Group elements by logical step (same reftarget + targetaction)
  const steps = groupInteractiveElementsByStep(elements);
  console.log(`📋 Grouped ${elements.length} elements into ${steps.length} logical steps`);
  
  // Set all elements to checking state initially
  elements.forEach(element => {
    updateElementState(element, { isChecking: true });
  });
  
  // STEP 1: Determine the current step based on completion state
  let currentStepIndex = -1;
  let hasAnyCompletedSteps = false;
  
  // Check if any steps have been completed
  for (let i = 0; i < steps.length; i++) {
    if (isStepCompleted(steps[i])) {
      hasAnyCompletedSteps = true;
      break;
    }
  }
  
  if (!hasAnyCompletedSteps) {
    // TRUST BUT VERIFY THE FIRST STEP: When no steps are completed, 
    // always check the first step (special exception to One Step at a Time)
    currentStepIndex = 0;
    console.log('🏁 No steps completed - checking first step (Trust but Verify rule)');
  } else {
    // Find the first non-completed step (normal One Step at a Time behavior)
    for (let i = 0; i < steps.length; i++) {
      if (!isStepCompleted(steps[i])) {
        currentStepIndex = i;
        break;
      }
    }
    console.log(`🎯 Found first non-completed step: ${currentStepIndex + 1}`);
  }
  
  // STEP 2: Process each step based on its position relative to the current step
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    result.processedElements += step.buttons.length;
    
    if (isStepCompleted(step)) {
      // FAST-DISABLE: Already completed steps stay disabled, no requirements check needed
      updateStepState(step, { isCompleted: true });
      result.completed += step.buttons.length;
      console.log(`✅ Step ${i + 1} already completed (${step.buttons.length} buttons)`);
      
    } else if (i === currentStepIndex) {
      // CURRENT STEP: This is the only step that gets an expensive requirements check
      console.log(`🔍 Checking requirements for current step ${i + 1}/${steps.length} (${step.buttons.length} buttons)`);
      
      try {
        // Use the first button of the step for requirements checking
        // (all buttons in a step have the same requirements)
        const requirementsCheck = await checkElementRequirements(step.buttons[0]);
        
        if (requirementsCheck.pass) {
          // Enable all buttons in this step - they should all be enabled together
          updateStepState(step, { satisfied: true });
          result.satisfied += step.buttons.length;
          console.log(`✅ Current step ${i + 1} enabled (${step.buttons.length} buttons: ${step.buttons.map(b => b.getAttribute('data-button-type') || 'unknown').join(', ')})`);
        } else {
          // Current step failed - disable all buttons in this step
          updateStepState(step, { 
            satisfied: false, 
            error: requirementsCheck.error?.map(e => e.error || e.requirement).join(', ') 
          });
          result.failed += step.buttons.length;
          result.failedAtIndex = i;
          console.log(`❌ Current step ${i + 1} failed (${step.buttons.length} buttons):`, requirementsCheck.error);
        }
      } catch (error) {
        console.error(`💥 Error checking requirements for current step ${i + 1}:`, error);
        updateStepState(step, { 
          satisfied: false, 
          error: 'Error checking requirements' 
        });
        result.failed += step.buttons.length;
        result.failedAtIndex = i;
      }
      
    } else {
      // FAST-DISABLE: Future steps are disabled without requirements check (One Step at a Time)
      updateStepState(step, { isDisabled: true });
      result.disabled += step.buttons.length;
      console.log(`⏸️ Future step ${i + 1} disabled (${step.buttons.length} buttons: One Step at a Time)`);
    }
  }
  
  // STEP 3: Log the final state for debugging
  console.log(`📊 Sequential requirements check complete:`, {
    currentStep: currentStepIndex >= 0 ? currentStepIndex + 1 : 'none',
    strategy: hasAnyCompletedSteps ? 'First non-completed' : 'Trust but Verify first step',
    totalElements: result.totalElements,
    totalSteps: steps.length,
    satisfied: result.satisfied,
    failed: result.failed,
    completed: result.completed,
    disabled: result.disabled,
    failedAtIndex: result.failedAtIndex
  });
  
  return result;
}

/**
 * Add global CSS styles for the new requirement states
 */
export function addRequirementStyles(): void {
  if (document.getElementById('requirement-styles-enhanced')) {
    return;
  }
  
  const style = document.createElement('style');
  style.id = 'requirement-styles-enhanced';
  style.textContent = `
    /* Enhanced requirement states */
    .requirements-checking {
      opacity: 0.7;
    }
    
    .requirements-satisfied {
      /* Visual feedback for satisfied requirements */
    }
    
    .requirements-failed {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .requirements-completed {
      opacity: 0.6;
      cursor: not-allowed;
      border-color: #c3e6cb !important;
    }
    
    .requirements-completed button {
      background-color: #28a745 !important;
      border-color: #28a745 !important;
      color: white !important;
      opacity: 0.8;
      cursor: not-allowed;
    }
    
    .requirements-disabled {
      opacity: 0.3;
      cursor: not-allowed;
      background-color: #f8f9fa !important;
      border-color: #dee2e6 !important;
    }
    
    .requirements-disabled button {
      opacity: 0.3;
      cursor: not-allowed;
      background-color: #6c757d !important;
      border-color: #6c757d !important;
    }
    
    .requirements-failed button,
    .requirements-completed button,
    .requirements-disabled button {
      cursor: not-allowed;
    }
    
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  
  document.head.appendChild(style);
}

/**
 * Unified requirements checking function that handles both individual and sequential checks
 */
export async function checkAllElementRequirements(
  container: HTMLElement,
  checkElementRequirements: (element: HTMLElement) => Promise<InteractiveRequirementsCheck>,
  useSequentialMode = true
): Promise<SequentialRequirementsResult> {
  const elements = getInteractiveElementsInOrder(container);
  
  if (elements.length === 0) {
    return {
      totalElements: 0,
      processedElements: 0,
      satisfied: 0,
      failed: 0,
      completed: 0,
      disabled: 0
    };
  }
  
  // Add styles if not already present
  addRequirementStyles();
  
  if (useSequentialMode) {
    return checkRequirementsSequentially(elements, checkElementRequirements);
  } else {
    // Legacy parallel mode for backwards compatibility
    const result: SequentialRequirementsResult = {
      totalElements: elements.length,
      processedElements: elements.length,
      satisfied: 0,
      failed: 0,
      completed: 0,
      disabled: 0
    };
    
    // Set all to checking state
    elements.forEach(element => {
      updateElementState(element, { isChecking: true });
    });
    
    // Check in parallel
    const checkPromises = elements.map(async (element) => {
      try {
        if (isElementCompleted(element)) {
          updateElementState(element, { isCompleted: true });
          result.completed++;
          return;
        }
        
        const requirementsCheck = await checkElementRequirements(element);
        
        if (requirementsCheck.pass) {
          updateElementState(element, { satisfied: true });
          result.satisfied++;
        } else {
          updateElementState(element, { 
            satisfied: false, 
            error: requirementsCheck.error?.map(e => e.error || e.requirement).join(', ') 
          });
          result.failed++;
        }
      } catch (error) {
        console.error('Error checking element requirements:', error);
        updateElementState(element, { 
          satisfied: false, 
          error: 'Error checking requirements' 
        });
        result.failed++;
      }
    });
    
    await Promise.allSettled(checkPromises);
    return result;
  }
}

/**
 * Interface for representing a logical interactive step that may contain multiple buttons
 */
export interface InteractiveStep {
  reftarget: string;
  targetaction: string;
  requirements: string;
  buttons: HTMLElement[];
  stepIndex: number;
}

/**
 * Group interactive elements by their logical step
 * Elements with the same reftarget and targetaction belong to the same step
 */
export function groupInteractiveElementsByStep(elements: HTMLElement[]): InteractiveStep[] {
  const stepMap = new Map<string, InteractiveStep>();
  
  elements.forEach((element, index) => {
    const reftarget = element.getAttribute('data-reftarget') || '';
    const targetaction = element.getAttribute('data-targetaction') || '';
    const requirements = element.getAttribute('data-requirements') || '';
    const stepKey = `${reftarget}|${targetaction}`;
    
    if (!stepMap.has(stepKey)) {
      stepMap.set(stepKey, {
        reftarget,
        targetaction,
        requirements,
        buttons: [],
        stepIndex: stepMap.size // Sequential step index
      });
    }
    
    stepMap.get(stepKey)!.buttons.push(element);
  });
  
  return Array.from(stepMap.values());
}

/**
 * Check if any button in a step is completed
 */
export function isStepCompleted(step: InteractiveStep): boolean {
  return step.buttons.some(button => isElementCompleted(button));
}

/**
 * Mark all buttons in a step as completed
 */
export function markStepCompleted(step: InteractiveStep): void {
  step.buttons.forEach(button => {
    markElementCompleted(button);
  });
}

/**
 * Update the state of all buttons in a step
 */
export function updateStepState(step: InteractiveStep, config: ElementStateConfig): void {
  step.buttons.forEach(button => {
    updateElementState(button, config);
  });
}
