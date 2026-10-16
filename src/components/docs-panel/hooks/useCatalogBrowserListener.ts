import { useEffect } from 'react';
import { config } from '@grafana/runtime';
import { consumeCatalogActivation, getCatalogActivation } from '../../../global-state/package-browser';
import { panelModeManager, type PanelMode } from '../../../global-state/panel-mode';
import { OPEN_CATALOG_BROWSER_EVENT } from '../../../lib/event-names';
import { BROWSE_TAB_ID } from '../utils/tab-kinds';

interface CatalogBrowserModel {
  restoreTabsAsync(): Promise<void>;
  setActiveTab(id: string): void;
}

export function useCatalogBrowserListener(model: CatalogBrowserModel, panelMode: PanelMode): void {
  const scope = `${config.namespace || ''}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
  useEffect(() => {
    if (panelMode !== 'sidebar') {
      return;
    }
    let cancelled = false;
    const activate = async () => {
      const id = getCatalogActivation(scope);
      if (id === null) {
        return;
      }
      try {
        await model.restoreTabsAsync();
      } catch {
        return;
      }
      const currentScope = `${config.namespace || ''}:${config.bootData?.user?.orgId ?? ''}:${config.bootData?.user?.id ?? ''}`;
      if (
        !cancelled &&
        currentScope === scope &&
        panelModeManager.getMode() === 'sidebar' &&
        consumeCatalogActivation(scope, id)
      ) {
        model.setActiveTab(BROWSE_TAB_ID);
      }
    };
    const onOpen = () => void activate();
    document.addEventListener(OPEN_CATALOG_BROWSER_EVENT, onOpen);
    void activate();
    return () => {
      cancelled = true;
      document.removeEventListener(OPEN_CATALOG_BROWSER_EVENT, onOpen);
    };
  }, [model, panelMode, scope]);
}
