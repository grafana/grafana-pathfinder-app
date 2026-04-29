import { expandParentNavigationHandler } from './expand-parent-navigation';
import { locationHandler } from './location';
import { expandOptionsGroupHandler } from './expand-options-group';
import { navigationHandler } from './navigation';
import type { FixHandler } from './types';

/**
 * Fix handler registry.
 *
 * Order matters: handlers are tried in sequence and the first whose `canHandle`
 * returns true wins. Each handler matches strictly on `fixType`; ordering only
 * matters as a defensive guarantee that more-specific handlers run before
 * `navigationHandler` if multiple ever claimed the same fixType.
 */
export const FIX_HANDLERS: readonly FixHandler[] = [
  expandParentNavigationHandler,
  locationHandler,
  expandOptionsGroupHandler,
  navigationHandler,
];

export type { FixContext, FixHandler, FixHandlerNavigationManager, FixResult } from './types';
