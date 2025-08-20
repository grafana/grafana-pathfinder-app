import { waitForReactUpdates } from './requirements-checker.hook';
import { InteractiveElementData } from '../types/interactive.types';
import GlobalInteractionBlocker from './global-interaction-blocker';

export type InteractiveState = 'idle' | 'running' | 'completed' | 'error';

export interface StateManagerOptions {
  enableLogging?: boolean;
  enableEvents?: boolean;
  enableGlobalBlocking?: boolean; // New option for safe interaction blocking
}

export class InteractiveStateManager {
  private options: StateManagerOptions;
  private globalBlocker: GlobalInteractionBlocker;

  constructor(options: StateManagerOptions = {}) {
    this.options = {
      enableLogging: true,
      enableEvents: true,
      enableGlobalBlocking: true, // Default to enabled for safety
      ...options,
    };

    this.globalBlocker = GlobalInteractionBlocker.getInstance();
  }

  /**
   * Set the interactive state and dispatch events if needed
   */
  async setState(data: InteractiveElementData, state: InteractiveState): Promise<void> {
    if (state === 'completed') {
      if (this.options.enableLogging) {
        console.log('✅ Interactive action completed:', data);
      }

      if (this.options.enableEvents) {
        // Dispatch event for any listeners
        await waitForReactUpdates();
        const event = new CustomEvent('interactive-action-completed', {
          detail: { data, state },
        });
        document.dispatchEvent(event);
      }
    }
  }

  /**
   * Log an interactive error with context
   */
  logError(context: string, error: Error | string, data: InteractiveElementData): void {
    if (!this.options.enableLogging) {
      return;
    }

    const errorMessage = typeof error === 'string' ? error : error.message;
    console.error(`❌ ${context}: ${errorMessage}`, data);
  }

  /**
   * Handle an interactive error with state management
   */
  handleError(error: Error | string, context: string, data: InteractiveElementData, shouldThrow = true): void {
    this.logError(context, error, data);
    this.setState(data, 'error');

    if (shouldThrow) {
      throw typeof error === 'string' ? new Error(error) : error;
    }
  }

  /**
   * Start section-level blocking (persists until section completes)
   */
  startSectionBlocking(sectionId: string, data: InteractiveElementData, cancelCallback?: () => void): void {
    if (this.options.enableGlobalBlocking) {
      this.globalBlocker.startSectionBlocking(sectionId, data, cancelCallback);
    }
  }

  /**
   * Stop section-level blocking
   */
  stopSectionBlocking(sectionId: string): void {
    if (this.options.enableGlobalBlocking) {
      this.globalBlocker.stopSectionBlocking(sectionId);
    }
  }

  /**
   * Check if section blocking is active
   */
  isSectionBlocking(): boolean {
    return !!(this.options.enableGlobalBlocking && this.globalBlocker.isSectionBlocking());
  }

  /**
   * Cancel the currently running section
   */
  cancelSection(): void {
    if (this.options.enableGlobalBlocking) {
      this.globalBlocker.cancelSection();
    }
  }

  /**
   * Emergency method to unblock all interactions
   */
  forceUnblock(): void {
    this.globalBlocker.forceUnblock();
  }
}
