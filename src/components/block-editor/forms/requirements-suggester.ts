/**
 * Requirements Suggester
 *
 * Utility functions for auto-suggesting default requirements based on
 * action types and selector patterns in the block builder.
 *
 * Two flavours:
 *   1. `suggestDefaultRequirements(action, reftarget)` — minimal, always-applied
 *      suggestions. Used by the silent-injection paths (DOM picker, action change)
 *      where the inference is unambiguous and adding the requirement is safe.
 *   2. `suggestRequirementsFromContext(action, reftarget, context)` — richer,
 *      context-aware suggestions surfaced explicitly in the form. These are
 *      proposed (not silently injected) so the author keeps agency.
 */

/**
 * Suggests default requirements based on action type and selector pattern.
 * Returns an array of requirement strings to ADD (caller merges with existing).
 *
 * Current rules (silent injection — used by DOM picker / action-change handler):
 * - Highlight actions → exists-reftarget (element must exist to highlight)
 * - Nav menu selectors → navmenu-open (menu must be open to find items)
 */
export function suggestDefaultRequirements(action: string, reftarget: string): string[] {
  const suggestions: string[] = [];

  // Highlight actions should verify element exists before attempting to highlight
  if (action === 'highlight') {
    suggestions.push('exists-reftarget');
  }

  // Nav menu selectors need menu to be open to find the target element
  if (isNavMenuSelector(reftarget)) {
    suggestions.push('navmenu-open');
  }

  return suggestions;
}

/**
 * Checks if a selector targets navigation menu elements.
 * Detects common Grafana navigation patterns.
 */
function isNavMenuSelector(selector: string): boolean {
  if (!selector) {
    return false;
  }

  // Standard Grafana nav menu item selector
  if (selector.includes('data-testid Nav menu item')) {
    return true;
  }

  // Navigation mega-menu container
  if (selector.includes('navigation mega-menu')) {
    return true;
  }

  return false;
}

/**
 * Context for richer requirement inference. Caller threads through what it
 * knows about the block's position in the guide so suggestions can be
 * action- AND structure-aware.
 */
export interface SuggestRequirementsContext {
  /** True iff this block is the first executable block in the top-level `guide.blocks` array. */
  isFirstStepInGuide: boolean;
  /** True iff this block is being edited as a step inside a multistep / guided block. */
  isInsideMultistep: boolean;
  /**
   * The runtime path the user is currently viewing — used to seed `on-page:` suggestions.
   * Pass `window.location.pathname`. Empty / `/` means "no useful current page".
   */
  currentPath?: string;
}

/**
 * Returns the *enriched* set of suggested requirements for a block.
 * Includes everything from `suggestDefaultRequirements` plus context-aware
 * additions:
 *
 * - First step + DOM-targeting action (highlight/button/formfill/hover)
 *   → suggest `on-page:<currentPath>` so the guide self-declares its
 *   starting page (the "implied 0th step" alignment from the autorecovery
 *   design doc). Skipped when `currentPath` is empty / `/`.
 * - `formfill` action (any position) → suggest `on-page:<currentPath>`,
 *   since forms are intrinsically page-bound.
 * - Nav-menu reftarget → also suggest `exists-reftarget` (silent
 *   injection already adds `navmenu-open`; we additionally surface
 *   `exists-reftarget` because the doc's "self-navigating guide"
 *   pattern is the most resilient).
 * - Inside a multistep, only the first step gets `on-page:` suggestions
 *   (later steps inherit the page context from their parent block).
 */
export function suggestRequirementsFromContext(
  action: string,
  reftarget: string,
  context: SuggestRequirementsContext
): string[] {
  const suggestions = new Set<string>();

  // Start from the unambiguous silent-injection set so callers don't
  // need to merge two lists.
  for (const r of suggestDefaultRequirements(action, reftarget)) {
    suggestions.add(r);
  }

  const targetsDom = ['highlight', 'button', 'formfill', 'hover'].includes(action);
  const useCurrentPath = context.currentPath && context.currentPath !== '/' ? context.currentPath : null;

  // First-step page-context suggestion. Only fires for DOM-targeting
  // actions; `navigate` blocks set their own location so they don't need it.
  // Skip inside multistep bodies — only the parent multistep block (treated
  // as a single step at the guide level) should get this suggestion.
  if (context.isFirstStepInGuide && targetsDom && useCurrentPath && !context.isInsideMultistep) {
    suggestions.add(`on-page:${useCurrentPath}`);
  }

  // Forms are page-bound regardless of position.
  if (action === 'formfill' && useCurrentPath && !context.isInsideMultistep) {
    suggestions.add(`on-page:${useCurrentPath}`);
  }

  // Nav-menu reftarget → also recommend `exists-reftarget` even when the
  // action isn't `highlight`. `navmenu-open` is already silent-injected.
  if (isNavMenuSelector(reftarget) && targetsDom) {
    suggestions.add('exists-reftarget');
  }

  return Array.from(suggestions);
}

/**
 * Merges suggested requirements into an existing requirements string.
 * Avoids duplicates and preserves existing requirements.
 *
 * @param existing - Current requirements string (comma-separated)
 * @param suggestions - Array of requirements to add
 * @returns Updated requirements string with suggestions merged in
 */
export function mergeRequirements(existing: string, suggestions: string[]): string {
  const current = existing
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);

  const toAdd = suggestions.filter((s) => !current.includes(s));

  if (toAdd.length === 0) {
    return existing;
  }

  return [...current, ...toAdd].join(', ');
}
