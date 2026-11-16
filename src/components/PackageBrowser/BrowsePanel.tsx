import { getHomePageStyles } from '../Home/home.styles';
import React from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { Button, useStyles2 } from '@grafana/ui';
import { locationService } from '@grafana/runtime';
import { t } from '@grafana/i18n';
import { useBooleanFlag } from '../../utils/openfeature';
import { prefixRoute } from '../../utils/utils.routing';
import { ROUTES } from '../../constants';
import { PackageBrowser } from './PackageBrowser';
import { openGuideInSidebar } from '../docs-panel/utils/open-prepared-guide';

export class BrowsePanel extends SceneObjectBase<SceneObjectState> {
  public static Component = BrowsePanelRenderer;
}

function BrowsePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);
  const enabled = useBooleanFlag('pathfinder.package-browser', true);
  return (
    <div className={styles.browseLayout}>
      <nav aria-label={t('myLearning.pageActions', 'Learning pages')} className={styles.browseNavigation}>
        <Button
          onClick={() => locationService.push(prefixRoute(ROUTES.Home))}
          variant="secondary"
          fill="text"
          size="md"
          icon="arrow-left"
        >
          {t('common.back', 'Back')}
        </Button>
      </nav>
      {enabled ? (
        <PackageBrowser page onOpenGuide={openGuideInSidebar} />
      ) : (
        <p>{t('packageBrowser.disabled', 'Learning exploration is currently unavailable.')}</p>
      )}
    </div>
  );
}
