import { FIX_TYPES } from '../fix-types';
import type { FixHandler } from './types';

/**
 * Open and dock the Grafana navigation menu. Owns the `navmenu-open` legacy
 * fallback: even if the failing check didn't return a fixType, a step whose
 * requirements include `navmenu-open` falls into this handler.
 *
 * This is the only handler that knows about a specific requirement string —
 * deliberately, so the check layer (`check-phases.ts`) doesn't have to.
 */
export const navigationHandler: FixHandler = {
  fixType: FIX_TYPES.NAVIGATION,
  canHandle: (ctx) => ctx.fixType === FIX_TYPES.NAVIGATION || !!ctx.requirements?.includes('navmenu-open'),
  execute: async (ctx) => {
    await ctx.fixNavigationRequirements();
    return { ok: true };
  },
};
