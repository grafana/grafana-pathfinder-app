import { useEffect, useMemo, useState } from 'react';
import { usePluginContext } from '@grafana/data';
import { isAppPluginEnabled } from '@grafana/runtime';
import { getConfigWithDefaults } from '../../constants';
import {
  CODA_PLUGIN_ID,
  codaSessionEligibility,
  getCapabilities,
  type CodaCapabilities,
  type CodaSessionRole,
} from './coda-api';

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
  cachedCapabilities = undefined;
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

/**
 * `/capabilities` for this page load, or `null` when it cannot be read at all —
 * the plugin is absent, or the request failed. Callers must read `null` as
 * "cannot answer", never as an answer.
 *
 * Cached like the availability probe above. `caller` is the one per-user part of
 * the response, which is safe here only because a page load has one user.
 */
let cachedCapabilities: Promise<CodaCapabilities | null> | undefined;

function loadCapabilities(): Promise<CodaCapabilities | null> {
  if (!cachedCapabilities) {
    cachedCapabilities = isCodaPluginAvailable()
      .then((available) => (available ? getCapabilities() : null))
      .catch(() => null);
  }
  return cachedCapabilities;
}

/**
 * Whether this user may start a sandbox, known *before* a session request is
 * spent finding out.
 *
 * Four states, not a boolean: `checking` while the probe is in flight, and
 * `unknown` for a Coda plugin older than `caller` — collapsing either into
 * `eligible` or `role_forbidden` would hide the sandbox from someone entitled to
 * it, or offer it to someone who cannot have it. On both, attempt the call and
 * keep handling `403 role_forbidden`.
 */
export type CodaSandboxEligibility =
  | { state: 'checking' }
  | { state: 'eligible' }
  | { state: 'unknown' }
  | { state: 'role_forbidden'; minimumSessionRole: CodaSessionRole };

function readEligibility(capabilities: CodaCapabilities | null): CodaSandboxEligibility {
  if (!capabilities) {
    return { state: 'unknown' };
  }
  const verdict = codaSessionEligibility(capabilities);
  if (verdict === 'eligible') {
    return { state: 'eligible' };
  }
  if (verdict === 'role_forbidden' && capabilities.caller) {
    return { state: 'role_forbidden', minimumSessionRole: capabilities.caller.minimumSessionRole };
  }
  // A refusal reason this build does not recognise is deliberately `unknown`
  // rather than `eligible`: attempt and handle the 403, do not pass it as fine.
  return { state: 'unknown' };
}

export function useCodaSessionEligibility(): CodaSandboxEligibility {
  const [eligibility, setEligibility] = useState<CodaSandboxEligibility>({ state: 'checking' });

  useEffect(() => {
    let cancelled = false;
    loadCapabilities().then((capabilities) => {
      if (!cancelled) {
        setEligibility(readEligibility(capabilities));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return eligibility;
}
