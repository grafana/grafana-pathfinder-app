import { useState, useEffect, useCallback, useRef } from 'react';
import { useInteractiveElements } from './interactive.hook';

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
 * React-based requirements checking system
 * Replaces the DOM-based requirements.util.ts with a clean React approach
 * 
 * Key features:
 * - Sequential dependency: only one step enabled at a time
 * - Completion state tracking: completed steps stay disabled
 * - Trust but verify: first step always gets checked
 * - Section vs regular step workflows
 */

export interface RequirementsState {
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;
  error?: string;
  hint?: string;
  explanation?: string; // User-friendly explanation for why requirements aren't met
}

export interface RequirementsCheckResult {
  pass: boolean;
  error?: Array<{
    requirement: string;
    error: string;
  }>;
}

export interface UseRequirementsCheckerProps {
  requirements?: string;
  hints?: string;
  stepId?: string;
  sectionId?: string;
  targetAction?: string;
  isSequence?: boolean;
}

export interface UseRequirementsCheckerReturn extends RequirementsState {
  checkRequirements: () => Promise<void>;
  markCompleted: () => void;
  reset: () => void;
  triggerReactiveCheck: () => void;
}

/**
 * React hook for requirements checking
 * Integrates with the existing useInteractiveElements hook for requirement validation
 */
export function useRequirementsChecker({
  requirements,
  hints,
  stepId,
  sectionId,
  targetAction,
  isSequence = false,
}: UseRequirementsCheckerProps): UseRequirementsCheckerReturn {
  const [state, setState] = useState<RequirementsState>({
    isEnabled: false,
    isCompleted: false,
    isChecking: false,
    hint: hints,
    explanation: requirements ? getRequirementExplanation(requirements, hints) : undefined,
  });
  
  const { checkElementRequirements } = useInteractiveElements();
  const checkPromiseRef = useRef<Promise<void> | null>(null);
  const managerRef = useRef<SequentialRequirementsManager | null>(null);
  
  // Create a unique identifier for this step
  const uniqueId = sectionId ? `section-${sectionId}` : stepId ? `step-${stepId}` : `fallback-${Date.now()}`;
  
  // Initialize manager reference
  if (!managerRef.current) {
    managerRef.current = SequentialRequirementsManager.getInstance();
  }
  const checkRequirements = useCallback(async () => {
    // Prevent concurrent checks
    if (checkPromiseRef.current) {
      return checkPromiseRef.current;
    }
    
    if (!requirements || state.isCompleted) {
      // For completed steps: keep them completed and disabled
      // For steps without requirements: enable them
      const newState = state.isCompleted 
        ? { ...state, isEnabled: false, isChecking: false, isCompleted: true } // Preserve completion
        : { ...state, isEnabled: true, isChecking: false }; // Enable if no requirements
      
      // Debug logging for completion state preservation
      if (process.env.NODE_ENV === 'development' && state.isCompleted) {
        console.warn(`🔒 Step ${uniqueId} completion state PRESERVED during re-check`);
      }
      
      setState(newState);
      
      // Directly notify the manager with the new state to avoid timing issues
      if (managerRef.current) {
        managerRef.current.updateStep(uniqueId, newState);
      }
      return;
    }
    
    setState(prev => ({ ...prev, isChecking: true, error: undefined }));
    
    const checkPromise = (async () => {
      try {
        // Create a mock element with the requirements for checking
        const mockElement = document.createElement('div');
        mockElement.setAttribute('data-requirements', requirements);
        mockElement.setAttribute('data-targetaction', targetAction || 'button');
        mockElement.setAttribute('data-reftarget', 'mock');
        
        // Add timeout to prevent hanging  
        let result: any;
        
        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Requirements check timeout')), 5000);
          });
          
          result = await Promise.race([
            checkElementRequirements(mockElement),
            timeoutPromise
          ]);
        } catch (timeoutError) {
          result = { pass: false, error: [{ requirement: requirements, error: 'Requirements check timed out' }] };
        }
        
        const errorMessage = result.pass ? undefined : result.error?.map((e: any) => e.error || e.requirement).join(', ');
        const explanation = result.pass ? undefined : getRequirementExplanation(requirements, hints, errorMessage);
        const newState = {
          ...state,
          isEnabled: result.pass,
          isChecking: false,
          error: errorMessage,
          explanation,
        };
        setState(newState);
        
        // Directly notify the manager with the new state to avoid timing issues
        if (managerRef.current) {
          managerRef.current.updateStep(uniqueId, newState);
        }
      } catch (error) {
        console.error(`Requirements check failed for ${uniqueId}:`, error);
        const errorMessage = 'Failed to check requirements';
        const explanation = getRequirementExplanation(requirements, hints, errorMessage);
        
        const newState = {
          ...state,
          isEnabled: false,
          isChecking: false,
          error: errorMessage,
          explanation,
        };
        setState(newState);
        
        // Directly notify the manager with the new state to avoid timing issues
        if (managerRef.current) {
          managerRef.current.updateStep(uniqueId, newState);
        }
      }
    })();
    
    checkPromiseRef.current = checkPromise;
    await checkPromise;
    checkPromiseRef.current = null;
  }, [requirements, targetAction, uniqueId, checkElementRequirements]); // Removed state.isCompleted to prevent infinite loops
  
  const markCompleted = useCallback(() => {
    const newState = {
      ...state,
      isCompleted: true,
      isEnabled: false, // Completed steps are disabled
    };
    setState(newState);
    
    // Directly notify the manager with the new state to avoid timing issues
    if (managerRef.current) {
      managerRef.current.updateStep(uniqueId, newState);
    }
    
    // Debug logging for completion tracking
    if (process.env.NODE_ENV === 'development') {
      console.warn(`🎯 Step ${uniqueId} marked as COMPLETED`);
    }
  }, [state, uniqueId]);
  
  const reset = useCallback(() => {
    setState({
      isEnabled: false,
      isCompleted: false,
      isChecking: false,
      hint: hints,
      explanation: requirements ? getRequirementExplanation(requirements, hints) : undefined,
    });
  }, [hints, requirements]);
  
  // Auto-retry failed requirements every 10 seconds to prevent permanent stuck state  
  useEffect(() => {
    if (!state.isCompleted && !state.isChecking && !state.isEnabled && requirements) {
      const retryTimeout = setTimeout(() => {
        checkRequirements();
      }, 10000); // 10 second auto-retry
      
      return () => clearTimeout(retryTimeout);
    }
    return undefined;
  }, [state.isCompleted, state.isChecking, state.isEnabled, requirements, uniqueId, checkRequirements]);

  return {
    ...state,
    checkRequirements,
    markCompleted,
    reset,
    triggerReactiveCheck: () => SequentialRequirementsManager.getInstance().triggerReactiveCheck(),
  };
}

/**
 * Global sequential requirements manager
 * Manages the "one step at a time" logic across all interactive elements
 */
export class SequentialRequirementsManager {
  private static instance: SequentialRequirementsManager;
  private steps = new Map<string, RequirementsState>();
  private listeners = new Set<() => void>();
  
  static getInstance(): SequentialRequirementsManager {
    if (!SequentialRequirementsManager.instance) {
      SequentialRequirementsManager.instance = new SequentialRequirementsManager();
    }
    return SequentialRequirementsManager.instance;
  }
  
  registerStep(id: string, isSequence: boolean): void {
    if (!this.steps.has(id)) {
      this.steps.set(id, {
        isEnabled: false,
        isCompleted: false,
        isChecking: false,
      });
    }
  }
  
  updateStep(id: string, state: Partial<RequirementsState>): void {
    const currentState = this.steps.get(id);
    if (currentState) {
      this.steps.set(id, { ...currentState, ...state });
      // Recalculate sequential state whenever any step changes
      this.updateSequentialState();
      this.notifyListeners();
    }
  }
  
  getStepState(id: string): RequirementsState | undefined {
    return this.steps.get(id);
  }
  
  // Sequential logic: determine which steps should be enabled
  // This method should NOT override individual step states - it's for internal calculations only
  updateSequentialState(): void {
    // This method was causing issues by overriding step states
    // The sequential logic is now handled in the individual checkRequirements calls
    // This keeps the method for future use but prevents it from conflicting with step logic
    
        
  }
  
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  // Trigger reactive checking of all steps (e.g., after completing a step or DOM changes)
  triggerReactiveCheck(): void {
    // Trigger actual requirements re-checking for all registered steps
    this.recheckAllSteps();
    // Also notify listeners for UI updates
    this.notifyListeners();
  }

  private recheckAllSteps(): void {
    // Notify all step checkers to re-run their requirements
    this.stepCheckers.forEach(checker => {
      // Trigger async recheck with minimal delay to prevent race conditions
      setTimeout(() => {
        checker();
      }, 10); // Reduced from 50ms to 10ms for faster unlocking
    });
  }

  // Registry of step checker functions for reactive re-checking
  private stepCheckers = new Set<() => void>();

  registerStepChecker(checker: () => void): () => void {
    this.stepCheckers.add(checker);
    return () => this.stepCheckers.delete(checker);
  }

  // Pure requirements-based success detection - extensible for any data-requirements
  async checkActionSuccess(
    requirements?: string,
    checkElementRequirements?: (element: HTMLElement) => Promise<any>
  ): Promise<boolean> {
    // If no requirements, assume success (steps without requirements should always work)
    if (!requirements) {
      return true;
    }

    // If we don't have the checker function, fall back to reactive checking
    if (!checkElementRequirements) {
      return false;
    }

    // Use the actual requirements checking system - this makes it fully extensible
    // Any new requirement types added to the requirements system will automatically work
    try {
      // Create a mock element with the requirements for checking
      const mockElement = document.createElement('div');
      mockElement.setAttribute('data-requirements', requirements);
      mockElement.setAttribute('data-targetaction', 'button'); // Generic action for checking
      mockElement.setAttribute('data-reftarget', 'success-check');

      // Run the actual requirements check to see if they're now satisfied
      const result = await checkElementRequirements(mockElement);
      return result.pass;
    } catch (error) {
      // If checking fails, assume the action didn't succeed
      return false;
    }
  }

  // Enhanced monitoring for reactive requirements checking
  private domObserver?: MutationObserver;
  private domCheckThrottle?: NodeJS.Timeout;
  private urlCheckThrottle?: NodeJS.Timeout;
  private lastUrl?: string;
  private navigationUnlisten?: () => void;

  startDOMMonitoring(): void {
    if (this.domObserver) return; // Already monitoring

    // Monitor URL changes for navigation detection
    this.lastUrl = window.location.href;
    this.startURLMonitoring();

    // Monitor DOM changes (more selective)
    this.domObserver = new MutationObserver((mutations) => {
      // Only react to meaningful changes
      const significantChange = mutations.some(mutation => {
        // Check for navigation menu changes, plugin list changes, etc.
        const target = mutation.target as Element;
        return target?.closest?.('[data-testid*="nav"]') || 
               target?.closest?.('[data-testid*="plugin"]') ||
               target?.closest?.('[href*="/connections"]') ||
               target?.closest?.('[href*="/dashboards"]') ||
               target?.closest?.('[href*="/admin"]');
      });

      if (significantChange) {
        if (this.domCheckThrottle) clearTimeout(this.domCheckThrottle);
        this.domCheckThrottle = setTimeout(() => {
          this.triggerReactiveCheck();
        }, 800); // Shorter delay for DOM changes
      }
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'aria-label', 'class', 'href']
    });
  }

  private startURLMonitoring(): void {
    // Monitor for URL changes (navigation)
    const checkURL = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        this.lastUrl = currentUrl;
        
        // Debounce URL change checks - wait for page to settle
        if (this.urlCheckThrottle) clearTimeout(this.urlCheckThrottle);
        this.urlCheckThrottle = setTimeout(() => {
          this.triggerReactiveCheck();
        }, 1500); // Reduced delay for faster responsiveness
      }
    };

    // Listen for various navigation events
    window.addEventListener('popstate', checkURL);
    window.addEventListener('hashchange', checkURL);
    
    // Poll for programmatic navigation (SPA routing)
    const urlPoller = setInterval(checkURL, 500); // More frequent polling for SPA
    
    this.navigationUnlisten = () => {
      window.removeEventListener('popstate', checkURL);
      window.removeEventListener('hashchange', checkURL);
      clearInterval(urlPoller);
    };
  }

  stopDOMMonitoring(): void {
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = undefined;
    }
    if (this.domCheckThrottle) {
      clearTimeout(this.domCheckThrottle);
      this.domCheckThrottle = undefined;
    }
    if (this.urlCheckThrottle) {
      clearTimeout(this.urlCheckThrottle);
      this.urlCheckThrottle = undefined;
    }
    if (this.navigationUnlisten) {
      this.navigationUnlisten();
      this.navigationUnlisten = undefined;
    }
  }
  
  // Debug helpers
  logCurrentState(): void {
    console.log('📊 Sequential Requirements State:', {
      totalSteps: this.steps.size,
      steps: Array.from(this.steps.entries()).map(([id, state]) => ({
        id,
        type: id.startsWith('section-') ? 'section' : 'regular',
        enabled: state.isEnabled,
        completed: state.isCompleted,
        checking: state.isChecking,
      })),
    });
  }
}

/**
 * Hook for managing sequential requirements across all steps
 * This provides the global "one step at a time" logic
 */
export function useSequentialRequirements({
  requirements,
  hints,
  stepId,
  sectionId,
  targetAction,
  isSequence = false,
}: UseRequirementsCheckerProps): UseRequirementsCheckerReturn {
  const uniqueId = sectionId ? `section-${sectionId}` : stepId ? `step-${stepId}` : `fallback-${Date.now()}`;
  const manager = SequentialRequirementsManager.getInstance();
  const basicChecker = useRequirementsChecker({ requirements, hints, stepId, sectionId, targetAction, isSequence });
  
  // Local state to force re-renders when manager state changes
  const [, forceUpdate] = useState({});
  
  // Register this step with the manager
  useEffect(() => {
    manager.registerStep(uniqueId, isSequence);
    return () => {
      // Cleanup could be added here if needed
    };
  }, [uniqueId, isSequence, manager]);
  
  // Subscribe to global state changes with debouncing to prevent infinite loops
  useEffect(() => {
    let timeoutId: number | null = null;
    
    const unsubscribe = manager.subscribe(() => {
      // Debounce the re-render to prevent rapid-fire updates
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      
      timeoutId = window.setTimeout(() => {
        forceUpdate({});
        timeoutId = null;
      }, 25); // Reduced debounce for faster UI updates
    });
    
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
    };
  }, [uniqueId]); // Use uniqueId instead of manager to prevent subscription loops
  
  // Enhanced check that considers sequential state
  const checkRequirements = useCallback(async () => {
    // If this step is already completed, don't re-evaluate it - preserve completion state
    if (basicChecker.isCompleted) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`⏭️ Step ${uniqueId} skipped re-evaluation (already completed)`);
      }
      return;
    }

    // Section steps always get Trust but Verify (they are independent)
    if (isSequence) {
      await basicChecker.checkRequirements();
      return;
    }
    
    // For regular steps, determine sequential position using simple ID sorting
    // Now that we have predictable step IDs (step-1, step-2, etc.), sorting works properly
    const regularSteps = Array.from(manager['steps'].entries())
      .filter(([id]) => !id.startsWith('section-'))
      .sort(([a], [b]) => {
        // Extract step numbers for proper numerical sorting
        const aNum = parseInt(a.replace('step-', ''), 10);
        const bNum = parseInt(b.replace('step-', ''), 10);
        return aNum - bNum;
      });
    
    const currentIndex = regularSteps.findIndex(([id]) => id === uniqueId);
    
    // Check if this is the first regular step OR all previous steps are completed
    const isFirstStep = currentIndex === 0;
    const allPreviousCompleted = currentIndex > 0 && regularSteps
      .slice(0, currentIndex)
      .every(([, state]) => state.isCompleted);
    
    if (isFirstStep || allPreviousCompleted) {
      // This step can be enabled - check its actual requirements
      await basicChecker.checkRequirements();
      // The basicChecker will update the manager with the actual requirement results
    } else {
      // This step should be disabled due to sequential dependency
      const sequentialError = 'Previous steps must be completed first';
      const sequentialExplanation = 'Complete the previous steps in order before this one becomes available.';

      manager.updateStep(uniqueId, {
        isEnabled: false,
        isCompleted: basicChecker.isCompleted,
        isChecking: false,
        error: sequentialError,
        explanation: sequentialExplanation,
      });
    }
    
    // Don't call updateSequentialState here as it triggers listeners
    // The state is already updated via manager.updateStep above
  }, [basicChecker, manager, uniqueId, isSequence]);

  // Register the checkRequirements function for reactive re-checking
  useEffect(() => {
    const unregisterChecker = manager.registerStepChecker(() => {
      checkRequirements();
    });
    
    return () => {
      unregisterChecker();
    };
  }, [manager, checkRequirements]);
  
  const markCompleted = useCallback(() => {
    // Just delegate to the basic checker - it will update the manager directly
    basicChecker.markCompleted();
  }, [basicChecker]);
  
  // Get current state from manager (which includes sequential logic)
  const managerState = manager.getStepState(uniqueId);
  const currentState = managerState || basicChecker;
  
  // Debug the final state being returned to components (reduced logging)
  if (process.env.NODE_ENV === 'development' && Math.random() < 0.05) {
    console.warn(`🏁 Final state sample for ${uniqueId.substring(0, 20)}...:`, {
      enabled: currentState.isEnabled,
      completed: currentState.isCompleted,
      checking: currentState.isChecking,
      hasError: !!currentState.error
    });
  }
  
  return {
    ...currentState,
    checkRequirements,
    markCompleted,
    reset: basicChecker.reset,
    triggerReactiveCheck: () => manager.triggerReactiveCheck(),
  };
} 

/**
 * Map common data-requirements to user-friendly explanatory messages
 * These serve as fallback messages when data-hint is not provided
 */
function mapRequirementToUserFriendlyMessage(requirement: string): string {
  const requirementMappings: Record<string, string> = {
    // Navigation requirements
    'navmenu-open': 'The navigation menu needs to be open. Look for the menu icon (☰) in the top-left corner.',
    'navmenu-closed': 'Please close the navigation menu first.',
    
    // Authentication requirements  
    'is-admin': 'You need administrator privileges to perform this action. Please log in as an admin user.',
    'is-logged-in': 'You need to be logged in to continue. Please sign in to your Grafana account.',
    'is-editor': 'You need editor permissions or higher to perform this action.',
    
    // Plugin requirements
    'has-plugin': 'A required plugin needs to be installed first.',
    'plugin-enabled': 'The required plugin needs to be enabled in your Grafana instance.',
    
    // Dashboard requirements
    'dashboard-exists': 'A dashboard needs to be created or selected first.',
    'dashboard-edit-mode': 'The dashboard needs to be in edit mode. Look for the "Edit" button.',
    'panel-selected': 'Please select or create a panel first.',
    
    // Data source requirements
    'datasource-configured': 'A data source needs to be configured first.',
    'datasource-connected': 'Please ensure the data source connection is working.',
    'has-datasources': 'At least one data source needs to be configured.',
    
    // Page/URL requirements
    'on-page': 'Navigate to the correct page first.',
    'correct-url': 'You need to be on the right page to continue.',
    
    // Form requirements
    'form-valid': 'Please fill out all required form fields correctly.',
    'field-focused': 'Click on the specified form field first.',
    
    // General state requirements
    'element-visible': 'The required element needs to be visible on the page.',
    'element-enabled': 'The required element needs to be available for interaction.',
    'modal-open': 'A dialog or modal window needs to be open.',
    'modal-closed': 'Please close any open dialogs first.',
  };
  
  // Enhanced requirement type handling
  const enhancedMappings: Array<{pattern: RegExp, message: (match: string) => string}> = [
    {
      pattern: /^has-permission:(.+)$/,
      message: (permission) => `You need the '${permission}' permission to perform this action.`
    },
    {
      pattern: /^has-role:(.+)$/,
      message: (role) => `You need ${role} role or higher to perform this action.`
    },
    {
      pattern: /^has-datasource:type:(.+)$/,
      message: (type) => `A ${type} data source needs to be configured first.`
    },
    {
      pattern: /^has-datasource:(.+)$/,
      message: (name) => `The '${name}' data source needs to be configured first.`
    },
    {
      pattern: /^has-plugin:(.+)$/,
      message: (plugin) => `The '${plugin}' plugin needs to be installed and enabled.`
    },
    {
      pattern: /^on-page:(.+)$/,
      message: (page) => `Navigate to the '${page}' page first.`
    },
    {
      pattern: /^has-feature:(.+)$/,
      message: (feature) => `The '${feature}' feature needs to be enabled.`
    },
    {
      pattern: /^in-environment:(.+)$/,
      message: (env) => `This action is only available in the ${env} environment.`
    },
    {
      pattern: /^min-version:(.+)$/,
      message: (version) => `This feature requires Grafana version ${version} or higher.`
    }
  ];
  
  // Check enhanced pattern-based requirements first
  for (const mapping of enhancedMappings) {
    const match = requirement.match(mapping.pattern);
    if (match) {
      return mapping.message(match[1]);
    }
  }

  // Handle plugin-specific requirements (e.g., "require-has-plugin="volkovlabs-rss-datasource")
  if (requirement.includes('has-plugin') || requirement.includes('plugin')) {
    const pluginMatch = requirement.match(/['"]([\w-]+)['"]/);
    if (pluginMatch) {
      const pluginName = pluginMatch[1];
      return `The "${pluginName}" plugin needs to be installed and enabled first.`;
    }
    return requirementMappings['has-plugin'] || 'A required plugin needs to be installed first.';
  }
  
  // Direct mapping lookup
  if (requirementMappings[requirement]) {
    return requirementMappings[requirement];
  }
  
  // Partial matching for compound requirements
  for (const [key, message] of Object.entries(requirementMappings)) {
    if (requirement.includes(key)) {
      return message;
    }
  }
  
  // Fallback to a generic but helpful message
  return `Requirement "${requirement}" needs to be satisfied. Check the page state and try again.`;
}

/**
 * Get user-friendly explanation for why requirements aren't met
 * Prioritizes data-hint over mapped requirement messages
 */
function getRequirementExplanation(requirements?: string, hints?: string, error?: string): string {
  // Priority 1: Use data-hint if provided
  if (hints && hints.trim()) {
    return hints.trim();
  }
  
  // Priority 2: Map data-requirements to user-friendly message
  if (requirements && requirements.trim()) {
    return mapRequirementToUserFriendlyMessage(requirements.trim());
  }
  
  // Priority 3: Use error message if available
  if (error && error.trim()) {
    return error.trim();
  }
  
  // Fallback
  return 'Requirements not met. Please check the page state and try again.';
} 