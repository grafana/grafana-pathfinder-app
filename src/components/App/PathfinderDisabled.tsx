import React from 'react';
import { t } from '@grafana/i18n';
import { locationService } from '@grafana/runtime';
import { Alert, Button } from '@grafana/ui';

import { useCurrentUserIsAdmin } from '../../utils/current-user-role';

export function PathfinderDisabled() {
  const isAdmin = useCurrentUserIsAdmin();

  return (
    <Alert severity="info" title={t('pathfinder.disabled', 'Interactive learning is disabled')}>
      <p>{t('pathfinder.disabledDescription', 'Interactive learning is turned off for this organization.')}</p>
      {isAdmin && (
        <Button onClick={() => locationService.push('/plugins/grafana-pathfinder-app?page=configuration')}>
          {t('pathfinder.openSettings', 'Open interactive learning settings')}
        </Button>
      )}
    </Alert>
  );
}
