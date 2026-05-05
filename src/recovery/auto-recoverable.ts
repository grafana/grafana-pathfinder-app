/**
 * Auto-recoverable requirement tokens.
 *
 * The runtime "Fix this" infrastructure can recover from a small,
 * well-defined set of unmet requirements (`exists-reftarget`,
 * `navmenu-open`, and any `on-page:` token). Authors who pick these
 * tokens get the strongest resilience guarantees, so the editor surfaces
 * them with an "Auto-recoverable" badge.
 *
 * This file is the single source of truth — both the runtime fix-handlers
 * and the editor's chip picker import from here so they can never drift.
 *
 * @see docs/design/AUTORECOVERY_DESIGN.md (Graduated recovery system)
 * @see src/requirements-manager/fix-handlers/
 */

import { FixedRequirementType, ParameterizedRequirementPrefix } from '../types/requirements.types';

/**
 * Tokens whose unmet state the runtime can resolve without user interaction
 * beyond clicking "Fix this".
 *
 * - `exists-reftarget`: handled by `lazy-scroll` and `expand-parent-navigation` fix types.
 * - `navmenu-open`: handled by the `navigation` fix type (open / dock the nav menu).
 * - `on-page:`: handled by the `location` fix type (navigate to the expected page).
 */
export const AUTO_RECOVERABLE_REQUIREMENT_TOKENS: ReadonlyArray<string> = Object.freeze([
  FixedRequirementType.EXISTS_REFTARGET,
  FixedRequirementType.NAVMENU_OPEN,
]);

/**
 * Parameterized prefixes that are auto-recoverable. Any token starting with
 * one of these strings can be auto-fixed at runtime.
 */
export const AUTO_RECOVERABLE_REQUIREMENT_PREFIXES: ReadonlyArray<string> = Object.freeze([
  ParameterizedRequirementPrefix.ON_PAGE,
]);

/**
 * Returns true if `token` is one the runtime can auto-recover from.
 *
 * Parameterized matching is by prefix (e.g. `on-page:/explore` matches
 * the `on-page:` prefix). Casing is significant — requirement tokens are
 * always lowercase by convention.
 */
export function isAutoRecoverableRequirement(token: string): boolean {
  if (AUTO_RECOVERABLE_REQUIREMENT_TOKENS.includes(token)) {
    return true;
  }
  return AUTO_RECOVERABLE_REQUIREMENT_PREFIXES.some((prefix) => token.startsWith(prefix));
}
