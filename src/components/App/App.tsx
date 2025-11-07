import { AppRootProps } from '@grafana/data';
import React, { useMemo, useEffect } from 'react';
import { SceneApp } from '@grafana/scenes';
import { docsPage } from '../../pages/docsPage';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getConfigWithDefaults } from '../../constants';
import { onPluginStart } from '../../context-engine';
import { globalState } from '../../global-state/link-interception';

function getSceneApp() {
  return new SceneApp({
    pages: [docsPage],
  });
}

function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);

  // Get configuration
  const config = useMemo(() => getConfigWithDefaults(props.meta.jsonData || {}), [props.meta.jsonData]);

  // Set global config early for module-level utilities
  useEffect(() => {
    (window as any).__pathfinderPluginConfig = config;
  }, [config]);

  // SECURITY: Initialize plugin on mount (includes dev mode from server)
  useEffect(() => {
    onPluginStart();
  }, []);

  // Enable/disable global link interception based on config
  useEffect(() => {
    globalState.setInterceptionEnabled(config.interceptGlobalDocsLinks);
  }, [config.interceptGlobalDocsLinks]);

  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;
