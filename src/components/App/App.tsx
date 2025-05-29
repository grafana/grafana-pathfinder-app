import { AppRootProps } from '@grafana/data';
import React, { useMemo } from 'react';
import { SceneApp } from '@grafana/scenes';
import { docsPage } from '../../pages/docsPage';
import { DocsPanelComponent } from '../../utils/docs.utils';
import { PluginPropsContext } from '../../utils/utils.plugin';

function getSceneApp() {
  return new SceneApp({
    pages: [docsPage],
  });
}

export function MemoizedDocsPanel() {
  return <DocsPanelComponent />;
}

function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);
  
  return (
    <PluginPropsContext.Provider value={props}>
      <scene.Component model={scene} />
    </PluginPropsContext.Provider>
  );
}

export default App;