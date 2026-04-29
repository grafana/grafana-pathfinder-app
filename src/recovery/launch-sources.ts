/**
 * Launch source classification for the implied 0th step (initial-state alignment).
 *
 * When a guide is launched, the source determines whether we trust the launch
 * surface to have already aligned the user's current location with the guide's
 * `startingLocation`. If so, we skip the alignment prompt; otherwise, the
 * evaluator decides based on a path comparison.
 *
 * @see docs/design/AUTORECOVERY_DESIGN.md § "Launch context"
 */

/**
 * Sources whose launch surface guarantees the user is already on the right page,
 * or whose initiator (an agent, a recovery flow) is responsible for context.
 * No alignment prompt is shown for these.
 */
export const ALIGNED_BY_CONSTRUCTION_SOURCES: ReadonlySet<string> = new Set([
  // Recommender clicks bypass auto-launch-tutorial entirely (they call
  // openDocsPage directly via ContextPanel callbacks). Listed here defensively
  // in case that flow ever changes.
  'recommender',
  // User was mid-tutorial; restoring their state shouldn't second-guess location.
  'browser_restore',
  // Agents (MCP) coordinate their own context.
  'mcp_launch',
  // Step-1 navigate actions land us on the right page already.
  'navigate-action',
  // Grot guide block surfaces are already URL-filtered like the recommender.
  'grot_guide_block',
  // Experiment treatments and auto-opens already coordinate location.
  'experiment_treatment',
  'experiment_treatment_navigation',
  'auto_open',
  // Floating panel docking back to sidebar — tab already exists.
  'floating_panel_dock',
]);

/**
 * Sources known to need alignment evaluation (documents the v1 set).
 * This set is informational — the classifier defaults unknown sources to
 * "needs check", so adding a new source here is not required for the prompt
 * to fire on it.
 */
export const NEEDS_ALIGNMENT_CHECK_SOURCES: ReadonlySet<string> = new Set([
  'home_page',
  'url_param',
  'command_palette',
  'command_palette_help',
  'command_palette_learn',
  'external_suggestion',
  'link_interception',
  'queued_link',
  'content_link',
]);

/**
 * True if the launch source means "the surface already established the right
 * context." Unknown sources return false (default to evaluating alignment),
 * which is the safer direction — at worst we show a prompt the user dismisses.
 */
export function isAlignedByConstruction(source: string | undefined): boolean {
  if (!source) {
    return false;
  }
  return ALIGNED_BY_CONSTRUCTION_SOURCES.has(source);
}
