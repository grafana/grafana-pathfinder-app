import React, { useEffect, useState } from 'react';
import { Button } from '@grafana/ui';
import { config, locationService } from '@grafana/runtime';
import { codaWorkspaceUrl, codaSupports, isCodaUsable } from './coda-api';
import { loadCodaCapabilities } from './useCodaAvailability.hook';
import { panelModeManager } from '../../global-state/panel-mode';
import { testIds } from '../../constants/testIds';

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
    void loadCodaCapabilities()
      .then((caps) => {
        if (active) {
          setAvailable(
            Boolean(
              caps &&
              isCodaUsable(caps) &&
              codaSupports(caps, 'workspace-files') &&
              codaSupports(caps, 'explicit-vm-attachment')
            )
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
      tooltip="Open IDE connected to this VM"
      className={className}
      disabled={!connected || !vmId}
      onClick={() => {
        if (connected && vmId) {
          const url = codaWorkspaceUrl(vmId);
          if (panelModeManager.getMode() === 'fullscreen') {
            // Same-tab navigation would unmount the fullscreen guide and its terminal.
            window.open(url, '_blank', 'noopener,noreferrer');
          } else {
            locationService.push(url.slice(config.appSubUrl?.length ?? 0));
          }
        }
      }}
      data-testid={testIds.codaTerminal.openIdeButton}
    >
      IDE
    </Button>
  );
}
