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
    await ctx.navigationManager.fixLocationRequirement(ctx.targetHref);
    return { ok: true };
  },
};
