import { useEffect, useMemo, useRef, useState } from 'react';
import { usePluginContext } from '@grafana/data';
import { isAppPluginEnabled, isAppPluginInstalled } from '@grafana/runtime';
import { getConfigWithDefaults } from '../../constants';
import { recordSandboxUnavailable, type SandboxUnavailableReason } from '../../lib/telemetry/facade';
import {
  CODA_PLUGIN_ID,
  codaRoleForbiddenMessage,
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

/**
 * `/capabilities` for this page load, or `null` when it cannot be read at all —
 * the plugin is absent, or the request failed. Callers must read `null` as
 * "cannot answer", never as an answer.
 *
 * `caller` is the one per-user part of the response, which is safe to cache here
 * only because a page load has one user.
 */
let cachedCapabilities: Promise<CodaCapabilities | null> | undefined;

/**
 * `isAppPluginEnabled` is served by Grafana core's own `@grafana/runtime` at
 * runtime, not bundled with this plugin — it is absent before core 13.1 and
 * calling it throws synchronously rather than rejecting, so no `.catch` can
 * cover it.
 */
export function isCodaProbeSupported(): boolean {
  return typeof isAppPluginEnabled === 'function';
}

/**
 * Below core 13.1, ask the provider directly instead of treating the missing
 * core helper as a missing plugin. `/capabilities` is served by
 * `grafana-coda-app` itself, so a response means installed and enabled, and a
 * failure means not reachable — the same question, answered by the party that
 * knows. `CodaClient` suppresses the error toast, so a miss is silent.
 *
 * This is why the terminal keeps working across the whole
 * `grafanaDependency` range in `plugin.json` (`>=12.3.0-0`) rather than
 * needing 13.1: nothing else in the SDK's data path does.
 */
function capabilitiesOnce(): Promise<CodaCapabilities | null> {
  if (!cachedCapabilities) {
    cachedCapabilities = getCapabilities().catch(() => null);
  }
  return cachedCapabilities;
}

function probeEnabled(): Promise<boolean> {
  return isCodaProbeSupported()
    ? isAppPluginEnabled(CODA_PLUGIN_ID).catch(() => false)
    : capabilitiesOnce().then((capabilities) => capabilities !== null);
}

/**
 * `isAppPluginEnabled` fetches the plugin's settings, so an absent Coda 404s and
 * core logs it as a fault; boot data answers for free. Anything short of a definite
 * "not installed" still asks. Keep the branch synchronous — an `await` defers
 * `capabilitiesOnce` past `loadCodaCapabilities` and costs a second request.
 */
export function isCodaPluginAvailable(): Promise<boolean> {
  if (!cached) {
    cached =
      typeof isAppPluginInstalled === 'function'
        ? isAppPluginInstalled(CODA_PLUGIN_ID).then(
            (installed) => (installed ? probeEnabled() : false),
            () => probeEnabled()
          )
        : probeEnabled();
  }
  return cached;
}

export function resetCodaAvailabilityCache(): void {
  cached = undefined;
  cachedCapabilities = undefined;
}

/**
 * `checking` on first paint, because the probe is async, and while `shouldProbe`
 * is false, because then it was never asked.
 *
 * Distinct from the boolean below: a caller that renders "Coda is unavailable"
 * needs to know the difference between "not installed" and "not asked yet", or
 * it flashes the failure on every mount.
 */
export type CodaPluginAvailability = 'checking' | 'available' | 'unavailable';

export function useCodaPluginAvailability(shouldProbe = true): CodaPluginAvailability {
  const [availability, setAvailability] = useState<CodaPluginAvailability>('checking');

  useEffect(() => {
    if (!shouldProbe) {
      return;
    }
    let cancelled = false;
    isCodaPluginAvailable().then((result) => {
      if (!cancelled) {
        setAvailability(result ? 'available' : 'unavailable');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shouldProbe]);

  return availability;
}

export function useCodaPluginAvailable(shouldProbe = true): boolean {
  return useCodaPluginAvailability(shouldProbe) === 'available';
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
  const availability = useCodaPluginAvailability(enabled);

  if (!enabled) {
    return 'disabled';
  }
  if (availability === 'checking') {
    return 'checking';
  }
  return availability === 'available' ? 'configured' : 'plugin-missing';
}

export function loadCodaCapabilities(): Promise<CodaCapabilities | null> {
  if (!cachedCapabilities) {
    // Below 13.1 the availability probe *is* a capabilities read, so going
    // through it would spend a second request for an answer already in hand.
    if (!isCodaProbeSupported()) {
      return capabilitiesOnce();
    }
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
    loadCodaCapabilities().then((capabilities) => {
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

/**
 * The reason a sandbox-backed block cannot run, if there is one.
 *
 * Shared by every block that needs a VM — `challenge`, `terminal`,
 * `terminal-connect` — so a learner meets one explanation rather than three, or
 * worse, a control that silently does nothing. `subject` names what is being
 * refused; everything after it is the same wherever it appears.
 *
 * The two gate cases are operator-owned and stable from first paint. The third
 * is this user's Grafana role, which the backend answers in
 * `capabilities.caller` — so a learner below the floor is told before a click
 * spends a session request, rather than after a `403 role_forbidden`.
 * `checking` and `unknown` deliberately yield null: attempt, and let the
 * reactive path handle it.
 */
export function codaConfigGateMessage(
  gate: CodaTerminalGate,
  eligibility: CodaSandboxEligibility,
  subject: string
): string | null {
  switch (gate) {
    case 'disabled':
      return `${subject}, and the sandbox terminal is turned off for this Grafana. An administrator can enable it in Pathfinder’s configuration.`;
    case 'plugin-missing':
      return `${subject}, and the Coda app plugin is not installed or not enabled in this Grafana.`;
  }
  if (eligibility.state === 'role_forbidden') {
    return `${subject}. ${codaRoleForbiddenMessage(eligibility.minimumSessionRole)}`;
  }
  return null;
}

/**
 * Why a sandbox action cannot succeed, or null if it can (or if the availability
 * probe has not resolved yet, in which case the caller should keep waiting).
 *
 * `terminalWired` is the load-bearing half: `TerminalProvider` mounts
 * unconditionally while `TerminalPanel` — which registers the real `connect` —
 * is gated, so without this check `openTerminal` silently no-ops and the caller
 * offers a control wired to nothing.
 */
export function codaUnavailableMessage(
  gate: CodaTerminalGate,
  eligibility: CodaSandboxEligibility,
  terminalWired: boolean,
  subject: string
): string | null {
  const configReason = codaConfigGateMessage(gate, eligibility, subject);
  if (configReason) {
    return configReason;
  }
  if (gate === 'checking') {
    return null;
  }
  return terminalWired ? null : `${subject}, and the sandbox terminal is not available here.`;
}

/**
 * The same ladder as `codaUnavailableMessage`, as a closed set for telemetry.
 * Kept in step with it deliberately — a rung that produces a message but no
 * signal is the case an operator cannot see.
 */
function codaUnavailableReason(
  gate: CodaTerminalGate,
  eligibility: CodaSandboxEligibility,
  terminalWired: boolean
): SandboxUnavailableReason | null {
  if (gate === 'disabled') {
    return 'terminal-disabled';
  }
  if (gate === 'plugin-missing') {
    return 'plugin-missing';
  }
  if (eligibility.state === 'role_forbidden') {
    return 'role-forbidden';
  }
  if (gate === 'checking') {
    return null;
  }
  return terminalWired ? null : 'panel-not-registered';
}

/**
 * Emits one `pathfinder_sandbox_unavailable` per block that had to degrade, and
 * only when the rung changes — the probe resolving mid-mount must not count as
 * a second degradation.
 *
 * `TELEMETRY.md`'s decision rule requires a typed signal for a degradation
 * ladder, and this one has four rungs that look identical from the outside: an
 * unavailable sandbox and an unused one are the same absence of activity.
 */
export function useReportSandboxUnavailable(
  gate: CodaTerminalGate,
  eligibility: CodaSandboxEligibility,
  terminalWired: boolean,
  blockType: string
): void {
  const reason = codaUnavailableReason(gate, eligibility, terminalWired);
  const reportedRef = useRef<SandboxUnavailableReason | null>(null);

  useEffect(() => {
    if (!reason || reportedRef.current === reason) {
      return;
    }
    reportedRef.current = reason;
    recordSandboxUnavailable(reason, blockType);
  }, [reason, blockType]);
}
