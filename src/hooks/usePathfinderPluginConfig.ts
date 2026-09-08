import { useEffect, useMemo, useState } from 'react';
import { usePluginContext } from '@grafana/data';
import { DocsPluginConfig, getConfigWithDefaults, type ResolvedPathfinderConfig } from '../constants';
import { PATHFINDER_CONFIG_UPDATED_EVENT } from '../lib/event-names';
import { logger } from '../lib/logging';
import pluginJson from '../plugin.json';
import { fetchPluginJsonData } from '../utils/utils.plugin';

export type { ResolvedPathfinderConfig } from '../constants';

export interface PathfinderPluginConfigState {
  config: ResolvedPathfinderConfig;
  /** `false` means "not known yet", which is distinct from an explicit all-defaults config. */
  isResolved: boolean;
}

let unresolvedState: PathfinderPluginConfigState | undefined;

function unresolved(): PathfinderPluginConfigState {
  unresolvedState ??= { config: getConfigWithDefaults({}), isResolved: false };
  return unresolvedState;
}

function configEquals(a: ResolvedPathfinderConfig, b: ResolvedPathfinderConfig): boolean {
  return (Object.keys(b) as Array<keyof ResolvedPathfinderConfig>).every((key) => {
    const left = a[key];
    const right = b[key];
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length === right.length && left.every((value, index) => value === right[index]);
    }
    return left === right;
  });
}

/**
 * The only writer of `window.__pathfinderPluginConfig`, which is the readiness
 * signal documented in `docs/developer/E2E_TESTING_CONTRACT.md` and the config
 * source for callers that run outside React (scene construction, dev-mode
 * helpers, url-validator). Returns the published config so callers can use it
 * without re-reading the global.
 */
export function publishPathfinderPluginConfig(jsonData: DocsPluginConfig): ResolvedPathfinderConfig {
  const target = window;
  const next = getConfigWithDefaults(jsonData);
  const current = target.__pathfinderPluginConfig;

  if (current && configEquals(current, next)) {
    return current;
  }

  target.__pathfinderPluginConfig = next;
  // Deliberately payload-free: any script sharing the document can dispatch
  // this, so subscribers re-read the global instead of trusting event detail.
  document.dispatchEvent(new CustomEvent(PATHFINDER_CONFIG_UPDATED_EVENT));
  return next;
}

let refreshInFlight: Promise<ResolvedPathfinderConfig | undefined> | null = null;

/**
 * Single-flight read of the saved settings. Grafana's `meta.jsonData` snapshot
 * can lag a save, so this is the authoritative value — but nothing waits on it:
 * failure leaves whatever was already published in place.
 */
export function refreshPathfinderPluginConfig(): Promise<ResolvedPathfinderConfig | undefined> {
  refreshInFlight ??= fetchPluginJsonData(pluginJson.id)
    .then((jsonData) => publishPathfinderPluginConfig(jsonData))
    .catch((error) => {
      logger.warn('Failed to read plugin settings; keeping the plugin meta snapshot', { error });
      return undefined;
    });

  return refreshInFlight;
}

function resolveState(contextState: PathfinderPluginConfigState | undefined): PathfinderPluginConfigState {
  const published = window.__pathfinderPluginConfig;
  if (published) {
    return { config: published, isResolved: true };
  }
  return contextState ?? unresolved();
}

export function usePathfinderPluginConfig(): PathfinderPluginConfigState {
  const pluginContext = usePluginContext();
  const pluginMeta = pluginContext?.meta;
  const contextState = useMemo<PathfinderPluginConfigState | undefined>(
    () => (pluginMeta ? { config: getConfigWithDefaults(pluginMeta.jsonData || {}), isResolved: true } : undefined),
    [pluginMeta]
  );

  const [state, setState] = useState<PathfinderPluginConfigState>(() => resolveState(contextState));

  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      if (cancelled) {
        return;
      }
      const next = resolveState(contextState);
      setState((previous) => (previous.config === next.config ? previous : next));
    };

    document.addEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, sync);
    sync();
    void refreshPathfinderPluginConfig().then(sync);

    return () => {
      cancelled = true;
      document.removeEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, sync);
    };
  }, [contextState]);

  return state;
}

/**
 * Test-only reset of the module-level single-flight and the published global.
 */
export function __resetPathfinderPluginConfigForTests(): void {
  refreshInFlight = null;
  unresolvedState = undefined;
  delete window.__pathfinderPluginConfig;
}
