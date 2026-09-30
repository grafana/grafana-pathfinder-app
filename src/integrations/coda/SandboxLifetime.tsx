import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@grafana/ui';
import { CodaError } from '@grafana/coda-client';
import { lifetimeClient, type LifetimeVM as VM } from './coda-api';

export function SandboxLifetime({
  client = lifetimeClient,
  vmId,
  vm: serverVM,
  onExtended,
  className,
}: {
  client?: typeof lifetimeClient;
  vmId: string;
  vm: VM | undefined;
  onExtended?: (expiry: string) => void;
  className?: string;
}) {
  const [updatedVM, setVM] = useState<VM>();
  const vm =
    updatedVM && serverVM && Date.parse(updatedVM.expiresAt) > Date.parse(serverVM.expiresAt) ? updatedVM : serverVM;
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retryPending, setRetryPending] = useState(false);
  const request = useRef<{ key: string; expiresAt: string } | undefined>(undefined);
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(clock);
  }, []);
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
      setVM({ ...vm, ...result });
      onExtended?.(result.expiresAt);
      request.current = undefined;
      setRetryPending(false);
    } catch (err) {
      if (err instanceof CodaError && err.code === 'extension_unavailable') {
        request.current = undefined;
      }
      setRetryPending(request.current !== undefined);
      setError(err instanceof Error ? err.message : 'Could not extend the sandbox. Retry to check the result.');
    } finally {
      setBusy(false);
    }
  };
  if (!eligible && !retryPending && !busy && !error) {
    return null;
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      fill="text"
      className={className}
      aria-label={busy ? 'Extending…' : error ? 'Retry extension' : 'Extend by 30 minutes'}
      tooltip={error || 'Extend sandbox by 30 minutes'}
      disabled={busy || (!eligible && !retryPending)}
      onClick={(event) => {
        event.stopPropagation();
        void extend();
      }}
    >
      {busy ? 'Extending…' : error ? 'Retry' : '+30 min'}
    </Button>
  );
}
