import { InteractiveElementData } from '../types/interactive.types';
import { InteractiveStateManager } from './interactive-state-manager';
import { INTERACTIVE_CONFIG } from '../constants/interactive-config';

export class SequenceManager {
  constructor(
    private stateManager: InteractiveStateManager,
    private checkRequirementsFromData: (data: InteractiveElementData) => Promise<any>,
    private dispatchInteractiveAction: (data: InteractiveElementData, click: boolean) => Promise<void>,
    private waitForReactUpdates: () => Promise<void>,
    private isValidInteractiveElement: (data: InteractiveElementData) => boolean,
    private extractInteractiveDataFromElement: (element: HTMLElement) => InteractiveElementData
  ) {}

  async runInteractiveSequence(elements: Element[], showMode: boolean): Promise<void> {
    const RETRY_DELAY = INTERACTIVE_CONFIG.delays.perceptual.retry;
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = this.extractInteractiveDataFromElement(element as HTMLElement);
      if (!this.isValidInteractiveElement(data)) {
        continue;
      }
      let retryCount = 0;
      let elementCompleted = false;
      while (!elementCompleted && retryCount < INTERACTIVE_CONFIG.maxRetries) {
        try {
          const requirementsCheck = await this.checkRequirementsFromData(data);
          if (!requirementsCheck.pass) {
            retryCount++;
            if (retryCount < INTERACTIVE_CONFIG.maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
              continue;
            } else {
              // Requirements failed after all retries - stop the entire sequence
              console.warn(
                `⚠️ Element ${i + 1} requirements failed after ${INTERACTIVE_CONFIG.maxRetries} retries, stopping sequence`
              );
              return; // Stop the entire sequence
            }
          }
          await this.dispatchInteractiveAction(data, !showMode);
          elementCompleted = true;
          await this.waitForReactUpdates();
        } catch (error) {
          this.stateManager.logError('Error processing interactive element', error as Error, data);
          retryCount++;
          if (retryCount < INTERACTIVE_CONFIG.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          } else {
            // Action failed after all retries - stop the entire sequence
            console.warn(
              `⚠️ Element ${i + 1} action failed after ${INTERACTIVE_CONFIG.maxRetries} retries, stopping sequence`
            );
            return; // Stop the entire sequence
          }
        }
      }
    }
  }

  async runStepByStepSequence(elements: Element[]): Promise<void> {
    const RETRY_DELAY = INTERACTIVE_CONFIG.delays.perceptual.retry;
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const data = this.extractInteractiveDataFromElement(element as HTMLElement);
      if (!this.isValidInteractiveElement(data)) {
        continue;
      }
      let retryCount = 0;
      let stepCompleted = false;
      while (!stepCompleted && retryCount < INTERACTIVE_CONFIG.maxRetries) {
        try {
          const requirementsCheck = await this.checkRequirementsFromData(data);
          if (!requirementsCheck.pass) {
            retryCount++;
            if (retryCount < INTERACTIVE_CONFIG.maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
              continue;
            } else {
              // Pre-requirements failed after all retries - stop the entire sequence
              console.warn(
                `⚠️ Step ${i + 1} pre-requirements failed after ${INTERACTIVE_CONFIG.maxRetries} retries, stopping sequence`
              );
              return; // Stop the entire sequence
            }
          }
          await this.dispatchInteractiveAction(data, false);
          await this.waitForReactUpdates();
          const secondCheck = await this.checkRequirementsFromData(data);
          if (!secondCheck.pass) {
            retryCount++;
            if (retryCount < INTERACTIVE_CONFIG.maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
              continue;
            } else {
              // Post-action verification failed after all retries - stop the entire sequence
              console.warn(
                `⚠️ Step ${i + 1} post-verification failed after ${INTERACTIVE_CONFIG.maxRetries} retries, stopping sequence`
              );
              return; // Stop the entire sequence
            }
          }
          await this.dispatchInteractiveAction(data, true);
          stepCompleted = true;
          if (i < elements.length - 1) {
            await this.waitForReactUpdates();
          }
        } catch (error) {
          this.stateManager.logError('Error in interactive step', error as Error, data);
          retryCount++;
          if (retryCount < INTERACTIVE_CONFIG.maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
          } else {
            // Step execution failed after all retries - stop the entire sequence
            console.warn(
              `⚠️ Step ${i + 1} execution failed after ${INTERACTIVE_CONFIG.maxRetries} retries, stopping sequence`
            );
            return; // Stop the entire sequence
          }
        }
      }
    }
  }
}
