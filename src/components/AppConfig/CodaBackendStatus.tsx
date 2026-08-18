import React, { useEffect, useState } from 'react';
import { Alert, Text, TextLink } from '@grafana/ui';
import { CODA_PLUGIN_ID, getCapabilities, isCodaUsable, type CodaCapabilities } from '../../integrations/coda/coda-api';
import { isCodaPluginAvailable, isCodaProbeSupported } from '../../integrations/coda/useCodaAvailability.hook';

type Status =
  | { kind: 'loading' }
  | { kind: 'grafana-too-old' }
  | { kind: 'not-installed' }
  | { kind: 'not-registered'; configErrors: string[] }
  | { kind: 'misconfigured'; configErrors: string[] }
  | { kind: 'credential-expired' }
  | { kind: 'ready'; capabilities: CodaCapabilities }
  | { kind: 'unreachable'; message: string };

const CONFIG_PATH = `/plugins/${CODA_PLUGIN_ID}`;

/**
 * Readiness is `isCodaUsable`, not `registered` — a refresh token that expired
 * 90 days ago leaves `registered` true while every session 401s, which is how
 * this page came to render a green "Coda is ready" on a stack that could not
 * provision. The branches below only pick which of that predicate's three
 * false paths to name; a backend too old to answer omits both fields, and then
 * `isCodaUsable` is exactly as permissive as `registered` was.
 */
function statusFromCapabilities(capabilities: CodaCapabilities): Status {
  if (isCodaUsable(capabilities)) {
    return { kind: 'ready', capabilities };
  }
  const configErrors = capabilities.configErrors ?? [];
  if (!capabilities.registered) {
    return { kind: 'not-registered', configErrors };
  }
  if (configErrors.length > 0) {
    return { kind: 'misconfigured', configErrors };
  }
  return { kind: 'credential-expired' };
}

function ConfigErrorList({ configErrors }: { configErrors: string[] }) {
  if (configErrors.length === 0) {
    return null;
  }
  return (
    <ul>
      {configErrors.map((problem) => (
        <li key={problem}>
          <Text variant="body">{problem}</Text>
        </li>
      ))}
    </ul>
  );
}

/**
 * The sandbox backend lives in a separate plugin, so Pathfinder can only report
 * on it and link to it — the enrollment key and URLs are configured over there.
 */
export function CodaBackendStatus({ enabled, className }: { enabled: boolean; className?: string }) {
  // Lazily, not in the effect: the probe's absence is a property of the running
  // Grafana, fixed for the page load, so there is nothing to wait for.
  const [status, setStatus] = useState<Status>(() =>
    isCodaProbeSupported() ? { kind: 'loading' } : { kind: 'grafana-too-old' }
  );

  useEffect(() => {
    if (!enabled || !isCodaProbeSupported()) {
      return;
    }
    let cancelled = false;

    isCodaPluginAvailable()
      .then(async (available) => {
        if (cancelled) {
          return;
        }
        if (!available) {
          setStatus({ kind: 'not-installed' });
          return;
        }
        const capabilities = await getCapabilities();
        if (cancelled) {
          return;
        }
        setStatus(statusFromCapabilities(capabilities));
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus({ kind: 'unreachable', message: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) {
    return (
      <Alert severity="info" title="Feature overview" className={className}>
        <Text variant="body">
          Interactive sandbox environment in the sidebar. Requires the Coda app plugin to be installed and registered.
        </Text>
      </Alert>
    );
  }

  switch (status.kind) {
    case 'loading':
      return null;

    case 'grafana-too-old':
      return (
        <Alert severity="info" title="This Grafana is too old for the terminal" className={className}>
          <Text variant="body">
            Detecting the <code>{CODA_PLUGIN_ID}</code> plugin needs Grafana 13.1 or later. The plugin may well be
            installed and working — Pathfinder cannot tell on this version, so terminal blocks stay hidden from the
            block editor.
          </Text>
        </Alert>
      );

    case 'not-installed':
      return (
        <Alert severity="warning" title="Coda app plugin not found" className={className}>
          <Text variant="body">
            The terminal needs the <code>{CODA_PLUGIN_ID}</code> plugin installed and enabled. Terminal blocks stay
            hidden from the block editor until it is available.
          </Text>
        </Alert>
      );

    case 'not-registered':
      return (
        <Alert severity="warning" title="Coda is not registered" className={className}>
          <Text variant="body">
            The Coda app plugin is installed but has not been registered.{' '}
            <TextLink href={CONFIG_PATH}>Configure it</TextLink> with an enrollment key to enable sandbox VMs.
          </Text>
          <ConfigErrorList configErrors={status.configErrors} />
        </Alert>
      );

    case 'misconfigured':
      return (
        <Alert severity="error" title="Coda cannot be used yet" className={className}>
          <Text variant="body">
            The Coda app plugin reports problems with its own configuration. Sandbox VMs stay unavailable until they are
            fixed on <TextLink href={CONFIG_PATH}>its configuration page</TextLink>.
          </Text>
          <ConfigErrorList configErrors={status.configErrors} />
        </Alert>
      );

    case 'credential-expired':
      return (
        <Alert severity="error" title="Coda’s credential has expired" className={className}>
          <Text variant="body">
            The Coda app plugin is registered, but Coda no longer accepts the credential it holds, so no sandbox VM can
            be created. Ask your Coda administrator for a new enrollment key and{' '}
            <TextLink href={CONFIG_PATH}>register again</TextLink>.
          </Text>
        </Alert>
      );

    case 'unreachable':
      return (
        <Alert severity="error" title="Could not reach the Coda app plugin" className={className}>
          <Text variant="body">{status.message}</Text>
        </Alert>
      );

    case 'ready':
      return (
        <Alert severity="success" title="Coda is ready" className={className}>
          <Text variant="body">
            {status.capabilities.templates.length} VM template(s), {status.capabilities.sampleApps.length} sample app(s)
            and {status.capabilities.alloyScenarios.length} Alloy scenario(s) available.{' '}
            <TextLink href={CONFIG_PATH}>Manage Coda settings</TextLink>.
          </Text>
        </Alert>
      );
  }
}
