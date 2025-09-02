/**
 * Centralized timeout manager to prevent competing debounce mechanisms
 * Provides a single source of truth for all timeout-based operations
 */

import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

export class TimeoutManager {
  private static instance: TimeoutManager;
  private timeouts = new Map<string, NodeJS.Timeout>();

  static getInstance(): TimeoutManager {
    if (!TimeoutManager.instance) {
      TimeoutManager.instance = new TimeoutManager();
    }
    return TimeoutManager.instance;
  }

  private constructor() {}

  /**
   * Set a debounced timeout with automatic cleanup
   * @param key - Unique identifier for this timeout
   * @param callback - Function to execute after delay
   * @param delay - Delay in milliseconds (uses config defaults if not specified)
   * @param type - Type of operation for default delay lookup
   */
  setDebounced(
    key: string,
    callback: () => void | Promise<void>,
    delay?: number,
    type?: 'contextRefresh' | 'uiUpdates' | 'modalDetection' | 'stateSettling' | 'reactiveCheck'
  ): void {
    // Clear existing timeout for this key
    this.clear(key);

    // Use provided delay or lookup from config
    const actualDelay = delay ?? this.getDefaultDelay(type);

    const timeoutId = setTimeout(async () => {
      try {
        await callback();
      } catch (error) {
        console.error(`Timeout callback error for key '${key}':`, error);
      } finally {
        // Clean up after execution
        this.timeouts.delete(key);
      }
    }, actualDelay);

    this.timeouts.set(key, timeoutId);
  }

  /**
   * Set a simple timeout (non-debounced)
   * @param key - Unique identifier for this timeout
   * @param callback - Function to execute after delay
   * @param delay - Delay in milliseconds
   */
  setTimeout(key: string, callback: () => void | Promise<void>, delay: number): void {
    // Don't clear existing timeout - this is for simple delays, not debouncing
    const timeoutId = setTimeout(async () => {
      try {
        await callback();
      } catch (error) {
        console.error(`Timeout callback error for key '${key}':`, error);
      } finally {
        this.timeouts.delete(key);
      }
    }, delay);

    this.timeouts.set(key, timeoutId);
  }

  /**
   * Clear a specific timeout
   * @param key - Timeout identifier to clear
   */
  clear(key: string): void {
    const timeoutId = this.timeouts.get(key);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.timeouts.delete(key);
    }
  }

  /**
   * Clear all timeouts
   */
  clearAll(): void {
    this.timeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    this.timeouts.clear();
  }

  /**
   * Check if a timeout is active
   * @param key - Timeout identifier to check
   */
  isActive(key: string): boolean {
    return this.timeouts.has(key);
  }

  /**
   * Get all active timeout keys (for debugging)
   */
  getActiveKeys(): string[] {
    return Array.from(this.timeouts.keys());
  }

  /**
   * Get default delay for operation type
   */
  private getDefaultDelay(type?: string): number {
    switch (type) {
      case 'contextRefresh':
        return INTERACTIVE_CONFIG.delays.debouncing.contextRefresh;
      case 'uiUpdates':
        return INTERACTIVE_CONFIG.delays.debouncing.uiUpdates;
      case 'modalDetection':
        return INTERACTIVE_CONFIG.delays.debouncing.modalDetection;
      case 'stateSettling':
        return INTERACTIVE_CONFIG.delays.debouncing.stateSettling;
      case 'reactiveCheck':
        return INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck;
      default:
        return INTERACTIVE_CONFIG.delays.debouncing.stateSettling;
    }
  }
}

/**
 * Hook for accessing the timeout manager in React components
 */
export function useTimeoutManager() {
  return TimeoutManager.getInstance();
}
