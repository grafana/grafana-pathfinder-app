import { TimeoutManager } from '../utils/timeout-manager';

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
 * Provides event-driven requirements validation for interactive guide steps
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

/**
 * Global sequential requirements manager
 * Coordinates step eligibility and provides event-driven requirements checking
 * Singleton pattern ensures consistent state across all interactive components
 */
export class SequentialRequirementsManager {
  private static instance: SequentialRequirementsManager;
  private steps = new Map<string, RequirementsState>();
  private listeners = new Set<() => void>();
  private lastContextChangeTime = 0;
  private contextDebounceDelay = 500; // ms - increased to handle multiple rapid EchoSrv events
  private contextChangeUnsubscribe?: () => void;

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
      this.notifyListeners();
    }
  }

  getStepState(id: string): RequirementsState | undefined {
    return this.steps.get(id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Get immutable snapshot for useSyncExternalStore
   * Returns a new Map to ensure referential equality changes trigger React updates
   */
  getSnapshot(): Map<string, RequirementsState> {
    return new Map(this.steps);
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
   * Adds DOM settling delay to prevent false failures when steps just became enabled
   */
  private recheckEligibleStepsOnly(): void {
    requestAnimationFrame(() => {
      this.stepCheckersByID.forEach((checker, stepId) => {
        const stepState = this.steps.get(stepId);

        // Only check steps that are not completed and not currently checking
        if (stepState && !stepState.isCompleted && !stepState.isChecking) {
          // Add delay to let DOM settle before rechecking
          // This prevents false failures when steps just transitioned to enabled
          setTimeout(() => {
            try {
              checker();
            } catch (error) {
              console.error(`Error in selective step checker for ${stepId}:`, error);
            }
          }, 300); // Wait for DOM to settle after state changes
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

  /**
   * Recheck the next incomplete step (triggered by context changes)
   * Simple heuristic: find first non-completed step and recheck it
   */
  recheckNextSteps(): void {
    const now = Date.now();

    // Debounce: ignore rapid-fire context changes
    if (now - this.lastContextChangeTime < this.contextDebounceDelay) {
      return;
    }

    this.lastContextChangeTime = now;

    // Find all incomplete steps that aren't currently checking
    const eligibleSteps: string[] = [];

    for (const [stepId, state] of this.steps.entries()) {
      if (!state.isCompleted && !state.isChecking) {
        eligibleSteps.push(stepId);
      }
    }

    if (eligibleSteps.length === 0) {
      return;
    }

    // Trigger checkers for eligible steps
    // Let the checker itself decide if it's truly eligible (handles sequential dependencies)
    const timeoutManager = TimeoutManager.getInstance();
    timeoutManager.setDebounced(
      'context-recheck',
      () => {
        eligibleSteps.forEach((stepId) => {
          const checker = this.stepCheckersByID.get(stepId);
          if (checker) {
            try {
              checker();
            } catch (error) {
              console.error(`Error in context-triggered check for ${stepId}:`, error);
            }
          }
        });
      },
      50 // Small delay for React to settle
    );
  }

  /**
   * Start listening to context changes from ContextService
   */
  startContextMonitoring(): void {
    if (this.contextChangeUnsubscribe) {
      return; // Already monitoring
    }

    // Import dynamically to avoid circular deps
    import('../context-engine')
      .then(({ ContextService }) => {
        this.contextChangeUnsubscribe = ContextService.onContextChange(() => {
          this.recheckNextSteps();
        });
      })
      .catch((error) => {
        console.error('Failed to start context monitoring:', error);
      });
  }

  /**
   * Stop listening to context changes
   */
  stopContextMonitoring(): void {
    if (this.contextChangeUnsubscribe) {
      this.contextChangeUnsubscribe();
      this.contextChangeUnsubscribe = undefined;
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

    // Start context monitoring (lightweight EchoSrv listener)
    this.startContextMonitoring();

    // Monitor URL changes for navigation detection
    this.lastUrl = window.location.href;
    this.startURLMonitoring();

    // Keep minimal DOM observer for edge cases
    // Remove nav-specific filters since context monitoring handles it
    this.domObserver = new MutationObserver((mutations) => {
      // Only react to meaningful changes
      const significantChange = mutations.some((mutation) => {
        const target = mutation.target as Element;

        // Only watch for plugin/datasource related changes (not nav)
        const isKnownHotspot =
          target?.closest?.('[data-testid*="plugin"]') || target?.closest?.('[data-testid*="datasource"]');

        return Boolean(isKnownHotspot);
      });

      if (significantChange) {
        const timeoutManager = TimeoutManager.getInstance();
        timeoutManager.setDebounced(
          'dom-check-throttle',
          () => {
            this.triggerSelectiveRecheck();
          },
          1200
        );
      }
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'class'],
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
          2000 // Increased from 1500ms to 2000ms for better settling
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
    // Stop context monitoring
    this.stopContextMonitoring();

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
    timeoutManager.clear('context-recheck');
  }
}
