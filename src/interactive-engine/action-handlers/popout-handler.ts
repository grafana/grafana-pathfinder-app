import { InteractiveStateManager } from '../interactive-state-manager';
import { InteractiveElementData } from '../../types/interactive.types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';

/**
 * Allowed targetvalue values for popout steps.
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
    private waitForReactUpdates: () => Promise<void>
  ) {}

  async execute(data: InteractiveElementData, _perform: boolean): Promise<void> {
    this.stateManager.setState(data, 'running');

    try {
      const mode = this.resolveTargetMode(data.targetvalue);
      if (!mode) {
        this.stateManager.handleError(
          new Error(`PopoutHandler requires targetvalue of 'sidebar' or 'floating', got: ${String(data.targetvalue)}`),
          'PopoutHandler',
          data,
          true
        );
        return;
      }

      document.dispatchEvent(new CustomEvent(POPOUT_EVENT_BY_MODE[mode]));

      await this.markAsCompleted(data);
    } catch (error) {
      this.stateManager.handleError(error as Error, 'PopoutHandler', data);
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
    this.stateManager.setState(data, 'completed');
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.debouncing.reactiveCheck));
    await this.waitForReactUpdates();
  }
}
