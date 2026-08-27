import { useEffect, useMemo, useState } from 'react';
import { usePluginContext } from '@grafana/data';
import { PathfinderPluginConfig, ResolvedPathfinderConfig, getConfigWithDefaults } from '../constants';
import { PATHFINDER_CONFIG_UPDATED_EVENT } from '../lib/event-names';
import { logger } from '../lib/logging';
import pluginJson from '../plugin.json';
import { resolveTenantSettings } from '../utils/resolve-tenant-settings';
import { adoptLegacyDevModeOptIn, hasLegacyDevModeOptIn, resolveDevModeOptIn } from '../utils/dev-mode';

// Re-exported so existing importers keep a stable path; `constants` owns the shape.
export type { ResolvedPathfinderConfig };

interface PathfinderConfigWindow extends Window {
  __pathfinderPluginConfig?: ResolvedPathfinderConfig;
}

export interface PathfinderPluginConfigState {
  config: ResolvedPathfinderConfig;
  /** `false` means "not known yet", which is distinct from an explicit all-defaults config. */
  isResolved: boolean;
}

function configWindow(): PathfinderConfigWindow {
  return window as PathfinderConfigWindow;
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
 * Folds this user's own settings into a tenant-level config.
 *
 * Dev-mode surfaces need two gates: the tenant `devMode` flag and this user's
 * opt-in. The opt-in lives in this browser's storage, but every consumer checks
 * it synchronously, so it is resolved once here and carried on the published
 * config rather than read at each call site.
 *
 * The deprecated `devModeUserIds` array is consulted only while this browser has
 * never recorded a choice, and adopting it writes the opt-in through — so it is
 * a one-shot migration rather than a rule re-applied on every publish. Nothing
 * clears `devModeUserIds`, so re-deriving from it would resurrect the opt-in
 * every time and make a later opt-out impossible to keep.
 */
function withPerUserSettings(jsonData: PathfinderPluginConfig): PathfinderPluginConfig {
  if (jsonData.devModeOptIn !== undefined) {
    return jsonData;
  }

  const stored = resolveDevModeOptIn();
  if (stored !== undefined) {
    return { ...jsonData, devModeOptIn: stored };
  }

  const legacy = hasLegacyDevModeOptIn(jsonData);
  if (legacy) {
    adoptLegacyDevModeOptIn();
  }
  return { ...jsonData, devModeOptIn: legacy };
}

/**
 * The tenant half of the config, resolved through the same helper the config
 * tabs save through so read and write precedence cannot drift. Per-user state is
 * layered on by `withPerUserSettings` at publish; missing values fall through to
 * `getConfigWithDefaults`.
 */
async function resolvePathfinderSettings(): Promise<PathfinderPluginConfig> {
  return (await resolveTenantSettings(pluginJson.id)).config;
}

/**
 * The only writer of `window.__pathfinderPluginConfig`, which is the readiness
 * signal documented in `docs/developer/E2E_TESTING_CONTRACT.md` and the config
 * source for callers that run outside React (scene construction, dev-mode
 * helpers, url-validator). Returns the published config so callers can use it
 * without re-reading the global.
 */
export function publishPathfinderPluginConfig(jsonData: PathfinderPluginConfig): ResolvedPathfinderConfig {
  const target = configWindow();
  const next = getConfigWithDefaults(withPerUserSettings(jsonData));
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
 * Single-flight read of the saved settings across every store. Grafana's
 * `meta.jsonData` snapshot can lag a save, so this is the authoritative value —
 * but nothing waits on it: failure leaves whatever was already published in
 * place.
 */
export function refreshPathfinderPluginConfig(): Promise<ResolvedPathfinderConfig | undefined> {
  refreshInFlight ??= resolvePathfinderSettings()
    .then((resolved) => publishPathfinderPluginConfig(resolved))
    .catch((error) => {
      logger.warn('Failed to read plugin settings; keeping the plugin meta snapshot', { error });
      return undefined;
    });

  return refreshInFlight;
}

function resolveState(contextState: PathfinderPluginConfigState | undefined): PathfinderPluginConfigState {
  const published = configWindow().__pathfinderPluginConfig;
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
  delete configWindow().__pathfinderPluginConfig;
}
