import { AppRootProps } from '@grafana/data';
import React, { useMemo, useEffect } from 'react';
import { SceneApp } from '@grafana/scenes';
import { docsPage } from '../../pages/docsPage';
import { PluginPropsContext } from '../../utils/utils.plugin';
import { getConfigWithDefaults, ALLOWED_GITHUB_REPOS } from '../../constants';
import { setGlobalLinkInterceptionEnabled } from '../../module';
import {
  parseUrlSafely,
  isAllowedContentUrl,
  isAllowedGitHubRawUrl,
  isGitHubUrl,
  isGitHubRawUrl,
  isLocalhostUrl,
} from '../../utils/url-validator';
import { onPluginStart } from '../../utils/context';
import { isDevModeEnabledGlobal } from '../../utils/dev-mode';

function getSceneApp() {
  return new SceneApp({
    pages: [docsPage],
  });
}

function App(props: AppRootProps) {
  const scene = useMemo(() => getSceneApp(), []);

  // Get configuration
  const config = useMemo(() => getConfigWithDefaults(props.meta.jsonData || {}), [props.meta.jsonData]);

  // SECURITY: Initialize plugin on mount (includes dev mode from server)
  useEffect(() => {
    onPluginStart();
  }, []);

  // Enable/disable global link interception based on config
  useEffect(() => {
    setGlobalLinkInterceptionEnabled(config.interceptGlobalDocsLinks);
  }, [config.interceptGlobalDocsLinks]);

  // Auto-launch tutorial if configured
  useEffect(() => {
    const tutorialUrl = config.tutorialUrl;

    if (tutorialUrl && tutorialUrl.trim()) {
      // SECURITY (F6): Validate tutorial URL for security (user-configurable setting)
      // Must match the same validation as content-fetcher, docs-panel, link-handler, global-link-interceptor, and module
      // In production: Grafana docs, bundled content, and approved GitHub repos
      // In dev mode: Also allows any GitHub URLs and localhost URLs for testing
      const isValidUrl =
        isAllowedContentUrl(tutorialUrl) ||
        isAllowedGitHubRawUrl(tutorialUrl, ALLOWED_GITHUB_REPOS) ||
        isGitHubUrl(tutorialUrl) ||
        (isDevModeEnabledGlobal() && (isLocalhostUrl(tutorialUrl) || isGitHubRawUrl(tutorialUrl)));

      if (!isValidUrl) {
        console.error('Invalid tutorial URL in configuration:', tutorialUrl);
        return;
      }

      // Small delay to ensure the app is fully loaded
      setTimeout(() => {
        try {
          // Determine if it's a learning journey or docs page using secure URL parsing
          const urlObj = parseUrlSafely(tutorialUrl);
          const isLearningJourney = urlObj?.pathname.includes('/learning-journeys/') || false;

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
