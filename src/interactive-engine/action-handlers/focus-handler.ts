import { sleep } from '../../lib/async-utils';
import { InteractiveStateManager } from '../interactive-state-manager';
import { NavigationManager } from '../navigation-manager';
import { InteractiveElementData, ActionExecutionResult } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import { describeElement, isElementVisible } from '../../lib/dom';
import { logger } from '../../lib/logging';
import { resolveWithRetry } from '../../lib/dom/selector-retry';
import { parseTargetState } from '../../lib/dom/toggle-state';
import { clickToTargetState, commentForTargetState } from './toggle-click';

export class FocusHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private navigationManager: NavigationManager,
    private waitForReactUpdates: () => Promise<void>,
    private context?: InteractiveElementData
  ) {}

  async execute(data: InteractiveElementData, click: boolean): Promise<ActionExecutionResult> {
    if (data !== this.context && (data.signal || data.lazyRender)) {
      return new FocusHandler(this.stateManager, this.navigationManager, this.waitForReactUpdates, data).execute(
        data,
        click
      );
    }
    this.stateManager.setState(data, 'running');

    try {
      this.context?.signal?.throwIfAborted();
      const resolved = await resolveWithRetry(data.refTarget, 'focus', {
        signal: this.context?.signal,
        lazyRender: this.context?.lazyRender,
        scrollContainer: this.context?.scrollContainer,
      });
      this.context?.signal?.throwIfAborted();

      let targetElements: HTMLElement[];
      if (!resolved) {
        return { outcome: 'error', reason: 'target_missing' };
      } else {
        const shouldSelectSingle = this.shouldSelectSingleElement(resolved.resolvedSelector);
        targetElements = shouldSelectSingle ? [resolved.element] : resolved.elements;
      }

      if (!click) {
        await this.handleShowMode(targetElements, data.targetComment, data.targetState);
        this.context?.signal?.throwIfAborted();
        return { outcome: 'ok' };
      }

      await this.handleDoMode(targetElements, data.targetState);
      this.context?.signal?.throwIfAborted();
      await this.markAsCompleted(data);
      this.context?.signal?.throwIfAborted();
      return { outcome: 'ok' };
    } catch (error) {
      if (this.context?.signal?.aborted) {
        return { outcome: 'cancelled' };
      }
      this.stateManager.handleError(error as Error, 'FocusHandler', data, false);
      return { outcome: 'error', reason: 'action_failed' };
    }
  }

  private async handleShowMode(
    targetElements: HTMLElement[],
    comment?: string,
    rawTargetState?: boolean | string
  ): Promise<void> {
    // Show mode: ensure visibility and highlight, don't click - NO step completion
    for (const element of targetElements) {
      // Validate visibility before interaction
      if (!isElementVisible(element)) {
        logger.warn('Target element is not visible', { element: describeElement(element) });
        // Continue anyway (non-breaking)
      }

      await this.navigationManager.ensureNavigationOpen(element);
      this.context?.signal?.throwIfAborted();
      await this.navigationManager.ensureElementVisible(element);
      this.context?.signal?.throwIfAborted();
      await (this.context?.signal
        ? this.navigationManager.highlightWithComment(
            element,
            commentForTargetState(comment, element, rawTargetState),
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { signal: this.context.signal }
          )
        : this.navigationManager.highlightWithComment(
            element,
            commentForTargetState(comment, element, rawTargetState)
          ));
      this.context?.signal?.throwIfAborted();
    }
  }

  private async handleDoMode(targetElements: HTMLElement[], rawTargetState?: boolean | string): Promise<void> {
    // Clear any existing highlights before performing action
    this.navigationManager.clearAllHighlights();

    const target = parseTargetState(rawTargetState);

    // Do mode: ensure visibility then click, don't highlight
    for (const element of targetElements) {
      // Validate visibility before interaction
      if (!isElementVisible(element)) {
        logger.warn('Target element is not visible', { element: describeElement(element) });
        // Continue anyway (non-breaking)
      }

      await this.navigationManager.ensureNavigationOpen(element);
      this.context?.signal?.throwIfAborted();
      await this.navigationManager.ensureElementVisible(element);
      this.context?.signal?.throwIfAborted();

      if (target) {
        await clickToTargetState(element, target, this.waitForReactUpdates);
        this.context?.signal?.throwIfAborted();
      } else {
        element.click();
      }
    }
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    // Wait for React to process all focus/click events and state updates
    await this.waitForReactUpdates();
    this.context?.signal?.throwIfAborted();

    // Additional settling time for React state propagation and reactive checks
    // This ensures the sequential requirements system has time to unlock the next step
    await sleep(INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck, this.context?.signal);
    this.context?.signal?.throwIfAborted();

    // Mark as completed after state has settled
    this.stateManager.setState(data, 'completed');

    // Final wait to ensure completion state propagates
    await this.waitForReactUpdates();
    this.context?.signal?.throwIfAborted();
  }

  private shouldSelectSingleElement(selector: string): boolean {
    // Pseudo-selectors that should only return a single element
    const singleElementPseudos = [
      ':first-child',
      ':last-child',
      ':first-of-type',
      ':last-of-type',
      ':only-child',
      ':only-of-type',
      ':nth-child(1)',
      ':nth-of-type(1)',
    ];

    return singleElementPseudos.some((pseudo) => selector.includes(pseudo));
  }
}
