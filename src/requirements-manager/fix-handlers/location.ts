import { FIX_TYPES } from '../fix-types';
import type { FixHandler } from './types';

/**
 * Navigate the browser to the page the step expects (`on-page:` requirement).
 * `targetHref` is the path returned by `onPageCheck` when the current location
 * doesn't match.
 */
export const locationHandler: FixHandler = {
  fixType: FIX_TYPES.LOCATION,
  canHandle: (ctx) => ctx.fixType === FIX_TYPES.LOCATION && !!ctx.targetHref && !!ctx.navigationManager,
  execute: async (ctx) => {
    if (!ctx.targetHref || !ctx.navigationManager) {
      return { ok: false, error: 'Missing targetHref or navigationManager' };
    }
    const success = await ctx.navigationManager.fixLocationRequirement(ctx.targetHref);
    if (!success) {
      return { ok: false, error: 'Location requirement target is not allowed' };
    }
    return { ok: true };
  },
};
