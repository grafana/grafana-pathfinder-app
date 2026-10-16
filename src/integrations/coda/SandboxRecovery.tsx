import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, ConfirmModal } from '@grafana/ui';

import { deleteVM, listVMs, type TerminalVMOptions } from './coda-api';

interface Props {
  vmId: string;
  onReplace: (options: TerminalVMOptions) => void;
}

export function SandboxRecovery({ vmId, onReplace }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const replace = async () => {
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const vm = (await listVMs()).find((entry) => entry.id === vmId);
      if (!mounted.current) {
        return;
      }
      if (!vm) {
        throw new Error('This sandbox is no longer available. Retry the connection to request a sandbox.');
      }
      const options: TerminalVMOptions = {
        template: vm.template,
        app: typeof vm.config?.app === 'string' ? vm.config.app : undefined,
        scenario: typeof vm.config?.scenario === 'string' ? vm.config.scenario : undefined,
      };
      await deleteVM(vmId);
      if (mounted.current) {
        setConfirming(false);
        onReplace(options);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not replace the sandbox. Retry the connection.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Alert title="Sandbox terminal unreachable" severity="warning">
        Connection attempts failed. Retry with Connect, or replace this sandbox to start over. Replacement deletes its
        files and stops its processes, including work in other terminals or the IDE.
        <Button variant="destructive" disabled={busy} onClick={() => setConfirming(true)}>
          Replace sandbox
        </Button>
      </Alert>
      <ConfirmModal
        isOpen={confirming}
        title="Replace sandbox?"
        body={
          <>
            <p>
              This permanently deletes this sandbox’s files and stops its processes. Other terminals and the IDE using
              it will lose access. Coda reconnects using the same template, app and scenario.
            </p>
            {error && <p role="alert">{error}</p>}
          </>
        }
        confirmText={busy ? 'Replacing…' : 'Delete and replace'}
        onConfirm={() => void replace()}
        onDismiss={() => !pending.current && setConfirming(false)}
      />
    </>
  );
}
