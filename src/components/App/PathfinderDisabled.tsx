import React from 'react';
import { t } from '@grafana/i18n';
import { config, locationService } from '@grafana/runtime';
import { Alert, Button } from '@grafana/ui';

export function PathfinderDisabled() {
  const user = config.bootData?.user;
  const isAdmin = user?.isGrafanaAdmin === true || user?.orgRole === 'Admin';

  return (
    <Alert severity="info" title={t('pathfinder.disabled', 'Pathfinder is disabled')}>
      <p>{t('pathfinder.disabledDescription', 'Pathfinder is turned off for this organization.')}</p>
      {isAdmin && (
        <Button onClick={() => locationService.push('/plugins/grafana-pathfinder-app?page=configuration')}>
          {t('pathfinder.openSettings', 'Open Pathfinder settings')}
        </Button>
      )}
    </Alert>
  );
}
