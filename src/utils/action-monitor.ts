/**
 * Global action monitoring system for auto-detection of user interactions
 *
 * Implements a singleton pattern to manage DOM event listeners centrally.
 * Detects user actions and emits custom events that components can subscribe to
 * for automatic step completion detection.
 *
 * NOTE: This feature is disabled by default (opt-in). Users must enable it in
 * Plugin Configuration > Interactive Features tab.
 *
 * @module action-monitor
 */

import { detectActionType, shouldCaptureElement } from './action-detector';
import type { DetectedActionEvent } from './action-matcher';

/**
 * Default debounce delay for action detection (ms)
 * This prevents rapid-fire event emissions from user interactions
 */
const DEFAULT_DEBOUNCE_DELAY = 100;

/**
 * DOM event types to monitor for user actions
 */
const MONITORED_EVENT_TYPES = ['click', 'input', 'change', 'mouseenter'] as const;

/**
 * Singleton class for monitoring user actions across the application
 *
 * Registers global DOM event listeners and emits 'user-action-detected' custom
 * events when relevant user interactions occur.
 *
 * Features:
 * - Single instance pattern (singleton)
 * - Enable/disable monitoring for section execution control
 * - Automatic event listener cleanup
 * - Debounced action detection
 * - Filtered event capture (excludes debug panels, etc.)
 *
 * @example
 * ```typescript
 * const monitor = ActionMonitor.getInstance();
 *
 * // Start monitoring
 * monitor.enable();
 *
 * // Listen for detected actions
 * document.addEventListener('user-action-detected', (event: CustomEvent) => {
 *   console.log('User action:', event.detail);
 * });
 *
 * // Temporarily disable during section execution
 * monitor.disable();
 *
 * // Re-enable after section completes
 * monitor.enable();
 * ```
 */
export class ActionMonitor {
  private static instance: ActionMonitor | null = null;

  private enabled = false;
  private listeners = new Map<string, EventListener>();
  private debounceTimers = new Map<string, number>();

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ActionMonitor {
    if (!ActionMonitor.instance) {
      ActionMonitor.instance = new ActionMonitor();
    }
    return ActionMonitor.instance;
  }

  /**
   * Enable action monitoring
   *
   * Registers global DOM event listeners for user interactions.
   * Safe to call multiple times (idempotent).
   *
   * Note: The caller (InteractiveSection) should check the plugin config
   * before calling this method to respect user preferences.
   */
  enable(): void {
    if (this.enabled) {
      return; // Already enabled
    }

    this.enabled = true;
    this.registerEventListeners();
  }

  /**
   * Disable action monitoring
   *
   * Removes all DOM event listeners and clears debounce timers.
   * Safe to call multiple times (idempotent).
   */
  disable(): void {
    if (!this.enabled) {
      return; // Already disabled
    }

    this.enabled = false;
    this.unregisterEventListeners();
    this.clearDebounceTimers();
  }

  /**
   * Check if monitoring is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Register DOM event listeners for all monitored event types
   */
  private registerEventListeners(): void {
    for (const eventType of MONITORED_EVENT_TYPES) {
      // Create listener for this event type
      const listener = this.createEventListener(eventType);

      // Store listener reference for cleanup
      this.listeners.set(eventType, listener);

      // Register at document level for event delegation
      document.addEventListener(eventType, listener, true); // Use capture phase
    }
  }

  /**
   * Unregister all DOM event listeners
   */
  private unregisterEventListeners(): void {
    for (const [eventType, listener] of this.listeners.entries()) {
      document.removeEventListener(eventType, listener, true);
    }
    this.listeners.clear();
  }

  /**
   * Clear all active debounce timers
   */
  private clearDebounceTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      window.clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /**
   * Check if element is genuinely interactive
   *
   * Uses permissive matching to avoid over-filtering, but helps reduce
   * noise from clicks on purely decorative elements.
   */
  private isValidInteractiveElement(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    // Always allow standard interactive elements
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') {
      return true;
    }

    // Allow elements with interactive roles
    if (
      role === 'button' ||
      role === 'link' ||
      role === 'tab' ||
      role === 'menuitem' ||
      role === 'checkbox' ||
      role === 'radio'
    ) {
      return true;
    }

    // Allow elements with explicit interactivity markers
    if (
      element.onclick !== null ||
      element.hasAttribute('data-testid') ||
      element.hasAttribute('aria-label') ||
      element.classList.contains('clickable')
    ) {
      return true;
    }

    // Allow child elements of interactive parents (e.g., icon in button)
    const interactiveParent = element.closest('button, a, [role="button"], [role="link"], input, select, textarea');
    if (interactiveParent) {
      return true;
    }

    // For permissive behavior, allow other elements by default
    // This prevents over-filtering while still providing some noise reduction
    return true;
  }

  /**
   * Create an event listener for a specific event type
   */
  private createEventListener(eventType: string): EventListener {
    return (event: Event) => {
      // Skip if monitoring is disabled (safety check)
      if (!this.enabled) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target || !(target instanceof HTMLElement)) {
        return;
      }

      // Filter out events we shouldn't capture
      if (!shouldCaptureElement(target)) {
        return;
      }

      // Additional validation: prefer genuinely interactive elements
      // Note: This is permissive and won't filter out most elements
      if (!this.isValidInteractiveElement(target)) {
        return;
      }

      // Detect action type based on element and event
      const actionType = detectActionType(target, event);

      // Filter: only emit hover actions from mouseenter events
      // This prevents hover events from triggering button/highlight/formfill completions
      if (eventType === 'mouseenter' && actionType !== 'hover') {
        // console.log(`Skipping mouseenter event - detected as ${actionType}, not hover`);
        return; // Skip - mouseenter should only trigger for explicit hover actions
      }

      // Filter: only emit click-based actions from click events
      // This prevents premature completion from hover/focus events
      if (eventType === 'click' && actionType === 'hover') {
        // console.log('Skipping click event - detected as hover action');
        return; // Skip - click events shouldn't trigger hover actions
      }

      // Extract value for formfill actions
      let value: string | undefined;
      if (eventType === 'input' || eventType === 'change') {
        const inputElement = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        value = inputElement.value;
      }

      // Create detected action event
      const detectedAction: DetectedActionEvent = {
        actionType,
        element: target,
        value,
        timestamp: Date.now(),
      };

      // Emit debounced custom event
      this.emitDebouncedAction(detectedAction);
    };
  }

  /**
   * Emit a user-action-detected event with debouncing
   *
   * Debounces rapid-fire events (e.g., multiple clicks, typing) to prevent
   * excessive event emissions.
   */
  private emitDebouncedAction(action: DetectedActionEvent): void {
    const debounceKey = this.getDebounceKey(action);

    // Clear existing timer for this action
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = window.setTimeout(() => {
      this.emitAction(action);
      this.debounceTimers.delete(debounceKey);
    }, DEFAULT_DEBOUNCE_DELAY);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Generate a unique key for debouncing based on action details
   */
  private getDebounceKey(action: DetectedActionEvent): string {
    const { actionType, element } = action;

    // Use element identity + action type as key
    // This allows different actions on same element or same action on different elements
    const elementKey = this.getElementIdentifier(element);
    return `${actionType}:${elementKey}`;
  }

  /**
   * Generate a stable identifier for an element
   */
  private getElementIdentifier(element: HTMLElement): string {
    // Try data-testid first (most stable)
    const testId = element.getAttribute('data-testid');
    if (testId) {
      return `testid:${testId}`;
    }

    // Try id attribute
    if (element.id) {
      return `id:${element.id}`;
    }

    // Try aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      return `aria:${ariaLabel}`;
    }

    // Fallback to tag name + text content
    const tag = element.tagName.toLowerCase();
    const text = element.textContent?.trim().substring(0, 50) || '';
    return `${tag}:${text}`;
  }

  /**
   * Emit the user-action-detected custom event
   */
  private emitAction(action: DetectedActionEvent): void {
    const event = new CustomEvent('user-action-detected', {
      detail: action,
      bubbles: false, // Don't bubble, use targeted listening
      cancelable: false,
    });

    document.dispatchEvent(event);
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    if (ActionMonitor.instance) {
      ActionMonitor.instance.disable();
      ActionMonitor.instance = null;
    }
  }
}

/**
 * Convenience function to get the ActionMonitor instance
 */
export function getActionMonitor(): ActionMonitor {
  return ActionMonitor.getInstance();
}
