import { expandParentNavigationHandler } from './expand-parent-navigation';
import { locationHandler } from './location';
import { expandOptionsGroupHandler } from './expand-options-group';
import { navigationHandler } from './navigation';
import type { FixHandler } from './types';

/**
 * Fix handler registry.
 *
 * Order matters: handlers are tried in sequence and the first whose `canHandle`
 * returns true wins. Specific-fixType handlers come first; the catch-all
 * `navigationHandler` comes last because it also accepts the legacy
 * `requirements.includes('navmenu-open')` fallback.
 */
export const FIX_HANDLERS: readonly FixHandler[] = [
  expandParentNavigationHandler,
  locationHandler,
  expandOptionsGroupHandler,
  navigationHandler,
];

export type { FixContext, FixHandler, FixHandlerNavigationManager, FixResult } from './types';
