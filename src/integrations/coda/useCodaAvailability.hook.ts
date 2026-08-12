import { useEffect, useMemo, useState } from 'react';
import { usePluginContext } from '@grafana/data';
import { isAppPluginEnabled } from '@grafana/runtime';
import { getConfigWithDefaults } from '../../constants';
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

/**
 * `checking` on first paint, because the probe is async.
 *
 * Distinct from the boolean below: a caller that renders "Coda is unavailable"
 * needs to know the difference between "not installed" and "not asked yet", or
 * it flashes the failure on every mount.
 */
export type CodaPluginAvailability = 'checking' | 'available' | 'unavailable';

export function useCodaPluginAvailability(): CodaPluginAvailability {
  const [availability, setAvailability] = useState<CodaPluginAvailability>('checking');

  useEffect(() => {
    let cancelled = false;
    isCodaPluginAvailable().then((result) => {
      if (!cancelled) {
        setAvailability(result ? 'available' : 'unavailable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return availability;
}

export function useCodaPluginAvailable(): boolean {
  return useCodaPluginAvailability() === 'available';
}

/**
 * The two operator-owned gates on the sandbox terminal, as the configuration
 * page reports them (`CodaBackendStatus`): Pathfinder's own
 * `enableCodaTerminal`, then the Coda plugin being installed and enabled.
 *
 * Registration — the third gate that page reports — is deliberately not probed
 * here. It needs a `/capabilities` round trip per caller, and an unregistered
 * backend already answers `coda_not_registered` on the first real request, so
 * the specific reason reaches the UI anyway.
 */
export type CodaTerminalGate = 'checking' | 'disabled' | 'plugin-missing' | 'configured';

export function useCodaTerminalGate(): CodaTerminalGate {
  const pluginContext = usePluginContext();
  const enabled = useMemo(
    () => getConfigWithDefaults(pluginContext?.meta?.jsonData || {}).enableCodaTerminal,
    [pluginContext?.meta?.jsonData]
  );
  const availability = useCodaPluginAvailability();

  if (!enabled) {
    return 'disabled';
  }
  if (availability === 'checking') {
    return 'checking';
  }
  return availability === 'available' ? 'configured' : 'plugin-missing';
}
