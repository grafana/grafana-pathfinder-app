import type { AppPlugin } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { initializeFeatureFlags, isFeatureEnabled } from './utils/feature-flag.service';
import pluginJson from './plugin.json';
import { lazy } from 'react';

const LazyCustomDocsConfig = lazy(() => import('./components/AppConfig/CustomDocsConfig'));

export async function bootstrap(plugin: AppPlugin<any>) {
  // Initialize feature flags early using backend settings as a fallback
  // This ensures env/provisioned flags apply even if App/root isn't mounted yet
  try {
    const settings = await getBackendSrv().get(`/api/plugins/${pluginJson.id}/settings`);
    const features = settings?.jsonData?.features || '';
    initializeFeatureFlags(features);

    // Conditionally add Custom Docs config page based on feature flag
    const isCustomDocsEnabled = isFeatureEnabled('custom_docs');
    if (isCustomDocsEnabled) {
      plugin.addConfigPage({
        title: 'Custom Docs',
        body: LazyCustomDocsConfig,
        id: 'custom-docs-config',
      });
    }
  } catch (e) {
    console.warn('Bootstrap: unable to fetch plugin settings for feature flags', e);
    // Still try to initialize feature flags without backend settings
    try {
      initializeFeatureFlags('');
    } catch (initError) {
      console.warn('Bootstrap: failed to initialize feature flags', initError);
    }
  }
}
