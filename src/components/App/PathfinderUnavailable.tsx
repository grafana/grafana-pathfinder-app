import React from 'react';
import { t } from '@grafana/i18n';
import { config, locationService } from '@grafana/runtime';
import { Alert, Button } from '@grafana/ui';

export function PathfinderUnavailable({ unavailable }: { unavailable: boolean }) {
  const user = config.bootData?.user;
  const isAdmin = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';

  return (
    <Alert
      severity="info"
      title={
        unavailable
          ? t('pathfinder.unavailable', 'Pathfinder is unavailable')
          : t('pathfinder.disabled', 'Pathfinder is disabled')
      }
    >
      <p>
        {unavailable
          ? t('pathfinder.settingsUnavailable', 'Could not load Pathfinder settings. Reload Grafana to try again.')
          : t('pathfinder.disabledDescription', 'Pathfinder is turned off for this organization.')}
      </p>
      {isAdmin && (
        <Button onClick={() => locationService.push('/plugins/grafana-pathfinder-app?page=configuration')}>
          {t('pathfinder.openSettings', 'Open Pathfinder settings')}
        </Button>
      )}
    </Alert>
  );
}
