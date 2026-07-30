import React, { useEffect, useState } from 'react';
import { Alert, Text, TextLink } from '@grafana/ui';
import { CODA_PLUGIN_ID, getCapabilities, type CodaCapabilities } from '../../integrations/coda/coda-api';
import { isCodaPluginAvailable } from '../../integrations/coda/useCodaAvailability.hook';

type Status =
  | { kind: 'loading' }
  | { kind: 'not-installed' }
  | { kind: 'not-registered' }
  | { kind: 'ready'; capabilities: CodaCapabilities }
  | { kind: 'unreachable'; message: string };

const CONFIG_PATH = `/plugins/${CODA_PLUGIN_ID}`;

/**
 * The sandbox backend lives in a separate plugin, so Pathfinder can only report
 * on it and link to it — the enrollment key and URLs are configured over there.
 */
export function CodaBackendStatus({ enabled, className }: { enabled: boolean; className?: string }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  useEffect(() => {
    if (!enabled) {
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
        setStatus(capabilities.registered ? { kind: 'ready', capabilities } : { kind: 'not-registered' });
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
