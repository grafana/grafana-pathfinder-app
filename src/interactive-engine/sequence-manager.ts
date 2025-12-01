import { InteractiveElementData } from '../types/interactive.types';
import { InteractiveStateManager } from './interactive-state-manager';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

/**
 * Result of a retry operation
 */
type RetryResult = 'completed' | 'failed' | 'error';

/**
 * Context for retry operations
 */
interface RetryContext {
  stepIndex: number;
  stepName: string;
  data: InteractiveElementData;
}

export class SequenceManager {
  private readonly RETRY_DELAY = INTERACTIVE_CONFIG.delays.perceptual.retry;
  private readonly MAX_RETRIES = INTERACTIVE_CONFIG.maxRetries;

  constructor(
    private stateManager: InteractiveStateManager,
    private checkRequirementsFromData: (data: InteractiveElementData) => Promise<any>,
    private dispatchInteractiveAction: (data: InteractiveElementData, click: boolean) => Promise<void>,
    private waitForReactUpdates: () => Promise<void>,
    private isValidInteractiveElement: (data: InteractiveElementData) => boolean,
    private extractInteractiveDataFromElement: (element: HTMLElement) => InteractiveElementData
  ) {}

  /**
   * Execute an operation with retry logic
   * @param operation - The async operation to execute
   * @param context - Context for logging
   * @param errorContext - Error message context
   * @returns Result indicating success, failure, or error
   */
  private async executeWithRetry(
    operation: () => Promise<boolean>,
    context: RetryContext,
    errorContext: string
  ): Promise<RetryResult> {
    let retryCount = 0;

    while (retryCount < this.MAX_RETRIES) {
      try {
        const success = await operation();
        if (success) {
          return 'completed';
        }
        retryCount++;
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
        }
      } catch (error) {
        this.stateManager.logError(errorContext, error as Error, context.data);
        retryCount++;
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
        }
      }
    }

    console.warn(
      `${context.stepName} ${context.stepIndex + 1} failed after ${this.MAX_RETRIES} retries, stopping sequence`
    );
    return 'failed';
  }

  /**
   * Simple sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runInteractiveSequence(elements: Element[], showMode: boolean): Promise<void> {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = this.extractInteractiveDataFromElement(element as HTMLElement);

      if (!this.isValidInteractiveElement(data)) {
        continue;
      }

      const context: RetryContext = { stepIndex: i, stepName: 'Element', data };

      const result = await this.executeWithRetry(
        async () => {
          const requirementsCheck = await this.checkRequirementsFromData(data);
          if (!requirementsCheck.pass) {
            return false;
          }
          await this.dispatchInteractiveAction(data, !showMode);
          await this.waitForReactUpdates();
          return true;
        },
        context,
        'Error processing interactive element'
      );

      if (result === 'failed') {
        return; // Stop the entire sequence
      }
    }
  }

  async runStepByStepSequence(elements: Element[]): Promise<void> {
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = this.extractInteractiveDataFromElement(element as HTMLElement);

      if (!this.isValidInteractiveElement(data)) {
        continue;
      }

      const context: RetryContext = { stepIndex: i, stepName: 'Step', data };

      const result = await this.executeWithRetry(
        async () => {
          // Pre-requirements check
          const requirementsCheck = await this.checkRequirementsFromData(data);
          if (!requirementsCheck.pass) {
            return false;
          }

          // Execute "do" action
          await this.dispatchInteractiveAction(data, false);
          await this.waitForReactUpdates();

          // Post-action verification
          const secondCheck = await this.checkRequirementsFromData(data);
          if (!secondCheck.pass) {
            return false;
          }

          // Execute "show" action
          await this.dispatchInteractiveAction(data, true);

          // Wait between steps (except for last one)
          if (i < elements.length - 1) {
            await this.waitForReactUpdates();
          }

          return true;
        },
        context,
        'Error in interactive step'
      );

      if (result === 'failed') {
        return; // Stop the entire sequence
      }
    }
  }
}
