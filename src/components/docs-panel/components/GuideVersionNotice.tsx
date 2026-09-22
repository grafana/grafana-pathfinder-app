import React, { useEffect } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { config } from '@grafana/runtime';
import { Alert, useStyles2 } from '@grafana/ui';

import { evaluateVersionSupport, resolveMinGrafanaVersion, type ManifestCandidates } from '../../../lib/guide-version';
import { reportAppInteraction, UserInteraction } from '../../../lib/analytics';
import { testIds } from '../../../constants/testIds';

export interface GuideVersionNoticeProps {
  manifests?: ManifestCandidates;
  guideUrl?: string;
  guideTitle?: string;
}

const reportedImpressions = new Set<string>();

export function resetGuideVersionImpressions() {
  reportedImpressions.clear();
}

export function GuideVersionNotice({ manifests, guideUrl, guideTitle }: GuideVersionNoticeProps) {
  const styles = useStyles2(getStyles);

  const evaluation = evaluateVersionSupport({
    minGrafanaVersion: resolveMinGrafanaVersion(manifests),
    currentVersion: config.buildInfo?.version,
  });

  const requiredVersion = evaluation.shouldWarn ? evaluation.requiredVersion : null;
  const currentVersion = evaluation.shouldWarn ? evaluation.currentVersion : null;

  useEffect(() => {
    if (requiredVersion === null || currentVersion === null) {
      return;
    }
    const impressionKey = `${guideUrl ?? ''}|${requiredVersion}|${currentVersion}`;
    if (reportedImpressions.has(impressionKey)) {
      return;
    }
    reportedImpressions.add(impressionKey);
    reportAppInteraction(UserInteraction.GuideVersionUnsupportedShown, {
      guide_url: guideUrl ?? '',
      guide_title: guideTitle ?? '',
      required_version: requiredVersion,
      grafana_version: currentVersion,
    });
  }, [requiredVersion, currentVersion, guideUrl, guideTitle]);

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
