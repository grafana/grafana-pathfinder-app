/**
 * Centralized contract for Pathfinder deep-link query parameters.
 *
 * Why this exists: the `?doc` / `?type` / `?source` / `?page` / `?kiosk_session`
 * / `?panelMode` parameters are read in multiple places (`module.tsx`, the
 * full-screen URL fallback) and stripped after consumption in three places
 * inside `module.tsx`. Share URLs are built independently in
 * `FullScreenLayout`, `FloatingPanel`, `KioskTile`, and the sidebar/floating
 * "switch to fullscreen" handlers. Drift between these copies has produced
 * real bugs (e.g. floating "copy link" used to omit `type=learning-journey`,
 * misclassifying journey package URLs on the receiving side).
 *
 * This module is the single source of truth: the param names live in one
 * constant, parsing returns a typed shape, and the share-URL builder enforces
 * the `type=learning-journey` rule once.
 *
 * SECURITY: builds URLs through the `URL` Web API (per F4) and never
 * concatenates strings. Only callers' typed inputs reach
 * `searchParams.set` — no user-controlled keys are ever set.
 */

export const PATHFINDER_PARAMS = ['doc', 'type', 'source', 'page', 'kiosk_session', 'panelMode', 'readonly'] as const;
export type PathfinderParam = (typeof PATHFINDER_PARAMS)[number];

// Subset of PATHFINDER_PARAMS that activate the deep-link handler
export const PATHFINDER_ACTIVATION_PARAMS = [
  'doc',
  'panelMode',
  'kiosk_session',
] as const satisfies readonly PathfinderParam[];
export type PathfinderTriggerParam = (typeof PATHFINDER_ACTIVATION_PARAMS)[number];

/** Tab/guide kind discriminator carried by `?type=`. */
export type PathfinderDeepLinkType = 'learning-journey' | 'docs' | 'interactive';

/** Surface mode the `?panelMode=` param can request. */
export type PathfinderDeepLinkPanelMode = 'sidebar' | 'floating' | 'fullscreen';

/**
 * Typed view of a Pathfinder deep-link's parameters.
 *
 * Unknown values are coerced to `undefined` rather than passed through
 * untyped, so consumers don't need to defend against typos in the URL.
 */
export interface DeepLinkParams {
  /** Raw `?doc=` value (URL or shorthand like `bundled:foo`, `api:bar`). */
  doc?: string;
  /** Tab kind override (`?type=`). Strict whitelist; unknowns drop to undefined. */
  type?: PathfinderDeepLinkType;
  /** Free-form analytics attribution from `?source=`. */
  source?: string;
  /** Pre-doc redirect target from `?page=`. */
  page?: string;
  /** Kiosk session id from `?kiosk_session=`. */
  kioskSession?: string;
  /** Surface mode from `?panelMode=`. Strict whitelist; unknowns drop to undefined. */
  panelMode?: PathfinderDeepLinkPanelMode;
  readonly?: boolean;
}

const ALLOWED_TYPES: ReadonlySet<PathfinderDeepLinkType> = new Set(['learning-journey', 'docs', 'interactive']);
const ALLOWED_PANEL_MODES: ReadonlySet<PathfinderDeepLinkPanelMode> = new Set(['sidebar', 'floating', 'fullscreen']);

/**
 * Parse a `location.search` string (e.g. `?doc=foo&type=learning-journey`)
 * into a typed `DeepLinkParams`. Empty / unknown values become `undefined`.
 */
export function parsePathfinderDeepLink(search: string): DeepLinkParams {
  const params = new URLSearchParams(search);
  const rawType = params.get('type') ?? undefined;
  const rawPanelMode = params.get('panelMode') ?? undefined;
  const type =
    rawType && ALLOWED_TYPES.has(rawType as PathfinderDeepLinkType) ? (rawType as PathfinderDeepLinkType) : undefined;
  const panelMode =
    rawPanelMode && ALLOWED_PANEL_MODES.has(rawPanelMode as PathfinderDeepLinkPanelMode)
      ? (rawPanelMode as PathfinderDeepLinkPanelMode)
      : undefined;
  return {
    doc: params.get('doc') ?? undefined,
    type,
    source: params.get('source') ?? undefined,
    page: params.get('page') ?? undefined,
    kioskSession: params.get('kiosk_session') ?? undefined,
    panelMode,
    readonly: params.get('readonly') === '1',
  };
}

/**
 * Strip every Pathfinder-controlled query parameter from `url` in place.
 *
 * Used by `module.tsx` after consuming a deep link so refresh / share URLs
 * don't replay the same `?doc=` / `?page=` / `?source=` / `?type=` /
 * `?kiosk_session=` on the next load.
 */
export function stripPathfinderParams(url: URL): void {
  for (const param of PATHFINDER_PARAMS) {
    url.searchParams.delete(param);
  }
}

/** Options for {@link buildPathfinderShareUrl}. */
export interface ShareLinkOpts {
  /**
   * Base URL to share. Defaults to `window.location.href` so callers can omit
   * it in browser code; tests can pass an explicit URL to stay deterministic.
   */
  base?: URL;
  /** The `?doc=` value (the guide URL or shorthand). */
  doc: string;
  /**
   * Tab kind. When `'learning-journey'` the helper appends
   * `&type=learning-journey` so a recipient hitting the link cold gets the
   * milestone toolbar even when `findDocPage`'s URL classification can't tell.
   */
  guideType?: 'learning-journey' | 'docs';
  /** Surface to request via `?panelMode=`. Omit to leave the param off. */
  panelMode?: 'floating' | 'fullscreen';
}

/**
 * Build a "Copy link to this guide" share URL with the Pathfinder
 * deep-link params applied.
 *
 * Single rule for `type=learning-journey` enforcement: callers pass
 * `guideType` and the helper decides whether to set the param. This stops
 * the floating "copy link" from forgetting the param (a pre-existing bug
 * the consolidation review flagged).
 *
 * SECURITY: param values are passed through `URLSearchParams.set`, which
 * URI-encodes them — no string concatenation (F4).
 */
export function buildPathfinderShareUrl(opts: ShareLinkOpts): string {
  const url = opts.base ? new URL(opts.base.toString()) : new URL(window.location.href);
  url.searchParams.set('doc', opts.doc);
  if (opts.panelMode) {
    url.searchParams.set('panelMode', opts.panelMode);
  }
  if (opts.guideType === 'learning-journey') {
    url.searchParams.set('type', opts.guideType);
  }
  return url.toString();
}

/** Options for {@link buildFullScreenRouteUrl}. */
export interface FullScreenRouteOpts {
  /** Plugin base URL (e.g. `/a/grafana-pathfinder-app`). */
  pluginBaseUrl: string;
  /** Route segment for fullscreen (e.g. `'fullscreen'`). */
  fullScreenRoute: string;
  /** The `?doc=` value to forward to fullscreen. */
  doc: string;
  /** Tab kind. Encoded so refresh / share rehydrates as the right surface. */
  guideType: 'learning-journey' | 'docs';
  readonly?: boolean;
}

/**
 * Build the in-app full-screen route URL with `?doc=` and `?type=` set.
 *
 * Used by the sidebar and floating panel "switch to full screen" handlers.
 * `type` is always encoded (even for plain docs) so the receiving panel's
 * URL fallback doesn't have to second-guess the kind.
 */
export function buildFullScreenRouteUrl(opts: FullScreenRouteOpts): string {
  const params = new URLSearchParams();
  params.set('doc', opts.doc);
  params.set('type', opts.guideType);
  if (opts.readonly) {
    params.set('readonly', '1');
  }
  return `${opts.pluginBaseUrl}/${opts.fullScreenRoute}?${params.toString()}`;
}

/**
 * Decide whether an `auto-launch-tutorial` event should open the URL as a
 * learning journey (with milestone navigation) or as a flat docs/interactive
 * tab.
 *
 * The rule is shared across the sidebar, floating, and fullscreen surfaces:
 * - Explicit `type=learning-journey` always wins.
 * - The `learning-hub` source signals the open came from the learning hub
 *   recommender, which only ever proposes journeys.
 */
export function shouldOpenAsLearningJourney(typeParam: string | undefined, source: string | undefined): boolean {
  return typeParam === 'learning-journey' || source === 'learning-hub';
}
