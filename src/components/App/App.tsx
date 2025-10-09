import { AppRootProps } from '@grafana/data';
import React, { useMemo, useEffect } from 'react';
import { SceneApp } from '@grafana/scenes';
import { docsPage } from '../../pages/docsPage';
import { ContextPanelComponent } from '../../utils/docs.utils';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getConfigWithDefaults } from '../../constants';

function getSceneApp() {
  return new SceneApp({
    pages: [docsPage],
  });
}

export function MemoizedContextPanel() {
  return <ContextPanelComponent />;
}

function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);

  // Get configuration
  const config = useMemo(() => getConfigWithDefaults(props.meta.jsonData || {}), [props.meta.jsonData]);

  // Auto-launch tutorial if configured
  useEffect(() => {
    const tutorialUrl = config.tutorialUrl;

    if (tutorialUrl && tutorialUrl.trim()) {
      // Small delay to ensure the app is fully loaded
      setTimeout(() => {
        try {
          // Determine if it's a learning journey or docs page
          const isLearningJourney = tutorialUrl.includes('/learning-journeys/');

          // Dispatch a custom event to trigger the docs panel to open and load the tutorial
          const event = new CustomEvent('auto-launch-tutorial', {
            detail: {
              url: tutorialUrl,
              type: isLearningJourney ? 'learning-journey' : 'docs-page',
              title: isLearningJourney ? 'Auto-launched Learning Journey' : 'Auto-launched Documentation',
            },
          });

          document.dispatchEvent(event);
        } catch (error) {
          console.error('Error in auto-launch tutorial:', error);
        }
      }, 1000); // 1 second delay to ensure everything is loaded
    }
  }, [config.tutorialUrl]);

  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;
