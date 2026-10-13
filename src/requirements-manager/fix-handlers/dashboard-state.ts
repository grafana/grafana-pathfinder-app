import { conditionTokens } from '../../lib/condition-input';
import { restoreDashboardState } from '../checks/dashboard-state';
import { FIX_TYPES } from '../fix-types';
import type { FixHandler } from './types';

export const dashboardStateHandler: FixHandler = {
  fixType: FIX_TYPES.DASHBOARD_STATE,
  canHandle: (ctx) => ctx.fixType === FIX_TYPES.DASHBOARD_STATE,
  execute: async (ctx) => {
    const conditions = conditionTokens(ctx.requirements).filter(
      (token) => token.startsWith('dashboard-group-by:') || token.startsWith('dashboard-filter-absent:')
    );
    if (conditions.length === 0 || !conditions.every(restoreDashboardState)) {
      return { ok: false, error: 'The dashboard changed. Return to the guide dashboard and try again.' };
    }
    return { ok: true };
  },
};
