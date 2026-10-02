/**
 * The one builder for Pathfinder deep links to published packages, shared by
 * the `find-guides` command (and so `pathfinder_find_guides`) and
 * `pathfinder_launch_package`.
 *
 * Node-safe twin of `buildPathfinderShareUrl` in
 * `src/utils/pathfinder-search-params.ts`, which needs `window`. Both apply the
 * same rule: a path or journey link carries `type=learning-journey`.
 */

import { buildPackageFileUrl } from './repository-client';

/** Grafana plugin viewer base path. Combined with `?doc=…` for guide links. */
export const PLUGIN_VIEWER_BASE = '/a/grafana-pathfinder-app';

export interface LaunchLinkInput {
  /** Repository base URL — the folder that holds `repository.json`. */
  baseUrl: string;
  /** The entry's `path` from `repository.json`. */
  entryPath: string;
  /** The entry's package `type`. */
  type?: string;
  /** Origin of the user's Grafana instance; adds `launchUrl` when set. */
  instanceUrl?: string;
  panelMode?: 'floating';
}

export interface LaunchLink {
  cdnContentUrl: string;
  launchPath: string;
  launchUrl?: string;
}

export function isLearningJourneyType(type: string | undefined): boolean {
  return type === 'path' || type === 'journey';
}

/** Returns `null` when the content URL cannot be built from `baseUrl` and `entryPath`. */
export function buildLaunchLink(input: LaunchLinkInput): LaunchLink | null {
  const cdnContentUrl = buildPackageFileUrl(input.baseUrl, input.entryPath, 'content.json');
  if (!cdnContentUrl) {
    return null;
  }
  let launchPath = `${PLUGIN_VIEWER_BASE}?doc=${encodeURIComponent(cdnContentUrl)}`;
  if (isLearningJourneyType(input.type)) {
    launchPath += '&type=learning-journey';
  }
  if (input.panelMode === 'floating') {
    launchPath += '&panelMode=floating';
  }
  const origin = input.instanceUrl?.trim().replace(/\/+$/, '');
  return origin ? { cdnContentUrl, launchPath, launchUrl: `${origin}${launchPath}` } : { cdnContentUrl, launchPath };
}
