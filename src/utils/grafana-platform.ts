import { config } from '@grafana/runtime';

/** Whether this Grafana is a Cloud stack. `context.service.ts` still derives this inline. */
export function isGrafanaCloud(): boolean {
  return Boolean(config.bootData?.settings?.buildInfo?.versionString?.startsWith('Grafana Cloud'));
}
