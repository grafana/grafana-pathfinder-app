/**
 * Home panel
 *
 * SceneObjectBase wrapper + React composition root for the home page.
 * Renders MyLearningTab as the full-page learning hub at /a/grafana-pathfinder-app.
 * Guide opens are dispatched to the sidebar panel.
 */

import React, { useCallback } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { useStyles2 } from '@grafana/ui';

import { sidebarState } from '../../global-state/sidebar';
import { linkInterceptionState } from '../../global-state/link-interception';
import { MyLearningTab } from '../LearningPaths';
import { MyLearningErrorBoundary } from '../docs-panel/components';
import { getHomePageStyles } from './home.styles';

// ============================================================================
// SCENE OBJECT
// ============================================================================

interface HomePanelState extends SceneObjectState {}

export class HomePanel extends SceneObjectBase<HomePanelState> {
  public static Component = HomePanelRenderer;
}

// ============================================================================
// RENDERER
// ============================================================================

export function HomePanelRenderer() {
  const styles = useStyles2(getHomePageStyles);

  const handleOpenGuide = useCallback((url: string, title: string) => {
    const detail = { url, title };

    if (sidebarState.getIsSidebarMounted()) {
      document.dispatchEvent(new CustomEvent('pathfinder-auto-open-docs', { detail }));
    } else {
      sidebarState.setPendingOpenSource('home_page');
      sidebarState.openSidebar('Interactive learning', {
        url: detail.url,
        title: detail.title,
        timestamp: Date.now(),
      });
      linkInterceptionState.addToQueue({ ...detail, timestamp: Date.now() });
    }
  }, []);

  return (
    <div className={styles.container} data-testid="home-page">
      <MyLearningErrorBoundary>
        <MyLearningTab onOpenGuide={handleOpenGuide} />
      </MyLearningErrorBoundary>
    </div>
  );
}
