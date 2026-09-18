import React, { useEffect, useState } from 'react';
import { Button } from '@grafana/ui';
import { codaWorkspaceUrl, getCapabilities } from './coda-api';

export function WorkspaceLink({
  connected,
  vmId,
  className,
}: {
  connected: boolean;
  vmId: string | null;
  className?: string;
}) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    void getCapabilities()
      .then((caps) => {
        if (active) {
          setAvailable(
            Boolean(caps.features?.includes('workspace-files') && caps.features?.includes('explicit-vm-attachment'))
          );
        }
      })
      .catch(() => {
        /* Hide the action when capability discovery fails. */
      });
    return () => {
      active = false;
    };
  }, []);
  if (!available) {
    return null;
  }
  return (
    <Button
      size="sm"
      variant="secondary"
      fill="text"
      icon="brackets-curly"
      tooltip="Open IDE connected to this VM (new tab)"
      className={className}
      disabled={!connected || !vmId}
      onClick={() => {
        if (connected && vmId) {
          window.open(codaWorkspaceUrl(vmId), '_blank', 'noopener,noreferrer');
        }
      }}
      data-testid="coda-open-workspace"
    >
      IDE
    </Button>
  );
}
