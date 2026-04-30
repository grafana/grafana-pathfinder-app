import { FIX_TYPES } from '../fix-types';
import { INTERACTIVE_CONFIG } from '../../constants/interactive-config';
import type { FixHandler } from './types';

const COLLAPSED_OPTIONS_GROUP_SELECTOR = 'button[data-testid*="Options group"][aria-expanded="false"]';

/**
 * Click open every collapsed Options group toggle in the Grafana panel editor.
 * Required because Grafana conditionally renders child controls only when the
 * group is expanded — so a step's reftarget can't exist until the parent
 * panel is open.
 */
export const expandOptionsGroupHandler: FixHandler = {
  fixType: FIX_TYPES.EXPAND_OPTIONS_GROUP,
  canHandle: (ctx) => ctx.fixType === FIX_TYPES.EXPAND_OPTIONS_GROUP,
  execute: async () => {
    const collapsedToggles = document.querySelectorAll(
      COLLAPSED_OPTIONS_GROUP_SELECTOR
    ) as NodeListOf<HTMLButtonElement>;
    for (const toggle of collapsedToggles) {
      toggle.click();
    }
    // Allow React to render the newly expanded children before the post-fix recheck.
    await new Promise((resolve) => setTimeout(resolve, INTERACTIVE_CONFIG.delays.navigation.expansionAnimationMs));
    return { ok: true };
  },
};
