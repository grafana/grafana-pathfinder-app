import { AppRootProps } from '@grafana/data';
import React, { useMemo, useEffect } from 'react';
import { SceneApp } from '@grafana/scenes';
import { docsPage } from '../../pages/docsPage';
import { ContextPanelComponent } from '../../utils/docs.utils';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getTutorialUrl, ConfigService } from '../../constants';

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
  
  // Auto-launch tutorial if configured
  useEffect(() => {
    console.log('🎓 App useEffect triggered with props.meta.jsonData:', props.meta.jsonData);
    
    // Update configuration service with plugin metadata
    if (props.meta.jsonData) {
      console.log('🔧 Setting config with jsonData:', props.meta.jsonData);
      ConfigService.setConfig(props.meta.jsonData);
    } else {
      console.warn('⚠️ No jsonData found in props.meta');
    }
    
    // Check if a tutorial URL is configured for auto-launch
    const tutorialUrl = getTutorialUrl();
    console.log('🎓 Tutorial URL from config:', tutorialUrl);
    console.log('🎓 Full config:', ConfigService.getConfig());
    
    if (tutorialUrl && tutorialUrl.trim()) {
      console.log('🎓 Auto-launching tutorial:', tutorialUrl);
      
      // Small delay to ensure the app is fully loaded
      setTimeout(() => {
        try {
          // Determine if it's a learning journey or docs page
          const isLearningJourney = tutorialUrl.includes('/learning-journeys/');
          
          console.log('🎓 Tutorial type detected:', isLearningJourney ? 'learning-journey' : 'docs-page');
          
          // Dispatch a custom event to trigger the docs panel to open and load the tutorial
          const event = new CustomEvent('auto-launch-tutorial', {
            detail: {
              url: tutorialUrl,
              type: isLearningJourney ? 'learning-journey' : 'docs-page',
              title: isLearningJourney ? 'Auto-launched Learning Journey' : 'Auto-launched Documentation'
            }
          });
          
          console.log('🎓 Dispatching auto-launch-tutorial event:', event.detail);
          document.dispatchEvent(event);
        } catch (error) {
          console.error('Failed to auto-launch tutorial:', error);
        }
      }, 1000); // 1 second delay to ensure everything is loaded
    } else {
      console.log('🎓 No tutorial URL configured for auto-launch');
    }
  }, [props.meta.jsonData]);
  
  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;
