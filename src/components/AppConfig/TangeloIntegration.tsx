import React, { useEffect, useState } from 'react';
import { Alert, Badge, FieldSet, Switch, Text, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { css } from '@emotion/css';
import { lastValueFrom } from 'rxjs';

import { PLUGIN_BACKEND_URL } from '../../constants';
import { testIds } from '../../constants/testIds';
import { logger } from '../../lib/logging';
import { fetchPluginSettings, updatePluginSettings } from '../../utils/utils.plugin';

const STATUS_URL = `${PLUGIN_BACKEND_URL}/tangelo-integration/status`;

export interface TangeloStatus {
  credentialsPresent: boolean;
  enabled: boolean;
}

export async function fetchTangeloStatus(): Promise<TangeloStatus | null> {
  try {
    const response = await lastValueFrom(
      getBackendSrv().fetch<Partial<TangeloStatus>>({ url: STATUS_URL, method: 'GET', showErrorAlert: false })
    );
    return {
      credentialsPresent: response.data?.credentialsPresent === true,
      enabled: response.data?.enabled === true,
    };
  } catch {
    return null;
  }
}

/** Writes only the enable switch; every other jsonData key, and all secureJsonData, is left as it is. */
export async function saveTangeloEnabled(pluginId: string, enabled: boolean): Promise<void> {
  const current = await fetchPluginSettings(pluginId);
  await updatePluginSettings(pluginId, {
    enabled: current.enabled,
    pinned: current.pinned,
    jsonData: { ...current.jsonData, tangeloCompletionEnabled: enabled },
  });
}

type CredentialsState = 'loading' | 'present' | 'missing' | 'unknown';

interface TangeloIntegrationProps {
  pluginId: string;
  enabled: boolean;
  className?: string;
}

/**
 * The credentials are provisioned per stack into secureJsonData and never
 * entered here, so this section only switches the webhook and reports whether
 * the backend holds them.
 */
export function TangeloIntegration({ pluginId, enabled, className }: TangeloIntegrationProps) {
  const s = useStyles2(getStyles);
  const [credentials, setCredentials] = useState<CredentialsState>('loading');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchTangeloStatus().then((status) => {
      if (!cancelled) {
        setCredentials(status === null ? 'unknown' : status.credentialsPresent ? 'present' : 'missing');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await saveTangeloEnabled(pluginId, event.currentTarget.checked);
      setTimeout(() => window.location.reload(), 100);
    } catch (error) {
      logger.error('Failed to save Tangelo integration setting', { error });
      setSaving(false);
      setSaveFailed(true);
    }
  };

  return (
    <FieldSet
      label={
        <div className={s.label}>
          Tangelo integration
          <Badge text="Prototype" color="orange" />
        </div>
      }
      className={className}
    >
      <div className={s.toggleSection}>
        <Switch
          id="enable-tangelo-completion"
          data-testid={testIds.appConfig.tangeloToggle}
          value={enabled}
          disabled={saving}
          onChange={onToggle}
        />
        <div className={s.toggleLabels}>
          <Text variant="body" weight="medium">
            Report guide completions to Tangelo
          </Text>
          <Text variant="body" color="secondary">
            When a learner completes a guide, Grafana tells Tangelo the learner&apos;s email and the page they were on.
            Saving reloads the page.
          </Text>
        </div>
      </div>
      <div data-testid={testIds.appConfig.tangeloCredentials}>
        <CredentialsIndicator state={credentials} />
      </div>
      {saveFailed && (
        <Alert severity="error" title="Could not save the Tangelo integration setting" className={s.marginTop}>
          Try again. You may need admin permissions.
        </Alert>
      )}
    </FieldSet>
  );
}

function CredentialsIndicator({ state }: { state: CredentialsState }) {
  switch (state) {
    case 'loading':
      return null;
    case 'present':
      return <Badge color="green" icon="check" text="Tangelo credentials are provisioned for this stack" />;
    case 'missing':
      return <Badge color="red" icon="exclamation-triangle" text="Tangelo credentials are not provisioned" />;
    case 'unknown':
      return <Badge color="orange" icon="question-circle" text="Could not check Tangelo credentials" />;
  }
}

const getStyles = (theme: GrafanaTheme2) => ({
  label: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  toggleSection: css`
    display: flex;
    align-items: flex-start;
    gap: ${theme.spacing(2)};
    margin-bottom: ${theme.spacing(2)};
  `,
  toggleLabels: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    flex: 1;
  `,
  marginTop: css`
    margin-top: ${theme.spacing(2)};
  `,
});
