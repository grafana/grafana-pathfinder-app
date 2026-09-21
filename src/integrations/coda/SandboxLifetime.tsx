import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack } from '@grafana/ui';
import { CodaError } from '@grafana/coda-client';
import { lifetimeClient, type LifetimeVM as VM } from './coda-api';

export function SandboxLifetime({
  client = lifetimeClient,
  vmId,
  onExtended,
}: {
  client?: typeof lifetimeClient;
  vmId: string;
  onExtended?: (expiry: string) => void;
}) {
  const [vm, setVM] = useState<VM>();
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryPending, setRetryPending] = useState(false);
  const request = useRef<{ key: string; expiresAt: string } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void client
        .getVM(vmId)
        .then((value) => {
          if (active) {
            setVM(value);
          }
        })
        .catch(() => {});
    refresh();
    const poll = window.setInterval(refresh, 15000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener('focus', refresh);
    };
  }, [client, vmId]);
  const lifetime = vm?.lifetime;
  if (!vm || !lifetime || lifetime.unavailableReason === 'disabled') {
    return null;
  }
  const remaining = Math.max(0, Math.ceil((Date.parse(vm.expiresAt) - now) / 60000));
  const waiting = lifetime.unavailableReason === 'too_early';
  const eligible =
    (lifetime.canExtend || waiting) &&
    lifetime.extensionsRemaining > 0 &&
    lifetime.eligibleAt !== null &&
    now >= Date.parse(lifetime.eligibleAt) &&
    remaining > 0;
  const extend = async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setError('');
    request.current ??= { key: crypto.randomUUID(), expiresAt: vm.expiresAt };
    try {
      const result = await client.extendVM(vmId, request.current.key, request.current.expiresAt);
      setVM((current) => (current ? { ...current, ...result } : current));
      onExtended?.(result.expiresAt);
      request.current = undefined;
      setRetryPending(false);
    } catch (err) {
      if (err instanceof CodaError && err.code === 'extension_unavailable') {
        request.current = undefined;
      }
      setRetryPending(request.current !== undefined);
      setError(err instanceof Error ? err.message : 'Could not extend the sandbox. Retry to check the result.');
      void client
        .getVM(vmId)
        .then(setVM)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack direction="column" gap={1}>
      <Stack gap={1} alignItems="center">
        <span>
          {remaining} min left · {lifetime.extensionsRemaining} extensions remaining
        </span>
        <Button
          size="sm"
          disabled={busy || (!eligible && !retryPending)}
          onClick={(event) => {
            event.stopPropagation();
            void extend();
          }}
        >
          {busy ? 'Extending…' : error ? 'Retry extension' : 'Extend by 30 minutes'}
        </Button>
      </Stack>
      {waiting && !eligible && <span>Available during the final 10 minutes.</span>}
      {lifetime.unavailableReason === 'unsupported_vm' && (
        <span>This sandbox cannot be extended. New sandboxes support extensions.</span>
      )}
      {lifetime.extensionsRemaining === 0 && <span>All three extensions have been used.</span>}
      <span>Extending the sandbox does not renew Grafana credentials installed inside it.</span>
      {error && (
        <Alert title="Sandbox extension" severity="error">
          {error}
        </Alert>
      )}
    </Stack>
  );
}
