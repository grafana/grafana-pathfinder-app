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
  private navClickListener?: (e: Event) => void;

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
        const target = mutation.target as Element;

        // Expanded navigation-related selectors to better detect nav open/close/dock
        const isNavRelated =
          target?.closest?.('div[data-testid*="navigation"]') ||
          target?.closest?.('nav[aria-label*="Navigation"]') ||
          target?.closest?.('ul[aria-label*="Navigation"]') ||
          target?.closest?.('ul[aria-label*="Main navigation"]') ||
          target?.closest?.('[role="navigation"]');

        const isKnownHotspot =
          target?.closest?.('[data-testid*="nav"]') ||
          target?.closest?.('[data-testid*="plugin"]') ||
          target?.closest?.('[href*="/connections"]') ||
          target?.closest?.('[href*="/dashboards"]') ||
          target?.closest?.('[href*="/admin"]');

        // Attribute flips commonly used for nav expansion/collapse
        const attrFlip =
          (mutation.type === 'attributes' &&
            (mutation.attributeName === 'aria-expanded' ||
              mutation.attributeName === 'class' ||
              mutation.attributeName === 'data-testid' ||
              mutation.attributeName === 'aria-label')) ||
          false;

        return Boolean(isNavRelated || isKnownHotspot || attrFlip);
      });

      if (significantChange) {
        const timeoutManager = TimeoutManager.getInstance();
        timeoutManager.setDebounced(
          'dom-check-throttle',
          () => {
            this.triggerSelectiveRecheck();
          },
          1200 // Increased from 800ms to 1200ms to allow more DOM settling time
        );
      }
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-testid', 'aria-label', 'class', 'href', 'aria-expanded', 'role'],
    });

    // Add lightweight click listener to capture nav toggle interactions
    this.navClickListener = () => {
      const timeoutManager = TimeoutManager.getInstance();
      timeoutManager.setDebounced('nav-click-recheck', () => this.triggerSelectiveRecheck(), 500, 'reactiveCheck');
    };
    document.addEventListener('click', this.navClickListener, { capture: true });
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
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = undefined;
    }
    if (this.navigationUnlisten) {
      this.navigationUnlisten();
      this.navigationUnlisten = undefined;
    }
    // Remove click listener
    if (this.navClickListener) {
      document.removeEventListener('click', this.navClickListener, { capture: true } as any);
      this.navClickListener = undefined;
    }
    // Clear any pending timeouts from the timeout manager
    const timeoutManager = TimeoutManager.getInstance();
    timeoutManager.clear('dom-check-throttle');
    timeoutManager.clear('url-check-throttle');
    timeoutManager.clear('nav-click-recheck');
  }
}
