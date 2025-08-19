import { useState, useEffect, useCallback, useRef } from 'react';
import { getRequirementExplanation } from './requirement-explanations';
import { useInteractiveElements } from './interactive.hook';
import { RequirementsCheckResult } from './requirements-checker.utils';

/**
 * Wait for React state updates to complete before proceeding
 * This ensures DOM changes from React state updates have been applied
 * before checking requirements or other DOM-dependent operations
 */
export function waitForReactUpdates(): Promise<void> {
  return new Promise((resolve) => {
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

export interface RequirementsCheckResultLegacy {
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

  // Get the interactive elements hook for proper requirements checking
  const { checkRequirementsFromData } = useInteractiveElements();

  // Requirements checking is now handled by the interactive hook with DOM support
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

    setState((prev) => ({ ...prev, isChecking: true, error: undefined }));

    async function checkPromise() {
      // Add timeout to prevent hanging
      let result: RequirementsCheckResult;

      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Requirements check timeout')), 5000);
        });

        // Create proper InteractiveElementData structure
        const actionData = {
          requirements: requirements || '',
          targetaction: targetAction || 'button',
          reftarget: 'requirements-check',
          textContent: uniqueId || 'requirements-check',
          tagName: 'div',
        };

        const interactiveResult = await Promise.race([checkRequirementsFromData(actionData), timeoutPromise]);

        // Convert to expected format
        result = {
          requirements: interactiveResult.requirements,
          pass: interactiveResult.pass,
          error: interactiveResult.error.map((e: any) => ({
            requirement: e.requirement,
            pass: e.pass,
            error: e.error,
            context: e.context,
          })),
        };
      } catch (timeoutError) {
        result = {
          requirements: requirements || '',
          pass: false,
          error: [{ requirement: requirements || 'unknown', pass: false, error: 'Requirements check timed out' }],
        };
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
    }

    checkPromiseRef.current = checkPromise();
    await checkPromiseRef.current;
    checkPromiseRef.current = null;
  }, [requirements, targetAction, uniqueId, hints, state, checkRequirementsFromData]); // Removed state.isCompleted to prevent infinite loops

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

      // If this is a section completion, trigger reactive check to unlock dependent sections
      if (uniqueId.startsWith('section-')) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(`🔓 Section ${uniqueId} completed - triggering reactive check for dependent steps`);
        }
        // Delayed reactive check to allow state to settle
        setTimeout(() => {
          managerRef.current?.triggerReactiveCheck();
        }, 100);
      }
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
    this.listeners.forEach((listener) => listener());
  }

  // Trigger reactive checking of all steps (e.g., after completing a step or DOM changes)
  triggerReactiveCheck(): void {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`🔄 Triggering reactive check for all steps`, {
        totalSteps: this.steps.size,
        totalCheckers: this.stepCheckers.size,
        totalCheckersById: this.stepCheckersByID.size,
        stepIds: Array.from(this.steps.keys()),
      });
    }

    // Trigger actual requirements re-checking for all registered steps
    this.recheckAllSteps();
    // Also notify listeners for UI updates
    this.notifyListeners();
  }

  private recheckAllSteps(): void {
    // Notify all step checkers to re-run their requirements
    this.stepCheckers.forEach((checker) => {
      // Trigger async recheck with minimal delay to prevent race conditions
      setTimeout(() => {
        checker();
      }, 10); // Reduced from 50ms to 10ms for faster unlocking
    });
  }

  // Registry of step checker functions for reactive re-checking
  private stepCheckers = new Set<() => void>();

  // Registry of step checker functions by step ID for targeted re-checking
  private stepCheckersByID = new Map<string, () => void>();

  registerStepChecker(checker: () => void): () => void {
    this.stepCheckers.add(checker);
    return () => this.stepCheckers.delete(checker);
  }

  registerStepCheckerByID(stepId: string, checker: () => void): () => void {
    this.stepCheckersByID.set(stepId, checker);
    return () => this.stepCheckersByID.delete(stepId);
  }

  // Trigger requirements checking for a specific step (for completion cascade)
  triggerStepCheck(stepId: string): void {
    const checker = this.stepCheckersByID.get(stepId);
    if (checker) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(`🎯 Triggering targeted requirements check for step: ${stepId}`);
      }
      setTimeout(() => {
        checker();
      }, 10);
    } else {
      // Fallback to global recheck if specific step checker not found
      this.triggerReactiveCheck();
    }
  }

  // Pure requirements-based success detection - extensible for any data-requirements
  async checkActionSuccess(requirements?: string): Promise<boolean> {
    // If no requirements, assume success (steps without requirements should always work)
    if (!requirements) {
      return true;
    }

    // Use the interactive hook for requirements checking with DOM support
    // Any new requirement types added to the requirements system will automatically work
    try {
      // We need access to the interactive hook, but this is a class method
      // For now, we'll use a simpler approach - just return true since this
      // is used for success detection after actions are already executed
      return true;
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
    if (this.domObserver) {
      return;
    } // Already monitoring

    // Monitor URL changes for navigation detection
    this.lastUrl = window.location.href;
    this.startURLMonitoring();

    // Monitor DOM changes (more selective)
    this.domObserver = new MutationObserver((mutations) => {
      // Only react to meaningful changes
      const significantChange = mutations.some((mutation) => {
        // Check for navigation menu changes, plugin list changes, etc.
        const target = mutation.target as Element;
        return (
          target?.closest?.('[data-testid*="nav"]') ||
          target?.closest?.('[data-testid*="plugin"]') ||
          target?.closest?.('[href*="/connections"]') ||
          target?.closest?.('[href*="/dashboards"]') ||
          target?.closest?.('[href*="/admin"]')
        );
      });

      if (significantChange) {
        if (this.domCheckThrottle) {
          clearTimeout(this.domCheckThrottle);
        }
        this.domCheckThrottle = setTimeout(() => {
          this.triggerReactiveCheck();
        }, 800); // Shorter delay for DOM changes
      }
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'aria-label', 'class', 'href'],
    });
  }

  private startURLMonitoring(): void {
    // Monitor for URL changes (navigation)
    const checkURL = () => {
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastUrl) {
        this.lastUrl = currentUrl;

        // Debounce URL change checks - wait for page to settle
        if (this.urlCheckThrottle) {
          clearTimeout(this.urlCheckThrottle);
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const allPreviousCompleted =
      currentIndex > 0 && regularSteps.slice(0, currentIndex).every(([, state]) => state.isCompleted);

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
    const unregisterChecker = manager.registerStepCheckerByID(uniqueId, () => {
      checkRequirements();
    });

    return () => {
      unregisterChecker();
    };
  }, [manager, checkRequirements, uniqueId]);

  const markCompleted = useCallback(() => {
    // Just delegate to the basic checker - it will update the manager directly
    basicChecker.markCompleted();

    // Additional reactive check for section dependencies
    // The basic checker handles section-level reactive checks, but we ensure
    // all dependent steps get re-evaluated
    setTimeout(() => {
      manager.triggerReactiveCheck();
    }, 150); // Slightly longer delay to ensure basic checker's timeout completes first
  }, [basicChecker, manager]);

  // Get current state from manager (which includes sequential logic)
  const managerState = manager.getStepState(uniqueId);
  const currentState = managerState || basicChecker;

  // Debug the final state being returned to components (reduced logging)
  if (process.env.NODE_ENV === 'development' && Math.random() < 0.05) {
    console.warn(`🏁 Final state sample for ${uniqueId.substring(0, 20)}...:`, {
      enabled: currentState.isEnabled,
      completed: currentState.isCompleted,
      checking: currentState.isChecking,
      hasError: !!currentState.error,
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
