import { config } from '@grafana/runtime';

export function isCurrentUserEditor(): boolean {
  const user = config.bootData?.user;
  return user?.orgRole === 'Editor' || user?.orgRole === 'Admin' || user?.isGrafanaAdmin === true;
}
