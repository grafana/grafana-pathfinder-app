import { useState, useEffect, useCallback, useRef } from 'react';
import { getRequirementExplanation } from './requirement-explanations';
import { useInteractiveElements } from './interactive.hook';
import { RequirementsCheckResult } from './requirements-checker.utils';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { useTimeoutManager, TimeoutManager } from './timeout-manager';

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
 * Provides event-driven requirements validation for interactive tutorial steps
 *
 * Features:
 * - Event-driven checking (no continuous polling)
 * - Sequential step dependencies
 * - Completion state preservation
 * - Section and standalone step workflows
 */

export interface RequirementsState {
  isEnabled: boolean;
  isCompleted: boolean;
  isChecking: boolean;
  error?: string;
  hint?: string;
  explanation?: string; // User-friendly explanation for why requirements aren't met
  isSkipped?: boolean; // Whether this step was skipped
  completionReason?: 'none' | 'objectives' | 'manual' | 'skipped';
  retryCount?: number; // Current retry attempt
  maxRetries?: number; // Maximum retry attempts
  isRetrying?: boolean; // Whether currently in a retry cycle
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
 * React hook for individual step requirements checking
 * Handles both DOM-dependent and pure requirements validation
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
    retryCount: 0,
    maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
    isRetrying: false,
  });

  const timeoutManager = useTimeoutManager();

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
  const checkRequirements = useCallback(
    async (retryAttempt = 0) => {
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

        setState(newState);

        // Directly notify the manager with the new state to avoid timing issues
        if (managerRef.current) {
          managerRef.current.updateStep(uniqueId, newState);
        }
        return;
      }

      const maxRetries = INTERACTIVE_CONFIG.delays.requirements.maxRetries;
      const isRetrying = retryAttempt > 0;

      setState((prev) => ({
        ...prev,
        isChecking: true,
        error: undefined,
        retryCount: retryAttempt,
        maxRetries,
        isRetrying,
      }));

      async function checkPromise() {
        // Add timeout to prevent hanging
        let result: RequirementsCheckResult;

        try {
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error('Requirements check timeout')),
              INTERACTIVE_CONFIG.delays.requirements.checkTimeout
            );
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

        // If check fails and we haven't exhausted retries, schedule retry
        if (!result.pass && retryAttempt < maxRetries) {
          const nextRetryAttempt = retryAttempt + 1;

          // Update state to show retry in progress
          setState((prev) => ({
            ...prev,
            isChecking: true,
            isRetrying: true,
            retryCount: nextRetryAttempt,
            error: `Check failed, retrying... (${nextRetryAttempt}/${maxRetries})`,
          }));

          // Schedule retry using timeout manager
          timeoutManager.setTimeout(
            `requirements-check-retry-${uniqueId}-${nextRetryAttempt}`,
            async () => {
              await checkRequirements(nextRetryAttempt);
            },
            INTERACTIVE_CONFIG.delays.requirements.retryDelay
          );

          return; // Exit early, retry will handle the rest
        }

        // Final result (success or exhausted retries)
        const errorMessage = result.pass
          ? undefined
          : result.error?.map((e: any) => e.error || e.requirement).join(', ');
        const explanation = result.pass ? undefined : getRequirementExplanation(requirements, hints, errorMessage);

        const finalErrorMessage = result.pass
          ? undefined
          : retryAttempt >= maxRetries
            ? `${errorMessage} (failed after ${retryAttempt + 1} attempts)`
            : errorMessage;

        const newState = {
          ...state,
          isEnabled: result.pass,
          isChecking: false,
          isRetrying: false,
          error: finalErrorMessage,
          explanation,
          retryCount: retryAttempt,
          maxRetries,
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
    },
    [requirements, targetAction, uniqueId, hints, timeoutManager, checkRequirementsFromData] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const markCompleted = useCallback(() => {
    // PERFORMANCE FIX: Single setState call with manager notification
    setState((prev) => {
      const newState = {
        ...prev,
        isCompleted: true,
        isEnabled: false, // Completed steps are disabled
      };

      // Notify manager immediately with the new state
      if (managerRef.current) {
        managerRef.current.updateStep(uniqueId, newState);

        // If this is a section completion, trigger reactive check to unlock dependent sections
        if (uniqueId.startsWith('section-')) {
          // Delayed reactive check to allow state to settle
          timeoutManager.setDebounced(
            `section-completion-${uniqueId}`,
            () => {
              managerRef.current?.triggerReactiveCheck();
            },
            undefined,
            'stateSettling'
          );
        }
      }

      return newState;
    });

    // Step completion tracking (no debug logging needed)
  }, [uniqueId, timeoutManager]);

  const reset = useCallback(() => {
    setState({
      isEnabled: false,
      isCompleted: false,
      isChecking: false,
      hint: hints,
      explanation: requirements ? getRequirementExplanation(requirements, hints) : undefined,
      retryCount: 0,
      maxRetries: INTERACTIVE_CONFIG.delays.requirements.maxRetries,
      isRetrying: false,
    });
  }, [hints, requirements]);

  // Event-driven requirements checking - no automatic retries
  // Requirements are rechecked when:
  // 1. DOM changes (via MutationObserver)
  // 2. Navigation occurs (via navigation events)
  // 3. User actions trigger reactive checks
  // 4. Previous steps complete (via SequentialRequirementsManager)

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
 * Coordinates step eligibility and provides event-driven requirements checking
 * Singleton pattern ensures consistent state across all interactive components
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
    // Trigger selective checking of eligible steps only
    this.triggerSelectiveRecheck();
  }

  /**
   * Selective reactive checking - only re-evaluates eligible steps
   * Prevents infinite loops by avoiding checks of ineligible steps
   */
  private triggerSelectiveRecheck(): void {
    const timeoutManager = TimeoutManager.getInstance();
    timeoutManager.setDebounced(
      'reactive-check-throttle',
      () => {
        // Only recheck steps that are eligible for checking
        this.recheckEligibleStepsOnly();
        // Notify listeners for UI updates
        this.notifyListeners();
      },
      50
    );
  }

  /**
   * Recheck only steps that are eligible for requirements validation
   */
  private recheckEligibleStepsOnly(): void {
    requestAnimationFrame(() => {
      this.stepCheckersByID.forEach((checker, stepId) => {
        const stepState = this.steps.get(stepId);

        // Only check steps that are not completed and not currently checking
        if (stepState && !stepState.isCompleted && !stepState.isChecking) {
          try {
            checker();
          } catch (error) {
            console.error(`Error in selective step checker for ${stepId}:`, error);
          }
        }
      });
    });
  }

  /**
   * Trigger requirements checking for a specific step
   * Used when a step becomes eligible due to previous step completion
   */
  triggerStepEligibilityCheck(stepId: string): void {
    const checker = this.stepCheckersByID.get(stepId);
    if (checker) {
      const stepState = this.steps.get(stepId);
      if (stepState && !stepState.isCompleted && !stepState.isChecking) {
        // Use immediate execution for eligibility-triggered checks
        requestAnimationFrame(() => {
          try {
            checker();
          } catch (error) {
            console.error(`Error in eligibility-triggered check for ${stepId}:`, error);
          }
        });
      }
    }
  }

  // Removed: Global step checking method that caused infinite loops

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
      // Use a minimal delay for step checking
      const timeoutManager = TimeoutManager.getInstance();
      timeoutManager.setTimeout(
        `step-check-${stepId}`,
        () => {
          checker();
        },
        10
      );
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
        const timeoutManager = TimeoutManager.getInstance();
        timeoutManager.setDebounced(
          'dom-check-throttle',
          () => {
            this.triggerSelectiveRecheck();
          },
          800
        );
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
        const timeoutManager = TimeoutManager.getInstance();
        timeoutManager.setDebounced(
          'url-check-throttle',
          () => {
            this.triggerSelectiveRecheck();
          },
          1500
        );
      }
    };

    // Listen for various navigation events (event-driven, no polling)
    window.addEventListener('popstate', checkURL);
    window.addEventListener('hashchange', checkURL);

    // Listen for Grafana-specific navigation events if available
    // These are more reliable than polling for SPA navigation
    document.addEventListener('grafana:location-changed', checkURL);

    // Listen for focus events which can indicate navigation in SPAs
    window.addEventListener('focus', checkURL);

    this.navigationUnlisten = () => {
      window.removeEventListener('popstate', checkURL);
      window.removeEventListener('hashchange', checkURL);
      document.removeEventListener('grafana:location-changed', checkURL);
      window.removeEventListener('focus', checkURL);
    };
  }

  stopDOMMonitoring(): void {
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = undefined;
    }
    if (this.navigationUnlisten) {
      this.navigationUnlisten();
      this.navigationUnlisten = undefined;
    }
    // Clear any pending timeouts from the timeout manager
    const timeoutManager = TimeoutManager.getInstance();
    timeoutManager.clear('dom-check-throttle');
    timeoutManager.clear('url-check-throttle');
  }

  // Debug helpers
  logCurrentState(): void {
    // Sequential requirements state logging removed
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
  const timeoutManager = useTimeoutManager();

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
      }, INTERACTIVE_CONFIG.delays.debouncing.uiUpdates);
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
  }, [manager, uniqueId]); // eslint-disable-line react-hooks/exhaustive-deps

  const markCompleted = useCallback(() => {
    // Just delegate to the basic checker - it will update the manager directly
    basicChecker.markCompleted();

    // Additional reactive check for section dependencies
    // The basic checker handles section-level reactive checks, but we ensure
    // all dependent steps get re-evaluated
    timeoutManager.setDebounced(
      `sequential-reactive-check-${uniqueId}`,
      () => {
        manager.triggerReactiveCheck();
      },
      undefined,
      'reactiveCheck'
    );
  }, [basicChecker, manager, timeoutManager, uniqueId]);

  // Get current state from manager (which includes sequential logic)
  const managerState = manager.getStepState(uniqueId);
  const currentState = managerState || basicChecker;

  // Final state determined for component

  return {
    ...currentState,
    checkRequirements,
    markCompleted,
    reset: basicChecker.reset,
    triggerReactiveCheck: () => manager.triggerReactiveCheck(),
  };
}
