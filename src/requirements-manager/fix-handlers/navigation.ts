import { FIX_TYPES } from '../fix-types';
import type { FixHandler } from './types';

/**
 * Open and dock the Grafana navigation menu.
 *
 * Matches strictly on `fixType === 'navigation'`. The failing-check produces
 * the fixType (see `navmenuOpenCheck` in `src/lib/dom/dom-utils.ts`), so the
 * registry never sees an undefined fixType for this case in production.
 */
export const navigationHandler: FixHandler = {
  fixType: FIX_TYPES.NAVIGATION,
  canHandle: (ctx) => ctx.fixType === FIX_TYPES.NAVIGATION,
  execute: async (ctx) => {
    await ctx.fixNavigationRequirements();
    return { ok: true };
  },
};
