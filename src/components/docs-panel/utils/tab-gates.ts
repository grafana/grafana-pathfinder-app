import type { PathfinderPluginConfig } from '../../../constants';
import { currentUserIsEditor, isCurrentUserRoleKnown } from '../../../utils/current-user-role';
import { getFeatureFlagValue } from '../../../utils/openfeature';
import { isDevModeEnabled } from '../../../utils/dev-mode';

export interface TabGates {
  allowEditor: boolean;
  allowDevTools: boolean;
  allowBrowse: boolean;
}

export function resolveTabGates(pluginConfig: PathfinderPluginConfig | undefined): TabGates {
  return {
    allowEditor: !isCurrentUserRoleKnown() || currentUserIsEditor(),
    allowDevTools: isDevModeEnabled(pluginConfig || {}),
    allowBrowse: getFeatureFlagValue('pathfinder.package-browser', true),
  };
}

/**
 * True when a gate the caller previously observed as open is now closed.
 *
 * Persisting a prune is only safe on an observed transition: a first
 * observation cannot distinguish "denied" from "config not resolved yet".
 */
export function didGateClose(previous: TabGates | null, next: TabGates): boolean {
  if (!previous) {
    return false;
  }
  return (
    (previous.allowEditor && !next.allowEditor) ||
    (previous.allowDevTools && !next.allowDevTools) ||
    (previous.allowBrowse && !next.allowBrowse)
  );
}
