import { config } from '@grafana/runtime';

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function currentUserIdentity(): { id?: number; orgId?: number; isSignedIn: boolean } {
  const user = config?.bootData?.user;
  return {
    id: positiveInteger(user?.id),
    orgId: positiveInteger(user?.orgId),
    isSignedIn: user?.isSignedIn === true,
  };
}
