import * as React from 'react';
import { guideLaunchStore } from '../../../global-state/guide-launch';
import { linkInterceptionState } from '../../../global-state/link-interception';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';
import { coerceLaunchSource } from '../../../recovery';
import { AUTO_OPEN_DOCS_EVENT } from '../../../lib/event-names';
import { isLearningJourneyUrl } from '../utils/url-validation';
import type { DocsPanelModelOperations } from '../types';

export function useAutoOpenListener(model: DocsPanelModelOperations, surface: PanelMode = 'sidebar'): void {
  React.useEffect(() => {
    const handleAutoOpen = (event: Event) => {
      // Only one surface owns the launch during a handoff.
      if (panelModeManager.getMode() !== surface) {
        return;
      }

      event.preventDefault();

      const customEvent = event as CustomEvent<{
        url: string;
        title: string;
        source?: string;
        launchKey?: string;
      }>;
      const { url, title, source, launchKey } = customEvent.detail;

      // Forged, replayed, or mismatched keys fall back to a validated fetch.
      const staged = guideLaunchStore.consume(launchKey, url);
      const typedSource = coerceLaunchSource(staged?.source ?? source);

      if (isLearningJourneyUrl(url)) {
        model.openLearningJourney(url, title, {
          source: typedSource ?? undefined,
          preparedContent: staged?.preparedContent,
          packageInfo: staged?.packageInfo,
        });
      } else {
        model.openDocsPage(url, title, {
          source: typedSource ?? undefined,
          preparedContent: staged?.preparedContent,
          packageInfo: staged?.packageInfo,
        });
      }
    };

    document.addEventListener(AUTO_OPEN_DOCS_EVENT, handleAutoOpen);

    const queueTimer = setTimeout(() => linkInterceptionState.processQueuedLinks(), 0);

    return () => {
      clearTimeout(queueTimer);
      document.removeEventListener(AUTO_OPEN_DOCS_EVENT, handleAutoOpen);
    };
  }, [model, surface]);
}
