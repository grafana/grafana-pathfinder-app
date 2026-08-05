import { useEffect, useState } from 'react';
import { isAppPluginEnabled } from '@grafana/runtime';
import { CODA_PLUGIN_ID } from './coda-api';

/**
 * Whether the Coda app plugin is installed and enabled. Pathfinder's terminal UI
 * lives here but the backend does not, so this must be checked at runtime rather
 * than declared as a hard plugin dependency — the terminal is optional.
 *
 * Resolved once per page load and cached: plugin installation does not change
 * without a Grafana restart.
 */
let cached: Promise<boolean> | undefined;

export function isCodaPluginAvailable(): Promise<boolean> {
  if (!cached) {
    cached = isAppPluginEnabled(CODA_PLUGIN_ID).catch(() => false);
  }
  return cached;
}

export function resetCodaAvailabilityCache(): void {
  cached = undefined;
}

export function useCodaPluginAvailable(): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    isCodaPluginAvailable().then((result) => {
      if (!cancelled) {
        setAvailable(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return available;
}
