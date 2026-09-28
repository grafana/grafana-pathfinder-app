import { sleep } from '../../lib/async-utils';
import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData, ActionExecutionResult } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';

/**
 * Allowed targetValue values for popout steps.
 * - 'sidebar' docks the panel back into the Grafana sidebar.
 * - 'floating' undocks the panel into a floating window.
 */
export type PopoutTargetMode = 'sidebar' | 'floating';

const POPOUT_EVENT_BY_MODE: Record<PopoutTargetMode, string> = {
  floating: 'pathfinder-request-pop-out',
  sidebar: 'pathfinder-request-dock',
};

/**
 * Handler for the `popout` interactive action.
 *
 * Toggles the docs panel between the sidebar and a floating window by
 * dispatching a document-level event. The event is handled by:
 * - `pathfinder-request-pop-out` -> `docs-panel.tsx` (existing handler)
 * - `pathfinder-request-dock`    -> `FloatingPanelManager.tsx` (new handler)
 *
 * This is a single-button action (no separate "show" preview), modelled
 * after the navigate handler's "Go there" pattern.
 */
export class PopoutHandler {
  constructor(
    private stateManager: InteractiveStateManager,
    private waitForReactUpdates: () => Promise<void>,
    private context?: InteractiveElementData
  ) {}

  async execute(data: InteractiveElementData, _perform: boolean): Promise<ActionExecutionResult> {
    if (data !== this.context && (data.signal || data.lazyRender)) {
      return new PopoutHandler(this.stateManager, this.waitForReactUpdates, data).execute(data, _perform);
    }
    this.stateManager.setState(data, 'running');

    try {
      this.context?.signal?.throwIfAborted();
      const mode = this.resolveTargetMode(data.targetValue);
      if (!mode) {
        return { outcome: 'error', reason: 'unsupported_action' };
      }

      document.dispatchEvent(new CustomEvent(POPOUT_EVENT_BY_MODE[mode]));

      await this.markAsCompleted(data);
      this.context?.signal?.throwIfAborted();
      return { outcome: 'ok' };
    } catch (error) {
      if (this.context?.signal?.aborted) {
        return { outcome: 'cancelled' };
      }
      this.stateManager.handleError(error as Error, 'PopoutHandler', data, false);
      return { outcome: 'error', reason: 'action_failed' };
    }
  }

  private resolveTargetMode(value: string | undefined): PopoutTargetMode | null {
    if (value === 'sidebar' || value === 'floating') {
      return value;
    }
    return null;
  }

  private async markAsCompleted(data: InteractiveElementData): Promise<void> {
    await this.waitForReactUpdates();
    this.context?.signal?.throwIfAborted();
    this.stateManager.setState(data, 'completed');
    await sleep(INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck, this.context?.signal);
    this.context?.signal?.throwIfAborted();
    await this.waitForReactUpdates();
    this.context?.signal?.throwIfAborted();
  }
}
