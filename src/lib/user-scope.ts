import { config } from '@grafana/runtime';

export function getUserScope(): string {
  return `${config?.namespace ?? ''}:${config?.bootData?.user?.orgId ?? ''}:${config?.bootData?.user?.id ?? ''}`;
}
