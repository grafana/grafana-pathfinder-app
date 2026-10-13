export interface DashboardCondition {
  kind: 'group-by' | 'filter-absent';
  dashboardUid: string;
  variable: string;
  key: string;
}

export function parseDashboardCondition(token: string): DashboardCondition | null {
  const match = /^(dashboard-group-by|dashboard-filter-absent):([\w-]+):([\w-]+):([\w-]+)$/.exec(token);
  if (!match) {
    return null;
  }
  return {
    kind: match[1] === 'dashboard-group-by' ? 'group-by' : 'filter-absent',
    dashboardUid: match[2]!,
    variable: match[3]!,
    key: match[4]!,
  };
}
