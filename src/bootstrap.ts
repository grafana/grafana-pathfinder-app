import type { AppPlugin } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { initializeFeatureFlags } from './utils/feature-flag.service';
import pluginJson from './plugin.json';

export function bootstrap(plugin: AppPlugin<any>) {
  // Initialize feature flags early using backend settings as a fallback
  // This ensures env/provisioned flags apply even if App/root isn't mounted yet
  try {
    getBackendSrv()
      .get(`/api/plugins/${pluginJson.id}/settings`)
      .then((settings: any) => {
        const features = settings?.jsonData?.features || '';
        initializeFeatureFlags(features);
      })
      .catch((e: any) => {
        console.warn('Bootstrap: unable to fetch plugin settings for feature flags', e);
      });
  } catch (e) {
    console.warn('Bootstrap: failed to initialize feature flags', e);
  }
}
