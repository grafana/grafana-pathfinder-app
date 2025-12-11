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
 * Maximum number of actions to keep in the queue
 * Oldest actions are removed when queue exceeds this size
 */
const MAX_QUEUE_SIZE = 10;

/**
 * Debounce delay in milliseconds to prevent duplicate completions
 * from rapid interactions (e.g., double-clicks, fast typing)
 */
const DEBOUNCE_DELAY_MS = 50;

/**
 * DOM event types to monitor for user actions
 */
const MONITORED_EVENT_TYPES = ['click', 'input', 'change', 'mouseenter', 'keydown'] as const;

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
  private actionQueue: DetectedActionEvent[] = [];

  // Reference counting for multi-section coordination
  private referenceCount = 0;

  // Force-disabled flag for section execution (overrides reference counting)
  private forceDisabled = false;

  // Debounce state to prevent duplicate completions
  private lastEmittedAction: { element: HTMLElement; timestamp: number } | null = null;

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
   * Enable action monitoring (reference counted)
   *
   * Registers global DOM event listeners for user interactions.
   * Uses reference counting to handle multiple sections safely.
   * Each call to enable() should be paired with a call to disable().
   *
   * Note: The caller (InteractiveSection) should check the plugin config
   * before calling this method to respect user preferences.
   */
  enable(): void {
    this.referenceCount++;

    // Only actually enable if this is the first reference and not force-disabled
    if (!this.enabled && !this.forceDisabled) {
      this.enabled = true;
      this.registerEventListeners();
    }
  }

  /**
   * Disable action monitoring (reference counted)
   *
   * Decrements reference count and only actually disables when count reaches 0.
   * Safe to call multiple times - tracks each enable/disable pair.
   */
  disable(): void {
    this.referenceCount = Math.max(0, this.referenceCount - 1);

    // Only actually disable if no more references
    if (this.referenceCount === 0 && this.enabled && !this.forceDisabled) {
      this.enabled = false;
      this.unregisterEventListeners();
      this.clearQueue();
    }
  }

  /**
   * Force disable action monitoring (bypasses reference counting)
   *
   * Used during section execution to ensure no auto-completions occur.
   * Must be paired with forceEnable() to restore normal operation.
   */
  forceDisable(): void {
    this.forceDisabled = true;
    if (this.enabled) {
      this.enabled = false;
      this.unregisterEventListeners();
      this.clearQueue();
    }
  }

  /**
   * Force enable action monitoring (restores from force-disable)
   *
   * Re-enables monitoring if there are still active references.
   * Should be called after forceDisable() when section execution completes.
   */
  forceEnable(): void {
    this.forceDisabled = false;
    // Re-enable if there are active references
    if (this.referenceCount > 0 && !this.enabled) {
      this.enabled = true;
      this.registerEventListeners();
    }
  }

  /**
   * Check if monitoring is currently enabled
   */
  isEnabled(): boolean {
    return this.enabled && !this.forceDisabled;
  }

  /**
   * Get current reference count (for debugging)
   */
  getReferenceCount(): number {
    return this.referenceCount;
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
   * Clear action queue and debounce state
   */
  private clearQueue(): void {
    this.actionQueue = [];
    this.lastEmittedAction = null;
  }

  /**
   * Check if element is genuinely interactive
   *
   * Filters out purely decorative elements to reduce noise and prevent
   * spurious auto-completions from clicks on non-interactive content.
   */
  private isValidInteractiveElement(element: HTMLElement): boolean {
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role');

    // Always allow standard interactive elements
    if (tag === 'button' || tag === 'a' || tag === 'input' || tag === 'textarea' || tag === 'select') {
      return true;
    }

    // Allow elements with interactive ARIA roles
    if (
      role === 'button' ||
      role === 'link' ||
      role === 'tab' ||
      role === 'menuitem' ||
      role === 'checkbox' ||
      role === 'radio' ||
      role === 'option' ||
      role === 'switch' ||
      role === 'combobox' ||
      role === 'listbox' ||
      role === 'menu' ||
      role === 'slider'
    ) {
      return true;
    }

    // Allow elements with explicit interactivity markers
    if (element.onclick !== null || element.classList.contains('clickable')) {
      return true;
    }

    // Allow child elements of interactive parents (e.g., icon in button)
    const interactiveParent = element.closest(
      'button, a, [role="button"], [role="link"], [role="tab"], [role="menuitem"], input, select, textarea'
    );
    if (interactiveParent) {
      return true;
    }

    // Allow elements that are focusable (have tabindex)
    const tabindex = element.getAttribute('tabindex');
    if (tabindex !== null && tabindex !== '-1') {
      return true;
    }

    // Reject purely decorative elements (divs, spans, etc. without interactivity)
    // This is the key fix - we now actually filter instead of allowing everything
    return false;
  }

  /**
   * Check if action should be debounced (same element clicked within debounce window)
   */
  private shouldDebounce(element: HTMLElement, timestamp: number): boolean {
    if (!this.lastEmittedAction) {
      return false;
    }

    const isSameElement = this.lastEmittedAction.element === element;
    const withinDebounceWindow = timestamp - this.lastEmittedAction.timestamp < DEBOUNCE_DELAY_MS;

    return isSameElement && withinDebounceWindow;
  }

  /**
   * Create an event listener for a specific event type
   */
  private createEventListener(eventType: string): EventListener {
    return (event: Event) => {
      // Skip if monitoring is disabled or force-disabled (safety check)
      if (!this.enabled || this.forceDisabled) {
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

      // Additional validation: filter out non-interactive elements
      if (!this.isValidInteractiveElement(target)) {
        return;
      }

      // Handle keyboard events - only track Enter/Space for form submission
      if (eventType === 'keydown') {
        const keyEvent = event as KeyboardEvent;
        // Only capture Enter key on form elements or buttons for submission detection
        if (keyEvent.key !== 'Enter' && keyEvent.key !== ' ') {
          return; // Only track Enter and Space keys
        }
        // Space only for buttons/checkboxes, not text inputs
        if (keyEvent.key === ' ') {
          const tag = target.tagName.toLowerCase();
          if (tag === 'input' || tag === 'textarea') {
            return; // Skip space in text inputs
          }
        }
      }

      // Detect action type based on element and event
      const actionType = detectActionType(target, event);

      // Filter: only emit hover actions from mouseenter events
      // This prevents hover events from triggering button/highlight/formfill completions
      if (eventType === 'mouseenter' && actionType !== 'hover') {
        return; // Skip - mouseenter should only trigger for explicit hover actions
      }

      // Filter: only emit click-based actions from click events
      // This prevents premature completion from hover/focus events
      if (eventType === 'click' && actionType === 'hover') {
        return; // Skip - click events shouldn't trigger hover actions
      }

      // Extract value for formfill actions
      let value: string | undefined;
      if (eventType === 'input' || eventType === 'change') {
        const inputElement = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
        value = inputElement.value;
      }

      // Extract coordinates for spatial matching
      let clientX: number | undefined;
      let clientY: number | undefined;
      if (event instanceof MouseEvent) {
        clientX = event.clientX;
        clientY = event.clientY;
      }

      const timestamp = Date.now();

      // Debounce: skip if same element was just actioned
      if (this.shouldDebounce(target, timestamp)) {
        return;
      }

      // Create detected action event
      const detectedAction: DetectedActionEvent = {
        actionType,
        element: target,
        value,
        timestamp,
        clientX,
        clientY,
      };

      // Track for debouncing
      this.lastEmittedAction = { element: target, timestamp };

      // Add to queue and emit
      this.addToQueueAndEmit(detectedAction);
    };
  }

  /**
   * Add action to queue and emit immediately
   *
   * Maintains a FIFO queue with maximum size. When queue is full,
   * oldest action is removed before adding new one.
   */
  private addToQueueAndEmit(action: DetectedActionEvent): void {
    // Add to queue
    this.actionQueue.push(action);

    // If queue exceeds max size, remove oldest action (FIFO)
    if (this.actionQueue.length > MAX_QUEUE_SIZE) {
      this.actionQueue.shift();
    }

    // Emit immediately (no debounce delay)
    this.emitAction(action);
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
   * Get current queue size (for debugging)
   */
  getQueueSize(): number {
    return this.actionQueue.length;
  }

  /**
   * Get a copy of the current action queue (for debugging)
   */
  getQueue(): DetectedActionEvent[] {
    return [...this.actionQueue];
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static reset(): void {
    if (ActionMonitor.instance) {
      // Force cleanup all state
      ActionMonitor.instance.forceDisabled = false;
      ActionMonitor.instance.referenceCount = 0;
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
