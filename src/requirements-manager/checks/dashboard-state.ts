import { locationService } from '@grafana/runtime';
import { parseDashboardCondition, type DashboardCondition } from '../../lib/dashboard-condition';
import { isElementVisible } from '../../lib/dom/element-validator';
import type { CheckResultError } from '../../types/requirements.types';
import { FIX_TYPES } from '../fix-types';

function readDashboardState(condition: DashboardCondition) {
  const location = locationService.getLocation();
  const uid = /(?:^|\/)d\/([^/]+)(?:\/|$)/.exec(location.pathname)?.[1];
  if (uid !== condition.dashboardUid) {
    return null;
  }
  const labels = document.querySelectorAll<HTMLElement>(
    `[data-testid="data-testid Dashboard template variables submenu Label ${condition.variable}"]`
  );
  if (labels.length !== 1) {
    return null;
  }
  const container = labels[0]!.closest<HTMLElement>('[data-testid="data-testid template variable"]');
  const input = Array.from(container?.querySelectorAll('input') ?? []).find(
    (element) => element.placeholder === '+ key'
  );
  if (!container || !input || !isElementVisible(input) || input.disabled) {
    return null;
  }
  const params = new URLSearchParams(location.search);
  const variableParam = `var-${condition.variable}`;
  const values = params.getAll(variableParam).filter(Boolean);
  const groupKeys = Array.from(container.querySelectorAll('[aria-label^="Group by "]')).map((element) =>
    element.getAttribute('aria-label')!.slice('Group by '.length)
  );
  const filterKeys = Array.from(container.querySelectorAll('[aria-label^="Remove filter with key "]')).map((element) =>
    element.getAttribute('aria-label')!.slice('Remove filter with key '.length)
  );
  return { values, groupKeys, filterKeys, hasUrlState: params.has(variableParam) };
}

function canPreserveState(state: NonNullable<ReturnType<typeof readDashboardState>>) {
  return (
    state.groupKeys.every((key) => state.values.includes(`${key}|groupBy`)) &&
    state.filterKeys.every((key) =>
      state.values.some((value) => value.startsWith(`${key}|`) && value !== `${key}|groupBy`)
    )
  );
}

export async function dashboardStateCheck(requirement: string): Promise<CheckResultError> {
  const condition = parseDashboardCondition(requirement);
  if (!condition) {
    return { requirement, pass: false, verdict: 'invalid', error: 'Invalid dashboard state condition.' };
  }
  const state = readDashboardState(condition);
  if (!state) {
    return {
      requirement,
      pass: false,
      verdict: 'unavailable',
      error: 'Return to the guide dashboard and wait for its filter controls to load.',
    };
  }
  if (condition.kind === 'filter-absent') {
    const pass =
      !state.filterKeys.includes(condition.key) &&
      !state.values.some((value) => value.startsWith(`${condition.key}|`) && value !== `${condition.key}|groupBy`);
    const canFix = !pass && canPreserveState(state);
    return {
      requirement,
      pass,
      canFix,
      fixType: canFix ? FIX_TYPES.DASHBOARD_STATE : undefined,
      error: pass ? undefined : `Remove the ${condition.key} filter to continue.`,
    };
  }
  const inUrl = state.values.includes(`${condition.key}|groupBy`);
  const inControls = state.groupKeys.includes(condition.key);
  const pass = inControls && (inUrl || !state.hasUrlState);
  const canFix = !inUrl && !inControls && canPreserveState(state);
  return {
    requirement,
    pass,
    canFix,
    verdict: pass ? 'satisfied' : canFix ? 'unsatisfied' : 'unavailable',
    fixType: canFix ? FIX_TYPES.DASHBOARD_STATE : undefined,
    error: pass
      ? undefined
      : canFix
        ? `The ${condition.key} grouping was cleared. Restore it to continue; your guide progress is saved.`
        : 'Wait for the dashboard filter controls to finish updating, then check again.',
  };
}

export function restoreDashboardState(requirement: string): boolean {
  const condition = parseDashboardCondition(requirement);
  if (!condition) {
    return false;
  }
  const state = readDashboardState(condition);
  if (!state || !canPreserveState(state)) {
    return false;
  }
  const group = `${condition.key}|groupBy`;
  const values =
    condition.kind === 'group-by'
      ? state.values.includes(group)
        ? state.values
        : [...state.values, group]
      : state.values.filter((value) => !value.startsWith(`${condition.key}|`) || value === group);
  if (values.join('\n') !== state.values.join('\n')) {
    locationService.partial({ [`var-${condition.variable}`]: values.length ? values : '' });
  }
  return true;
}
