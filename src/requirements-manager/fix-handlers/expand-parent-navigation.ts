import { FIX_TYPES } from '../fix-types';
import type { FixHandler } from './types';

/**
 * Expand a collapsed parent navigation section so the desired nav child becomes
 * visible. Triggered when `reftargetExistsCheck` detects a Nav menu item nested
 * under a collapsed section.
 */
export const expandParentNavigationHandler: FixHandler = {
  fixType: FIX_TYPES.EXPAND_PARENT_NAVIGATION,
  canHandle: (ctx) => ctx.fixType === FIX_TYPES.EXPAND_PARENT_NAVIGATION && !!ctx.targetHref && !!ctx.navigationManager,
  execute: async (ctx) => {
    if (!ctx.targetHref || !ctx.navigationManager) {
      return { ok: false, error: 'Missing targetHref or navigationManager' };
    }
    const success = await ctx.navigationManager.expandParentNavigationSection(ctx.targetHref);
    if (!success) {
      return { ok: false, error: 'Failed to expand parent navigation section' };
    }
    return { ok: true };
  },
};
