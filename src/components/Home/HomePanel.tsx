/**
 * Home panel
 *
 * SceneObjectBase wrapper + React composition root for the home page.
 * Wires up hooks, passes props to child components, and handles top-level layout.
 */

import React, { useCallback } from 'react';
import { SceneObjectBase, type SceneObjectState } from '@grafana/scenes';
import { Spinner, useStyles2 } from '@grafana/ui';

import { useLearningPaths } from '../../learning-paths';
import { sidebarState } from '../../global-state/sidebar';
import { linkInterceptionState } from '../../global-state/link-interception';
import { getHomePageStyles } from './home.styles';
import { PathCard } from './PathCard';

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
  const { paths, getPathGuides, getPathProgress, isPathCompleted, isLoading } = useLearningPaths();

  const handleOpenGuide = useCallback((guideId: string, title: string) => {
    const detail = { url: `bundled:${guideId}`, title };

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

  if (isLoading) {
    return (
      <div className={styles.container}>
        <Spinner />
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="home-page">
      <header className={styles.header}>
        <h1 className={styles.title}>Pathfinder</h1>
        <p className={styles.subtitle}>
          Interactive learning paths to help you get the most out of Grafana. Pick up where you left off or start
          something new.
        </p>
      </header>

      <div className={styles.pathsGrid}>
        {paths.map((path) => (
          <PathCard
            key={path.id}
            path={path}
            guides={getPathGuides(path.id)}
            progress={getPathProgress(path.id)}
            completed={isPathCompleted(path.id)}
            onOpenGuide={handleOpenGuide}
          />
        ))}
      </div>
    </div>
  );
}
