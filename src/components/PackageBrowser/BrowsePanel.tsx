import React, { useEffect } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { t } from '@grafana/i18n';
import { locationService } from '@grafana/runtime';
import { Button } from '@grafana/ui';
import { useBooleanFlag } from '../../utils/openfeature';
import { openCatalogBrowser } from '../docs-panel/utils/open-catalog-browser';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';

export class BrowsePanel extends SceneObjectBase<SceneObjectState> {
  public static Component = BrowsePanelRenderer;
}

function BrowsePanelRenderer() {
  const enabled = useBooleanFlag('pathfinder.package-browser', true);
  useEffect(() => {
    if (enabled) {
      openCatalogBrowser();
      locationService.replace(prefixRoute(ROUTES.Home));
    }
  }, [enabled]);
  if (!enabled) {
    return <p>{t('packageBrowser.disabled', 'The guide browser is currently unavailable.')}</p>;
  }
  return (
    <Button variant="secondary" onClick={() => openCatalogBrowser()}>
      {t('packageBrowser.openInSidebar', 'Open guide browser')}
    </Button>
  );
}
