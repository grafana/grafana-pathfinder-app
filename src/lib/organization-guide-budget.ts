export const ORGANIZATION_GUIDE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const ORGANIZATION_GUIDE_MAX_OPENINGS = 3;

export interface OrganizationGuideBudget {
  count: number;
  lastOpenedAt: number;
  completed: boolean;
}

export function organizationGuideBudgetKey(namespace: string, userId: string, guideId: string): string {
  return `grafana-pathfinder:organization-guide:${JSON.stringify([namespace, userId, guideId])}`;
}

export function readOrganizationGuideBudget(storage: Storage, key: string): OrganizationGuideBudget | null {
  try {
    const raw = storage.getItem(key);
    if (raw === null) {
      return { count: 0, lastOpenedAt: 0, completed: false };
    }
    const value = JSON.parse(raw);
    return Number.isInteger(value?.count) &&
      value.count >= 0 &&
      value.count <= ORGANIZATION_GUIDE_MAX_OPENINGS &&
      Number.isFinite(value.lastOpenedAt) &&
      value.lastOpenedAt >= 0 &&
      typeof value.completed === 'boolean'
      ? value
      : null;
  } catch {
    return null;
  }
}

export function writeOrganizationGuideBudget(storage: Storage, key: string, value: OrganizationGuideBudget): boolean {
  try {
    const raw = JSON.stringify(value);
    storage.setItem(key, raw);
    return storage.getItem(key) === raw;
  } catch {
    return false;
  }
}

export function canIntroduceOrganizationGuide(budget: OrganizationGuideBudget, now: number): boolean {
  return (
    !budget.completed &&
    budget.count < ORGANIZATION_GUIDE_MAX_OPENINGS &&
    (budget.count === 0 || now - budget.lastOpenedAt >= ORGANIZATION_GUIDE_COOLDOWN_MS)
  );
}
