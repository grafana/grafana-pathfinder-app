import { InteractiveElementData } from '../types/interactive.types';
import { InteractiveStateManager } from './interactive-state-manager';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';
import { logger } from '../lib/logging';
import {
  recordRequirementsExhausted,
  recordSequenceActionError,
  type SequenceErrorClassification,
  type SequenceRunResult,
} from '../lib/telemetry';

const MAX_REQUIREMENT_CONTEXT_LENGTH = 200;
const MAX_ERROR_NAME_LENGTH = 64;

export function classifySequenceError(error: unknown): SequenceErrorClassification {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', category: 'other' };
  }
  const name = error.name.slice(0, MAX_ERROR_NAME_LENGTH) || 'Error';
  if (/timeout|timed out/i.test(error.message)) {
    return { name, category: 'timeout' };
  }
  if (/no elements? found|not found/i.test(error.message)) {
    return { name, category: 'not_found' };
  }
  return { name, category: 'dispatch_failed' };
}

// Exhaustion is classified by what the *last* attempt failed on: an unmet
// requirements check vs the action itself throwing.
type RetryResult = 'completed' | 'failed_requirements' | 'failed_action';

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
    let lastFailure: 'requirements' | 'action' = 'requirements';
    let lastError: unknown;

    while (retryCount < this.MAX_RETRIES) {
      try {
        const success = await operation();
        if (success) {
          return 'completed';
        }
        lastFailure = 'requirements';
        retryCount++;
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
        }
      } catch (error) {
        this.stateManager.logError(errorContext, error as Error, context.data);
        lastFailure = 'action';
        lastError = error;
        retryCount++;
        if (retryCount < this.MAX_RETRIES) {
          await this.sleep(this.RETRY_DELAY);
        }
      }
    }

    logger.warn(
      `${context.stepName} ${context.stepIndex + 1} failed after ${this.MAX_RETRIES} retries, stopping sequence`
    );
    const requirement = (context.data.requirements ?? '').slice(0, MAX_REQUIREMENT_CONTEXT_LENGTH);
    if (lastFailure === 'action') {
      recordSequenceActionError(requirement, this.MAX_RETRIES, classifySequenceError(lastError));
      return 'failed_action';
    }
    recordRequirementsExhausted(requirement, this.MAX_RETRIES);
    return 'failed_requirements';
  }

  /**
   * Simple sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runInteractiveSequence(elements: Element[], showMode: boolean): Promise<SequenceRunResult> {
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

      if (result !== 'completed') {
        // Stop the entire sequence
        return result === 'failed_action' ? 'action_error' : 'requirements_exhausted';
      }
    }
    return 'completed';
  }

  async runStepByStepSequence(elements: Element[]): Promise<SequenceRunResult> {
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

      if (result !== 'completed') {
        // Stop the entire sequence
        return result === 'failed_action' ? 'action_error' : 'requirements_exhausted';
      }
    }
    return 'completed';
  }
}
