import { useEffect, useState } from 'react';
import { PathfinderPluginConfig, ResolvedPathfinderConfig, getConfigWithDefaults } from '../constants';
import { PATHFINDER_CONFIG_UPDATED_EVENT } from '../lib/event-names';
import { logger } from '../lib/logging';
import pluginJson from '../plugin.json';
import { resolveTenantSettings, TenantSettingsReadError } from '../utils/resolve-tenant-settings';
import { adoptLegacyDevModeOptIn, hasLegacyDevModeOptIn, resolveDevModeOptIn } from '../utils/dev-mode';

// Re-exported so existing importers keep a stable path; `constants` owns the shape.
export type { ResolvedPathfinderConfig };

export interface PathfinderPluginConfigState {
  config: ResolvedPathfinderConfig;
  /** `false` means "not known yet", which is distinct from an explicit all-defaults config. */
  isResolved: boolean;
  hasError?: boolean;
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

async function resolvePathfinderSettings(useCachedAbsence: boolean): Promise<PathfinderPluginConfig> {
  return (await resolveTenantSettings(pluginJson.id, { useCachedAbsence })).config;
}

// This is the sole publisher of the configuration readiness signal.
export function publishPathfinderPluginConfig(jsonData: PathfinderPluginConfig): ResolvedPathfinderConfig {
  const target = window;
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
let refreshUsesCachedAbsence = false;
let refreshPending = false;
let refreshFailed = false;
let startupReadError: TenantSettingsReadError | undefined;

export async function readPathfinderStartupPreference(): Promise<PathfinderPluginConfig | undefined> {
  const resolved = await refreshPathfinderPluginConfig({ useCachedAbsence: true });
  if (!resolved && startupReadError) {
    throw startupReadError;
  }
  return resolved;
}

export function refreshPathfinderPluginConfig({
  useCachedAbsence = true,
  force = false,
}: { useCachedAbsence?: boolean; force?: boolean } = {}): Promise<ResolvedPathfinderConfig | undefined> {
  if (!refreshInFlight || (force && !refreshPending) || (!useCachedAbsence && refreshUsesCachedAbsence)) {
    refreshUsesCachedAbsence = useCachedAbsence;
    refreshPending = true;
    const request: Promise<ResolvedPathfinderConfig | undefined> = resolvePathfinderSettings(useCachedAbsence)
      .then((resolved) => {
        if (refreshInFlight !== request) {
          return refreshInFlight ?? undefined;
        }
        refreshPending = false;
        startupReadError = undefined;
        refreshFailed = false;
        return publishPathfinderPluginConfig(resolved);
      })
      .catch((error) => {
        if (refreshInFlight !== request) {
          return refreshInFlight ?? undefined;
        }
        refreshPending = false;
        startupReadError = error instanceof TenantSettingsReadError ? error : undefined;
        refreshInFlight = null;
        refreshFailed = true;
        logger.warn('Failed to read plugin settings; a later refresh can retry', { error });
        document.dispatchEvent(new CustomEvent(PATHFINDER_CONFIG_UPDATED_EVENT));
        return undefined;
      });
    refreshInFlight = request;
    document.dispatchEvent(new CustomEvent(PATHFINDER_CONFIG_UPDATED_EVENT));
  }

  return refreshInFlight;
}

// Startup keeps waiting after a failed read so a later successful refresh can finish mounting.
export function waitForPathfinderPluginConfig(): Promise<ResolvedPathfinderConfig> {
  if (window.__pathfinderPluginConfig) {
    return Promise.resolve(window.__pathfinderPluginConfig);
  }
  return new Promise((resolve) => {
    const onConfig = () => {
      const config = window.__pathfinderPluginConfig;
      if (config) {
        document.removeEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, onConfig);
        resolve(config);
      }
    };
    document.addEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, onConfig);
    void refreshPathfinderPluginConfig({ useCachedAbsence: true });
  });
}

function resolveState(): PathfinderPluginConfigState {
  const published = window.__pathfinderPluginConfig;
  if (published) {
    return { config: published, isResolved: true };
  }
  return refreshFailed ? { ...unresolved(), hasError: true } : unresolved();
}

export function usePathfinderPluginConfig({
  refreshOnMount = false,
}: { refreshOnMount?: boolean } = {}): PathfinderPluginConfigState {
  const [state, setState] = useState<PathfinderPluginConfigState>(() => resolveState());

  useEffect(() => {
    let cancelled = false;

    const sync = () => {
      if (cancelled) {
        return;
      }
      const next = resolveState();
      setState((previous) =>
        previous.isResolved === next.isResolved &&
        previous.hasError === next.hasError &&
        configEquals(previous.config, next.config)
          ? previous
          : next
      );
    };

    document.addEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, sync);
    sync();
    void refreshPathfinderPluginConfig({ useCachedAbsence: !refreshOnMount, force: refreshOnMount }).then(sync);

    return () => {
      cancelled = true;
      document.removeEventListener(PATHFINDER_CONFIG_UPDATED_EVENT, sync);
    };
  }, [refreshOnMount]);

  return state;
}

/**
 * Test-only reset of the module-level single-flight and the published global.
 */
export function __resetPathfinderPluginConfigForTests(): void {
  refreshInFlight = null;
  refreshUsesCachedAbsence = false;
  refreshPending = false;
  refreshFailed = false;
  startupReadError = undefined;
  unresolvedState = undefined;
  delete window.__pathfinderPluginConfig;
}
