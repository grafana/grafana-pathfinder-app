import { waitForReactUpdates } from './requirements-checker.hook';
import { InteractiveElementData } from '../types/interactive.types';

export type InteractiveState = 'idle' | 'running' | 'completed' | 'error';

export interface StateManagerOptions {
  enableLogging?: boolean;
  enableEvents?: boolean;
}

export class InteractiveStateManager {
  private options: StateManagerOptions;

  constructor(options: StateManagerOptions = {}) {
    this.options = {
      enableLogging: true,
      enableEvents: true,
      ...options
    };
  }

  /**
   * Set the interactive state and dispatch events if needed
   */
  setState(data: InteractiveElementData, state: InteractiveState): void {
    if (state === 'completed') {
      if (this.options.enableLogging) {
        console.log('✅ Interactive action completed:', data);
      }
      
      if (this.options.enableEvents) {
        // Dispatch event for any listeners
        waitForReactUpdates().then(() => {
          const event = new CustomEvent('interactive-action-completed', {
            detail: { data, state }
          });
          document.dispatchEvent(event);
        });
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
  handleError(
    error: Error | string, 
    context: string, 
    data: InteractiveElementData, 
    shouldThrow = true
  ): void {
    this.logError(context, error, data);
    this.setState(data, 'error');
    
    if (shouldThrow) {
      throw typeof error === 'string' ? new Error(error) : error;
    }
  }
} 
