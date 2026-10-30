import { getHomePageStyles } from '../Home/home.styles';
import React from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { LinkButton, useStyles2 } from '@grafana/ui';
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
      <nav aria-label="Learning pages" className={styles.browseNavigation}>
        <LinkButton href={prefixRoute(ROUTES.Home)} variant="secondary" fill="text" size="md" icon="arrow-left">
          Back
        </LinkButton>
      </nav>
      {enabled ? (
        <PackageBrowser page onOpenGuide={openGuideInSidebar} />
      ) : (
        <p>{t('packageBrowser.disabled', 'Learning exploration is currently unavailable.')}</p>
      )}
    </div>
  );
}
