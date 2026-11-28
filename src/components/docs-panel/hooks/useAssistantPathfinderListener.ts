import * as React from 'react';
import { getAppEvents } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';
import { AssistantPathfinderEvent, parseAssistantPathfinderPayload } from '../../../lib/assistant-pathfinder-event';
import type { LearningJourneyTab } from '../../../types/content-panel.types';

interface AssistantPathfinderModel {
  state: { tabs: LearningJourneyTab[] };
  loadTab(tabId: string, url: string, options?: { source?: 'internal_reload'; rejectOnError?: boolean }): Promise<void>;
}

/** Handles Assistant events for Pathfinder, e.g. reloading an open guide saved elsewhere; see docs/design/VIEWER-DEEP-LINK-CONTRACT.md. */
export function useAssistantPathfinderListener(model: AssistantPathfinderModel, surface: PanelMode = 'sidebar'): void {
  React.useEffect(() => {
    const subscription = getAppEvents().subscribe(AssistantPathfinderEvent, (event) => {
      const parsed = parseAssistantPathfinderPayload(event.payload);
      // Only the surface that owns the display acts, so a handoff never reloads twice.
      if (parsed === null || panelModeManager.getMode() !== surface) {
        return;
      }

      const url = `backend-guide:${parsed.name}`;
      for (const tab of model.state.tabs) {
        if (tab.baseUrl !== url && tab.currentUrl !== url) {
          continue;
        }
        model
          .loadTab(tab.id, tab.currentUrl || tab.baseUrl, { source: 'internal_reload', rejectOnError: true })
          // Old content stays visible on failure, so tell the user the guide did not update.
          .catch(() => {
            getAppEvents().publish({
              type: 'alert-warning',
              payload: [t('docsPanel.refreshGuideErrorTitle', "Couldn't refresh the guide")],
            });
          });
      }
    });
    return () => subscription.unsubscribe();
  }, [model, surface]);
}
