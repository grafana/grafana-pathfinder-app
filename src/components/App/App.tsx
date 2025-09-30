import { AppRootProps, NavModelItem } from '@grafana/data';
import React, { useMemo, useEffect } from 'react';
import { SceneApp } from '@grafana/scenes';
import { docsPage } from '../../pages/docsPage';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getConfigWithDefaults } from '../../constants';
import { CombinedLearningJourneyPanel } from '../docs-panel/docs-panel';
import { usePluginContext } from '@grafana/data';

function getSceneApp() {
  return new SceneApp({
    pages: [docsPage],
  });
}

export function MemoizedContextPanel({ helpNode }: { helpNode?: NavModelItem }) {
  const pluginContext = usePluginContext();
  const config = getConfigWithDefaults(pluginContext?.meta?.jsonData || {});
  const panel = useMemo(() => new CombinedLearningJourneyPanel(config, helpNode), [config, helpNode]);

  return <panel.Component model={panel} />;
}

function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);

  // Auto-launch tutorial if configured
  useEffect(() => {
    // Get configuration directly from plugin meta
    const config = getConfigWithDefaults(props.meta.jsonData || {});
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
  }, [props.meta.jsonData]);

  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;
