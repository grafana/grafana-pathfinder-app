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
 * Exhaustive union of every known launch source. Adding a new launch surface?
 * Add the literal here AND classify it in one of the two sets below.
 *
 * Why a union (and not just `string`): the consume-once `_pendingLaunchSource`
 * carrier on `CombinedLearningJourneyPanel` was originally typed as
 * `string | null`, which let any caller stash an arbitrary literal. Typos
 * (`'recommander'`) would silently default to "needs check" and produce
 * spurious alignment prompts that are hard to reproduce. Treating
 * `LaunchSource` as a closed union makes the compiler enforce the contract.
 */
export type LaunchSource =
  // Aligned-by-construction
  | 'recommender'
  | 'browser_restore'
  | 'internal_reload'
  | 'mcp_launch'
  | 'navigate-action'
  | 'grot_guide_block'
  | 'experiment_treatment'
  | 'experiment_treatment_navigation'
  | 'auto_open'
  | 'floating_panel_dock'
  | 'live_session_attendee'
  | 'devtools'
  // Needs alignment check
  | 'home_page'
  | 'url_param'
  // Deep-link surface (`?doc=foo&source=learning-hub`). Also doubles as a
  // routing flag in the auto-launch handlers (`source === 'learning-hub'`
  // forces `openLearningJourney`). Same alignment semantics as `url_param`:
  // the URL navigates the user to whatever path it encodes, which may or
  // may not match the guide's `startingLocation`.
  | 'learning-hub'
  | 'command_palette'
  | 'command_palette_help'
  | 'command_palette_learn'
  | 'external_suggestion'
  | 'link_interception'
  | 'queued_link'
  | 'content_link'
  | 'location_change'
  // Editor authoring (also needs alignment check)
  | 'block_editor_preview'
  | 'custom_guide';

/**
 * Sources whose launch surface guarantees the user is already on the right page,
 * or whose initiator (an agent, a recovery flow) is responsible for context.
 * No alignment prompt is shown for these.
 */
export const ALIGNED_BY_CONSTRUCTION_SOURCES: ReadonlySet<LaunchSource> = new Set<LaunchSource>([
  // Recommender clicks tag with this source via the ContextPanel callbacks
  // wired in `CombinedLearningJourneyPanel.constructor`.
  'recommender',
  // User was mid-tutorial; restoring their state shouldn't second-guess location.
  'browser_restore',
  // Internal reloads of an already-open tab (reset guide progress, error retry,
  // dev-mode refresh). The user is already viewing this guide — re-running
  // the fetch shouldn't surface a fresh alignment prompt on top of the
  // reloaded content. The existing on-page `Fix this` flow still handles
  // misalignment when step 1 mounts.
  'internal_reload',
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
  // Live session attendees follow the presenter's coordinated location.
  'live_session_attendee',
  // Dev tools surface — power-user; don't prompt during selector work.
  'devtools',
]);

/**
 * Sources known to need alignment evaluation (documents the v1 set).
 * This set is informational — the classifier defaults unknown sources to
 * "needs check", so adding a new source here is not required for the prompt
 * to fire on it.
 */
export const NEEDS_ALIGNMENT_CHECK_SOURCES: ReadonlySet<LaunchSource> = new Set<LaunchSource>([
  'home_page',
  'url_param',
  'learning-hub',
  'command_palette',
  'command_palette_help',
  'command_palette_learn',
  'external_suggestion',
  'link_interception',
  'queued_link',
  'content_link',
  'block_editor_preview',
  'custom_guide',
  // Reactive re-evaluation on location change while the user has no progress yet.
  'location_change',
]);

/**
 * True if the launch source means "the surface already established the right
 * context." Unknown sources return false (default to evaluating alignment),
 * which is the safer direction — at worst we show a prompt the user dismisses.
 *
 * Accepts `string` (not just `LaunchSource`) because the source flows in from
 * untyped event payloads (`event.detail.source`) and persisted MCP state.
 */
export function isAlignedByConstruction(source: string | undefined): boolean {
  if (!source) {
    return false;
  }
  return (ALIGNED_BY_CONSTRUCTION_SOURCES as ReadonlySet<string>).has(source);
}

/** Set of all known LaunchSource values (union of the two classifier sets). */
const KNOWN_LAUNCH_SOURCES: ReadonlySet<string> = new Set<LaunchSource>([
  ...ALIGNED_BY_CONSTRUCTION_SOURCES,
  ...NEEDS_ALIGNMENT_CHECK_SOURCES,
]);

/**
 * Narrow an arbitrary string from an event payload (or persisted state) to
 * a typed `LaunchSource`. Returns `null` for unknown values so the caller's
 * downstream logic falls through to the safe "needs check" default rather
 * than passing typo'd literals into the model.
 *
 * Use this at any boundary where source originates from untyped JSON or a
 * `CustomEvent.detail` field.
 */
export function coerceLaunchSource(source: string | null | undefined): LaunchSource | null {
  if (!source) {
    return null;
  }
  return KNOWN_LAUNCH_SOURCES.has(source) ? (source as LaunchSource) : null;
}
