import { useEffect } from 'react';
import {
  activateOrganizationGuideOffer,
  subscribeOrganizationGuideOffer,
  takeOrganizationGuideOffer,
} from '../../../global-state/organization-guide-offer';
import type { LearningJourneyTab } from '../../../types/content-panel.types';
import type { OpenDocsOptions } from '../types';

interface OrganizationGuidePanel {
  restoreTabsAsync(): Promise<void>;
  getActiveTab(): LearningJourneyTab | null;
  openDocsPage(url: string, title?: string, options?: OpenDocsOptions): Promise<string>;
}

export function useOrganizationGuideOffer(model: OrganizationGuidePanel, sidebar: boolean): void {
  useEffect(() => {
    if (!sidebar) {
      return;
    }
    let cancelled = false;
    const receive = async () => {
      await model.restoreTabsAsync();
      if (cancelled) {
        return;
      }
      const offer = takeOrganizationGuideOffer();
      const active = model.getActiveTab();
      if (!offer || !offer.canLaunch() || (active && active.type !== 'recommendations' && active.type !== 'browse')) {
        return;
      }
      const tabId = await model.openDocsPage(offer.url, offer.title, {
        source: 'organization_guide',
        preparedContent: offer.content,
      });
      activateOrganizationGuideOffer(offer, tabId);
    };
    const check = () => {
      void receive().catch(() => {});
    };
    const stop = subscribeOrganizationGuideOffer(check);
    check();
    return () => {
      cancelled = true;
      stop();
    };
  }, [model, sidebar]);
}
