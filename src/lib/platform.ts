import { config } from '@grafana/runtime';

export type GrafanaPlatform = 'oss' | 'cloud';

/**
 * The platform this Grafana instance runs on: Grafana Cloud builds report a
 * "Grafana Cloud" version string. Fails soft to 'oss'.
 */
export function currentPlatform(): GrafanaPlatform {
  try {
    return config.bootData?.settings?.buildInfo?.versionString?.startsWith('Grafana Cloud') ? 'cloud' : 'oss';
  } catch {
    return 'oss';
  }
}
