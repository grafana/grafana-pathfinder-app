/**
 * Gates for the two tabs whose availability depends on runtime state:
 * Create Guide (editor role) and Dev Tools (pathfinder-dev-mode).
 *
 * Single derivation point. The model prunes tabs from panel state using these
 * flags, so a spurious `false` removes a tab the user is entitled to — and
 * `getConfigWithDefaults({})` yields `devMode: false`, which makes an
 * unresolved plugin config read identically to "dev mode off". Callers must
 * pass the config they actually resolved rather than an empty fallback.
 */

import { config } from '@grafana/runtime';
import type { DocsPluginConfig } from '../../../constants';
import { isDevModeEnabled } from '../../../utils/dev-mode';

export interface TabGates {
  allowEditor: boolean;
  allowDevTools: boolean;
}

/** Editor-role predicate shared by the model gate and the renderer's menu gate. */
export function isCurrentUserEditor(): boolean {
  const user = config.bootData?.user;
  return user?.orgRole === 'Editor' || user?.orgRole === 'Admin' || user?.isGrafanaAdmin === true;
}

export function resolveTabGates(pluginConfig: DocsPluginConfig | undefined): TabGates {
  return {
    allowEditor: isCurrentUserEditor(),
    allowDevTools: isDevModeEnabled(pluginConfig || {}, config.bootData?.user?.id),
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
  return (previous.allowEditor && !next.allowEditor) || (previous.allowDevTools && !next.allowDevTools);
}
