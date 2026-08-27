/**
 * Warns when the running Grafana is below the floor a guide's manifest declares.
 *
 * Warn-only: the steps stay live. A guide written against selectors or pages a
 * older release doesn't have fails as steps that never unblock, and this exists
 * to name that cause rather than to prevent the attempt.
 *
 * @see src/lib/guide-version.ts for the fail-open policy behind the verdict.
 */

import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { config } from '@grafana/runtime';
import { Alert, useStyles2 } from '@grafana/ui';

import { evaluateVersionSupport, resolveMinGrafanaVersion } from '../../../lib/guide-version';
import { testIds } from '../../../constants/testIds';

export interface GuideVersionNoticeProps {
  /** The open guide's manifest. Absent for docs pages and legacy learning journeys. */
  manifest?: Record<string, unknown>;
}

export function GuideVersionNotice({ manifest }: GuideVersionNoticeProps) {
  const styles = useStyles2(getStyles);

  const evaluation = evaluateVersionSupport({
    minGrafanaVersion: resolveMinGrafanaVersion(manifest),
    currentVersion: config.buildInfo?.version,
  });

  if (!evaluation.shouldWarn) {
    return null;
  }

  return (
    <div className={styles.container} data-testid={testIds.guideVersionNotice.container}>
      <Alert
        title={t('guideVersionNotice.title', 'This guide needs a newer Grafana')}
        severity="warning"
        className={styles.alert}
      >
        <p className={styles.body}>
          {t(
            'guideVersionNotice.body',
            'This guide is written for Grafana {{required}} or later, and this instance runs {{current}}. Some steps might not match what you see.',
            { required: evaluation.requiredVersion, current: evaluation.currentVersion }
          )}
        </p>
      </Alert>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({
    width: '100%',
  }),
  alert: css({
    marginBottom: 0,
  }),
  body: css({
    margin: 0,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
  }),
});
