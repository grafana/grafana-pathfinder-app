import { config } from '@grafana/runtime';

/** `user-<id>:org-<id>`, the key every per-person queue and cache is stored under. */
export function currentCompletionQueueOwnerKey(): string | null {
  const userId = config?.bootData?.user?.id;
  const orgId = config?.bootData?.user?.orgId;
  if (!Number.isInteger(userId) || Number(userId) <= 0 || !Number.isInteger(orgId) || Number(orgId) <= 0) {
    return null;
  }
  return `user-${userId}:org-${orgId}`;
}
