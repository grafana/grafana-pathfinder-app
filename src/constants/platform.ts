import { config } from '@grafana/runtime';

export type GrafanaPlatform = 'oss' | 'cloud';

const CLOUD_NAMESPACE = /^stacks-\d+$/;

// The namespace is checked too because it is the one boot field multi-tenant Grafana must get right.
export function currentPlatform(): GrafanaPlatform {
  try {
    const cloudBuild = config.buildInfo?.versionString?.startsWith('Grafana Cloud') === true;
    return cloudBuild || CLOUD_NAMESPACE.test(config.namespace ?? '') ? 'cloud' : 'oss';
  } catch {
    return 'oss';
  }
}
