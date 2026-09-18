/**
 * Warns when the running Grafana is below the floor a guide's manifest declares.
 *
 * Warn-only: the steps stay live. A guide written against selectors or pages a
 * older release doesn't have fails as steps that never unblock, and this exists
 * to name that cause rather than to prevent the attempt.
 *
 * The `guide_version_unsupported_shown` event is emitted from here, not from the
 * load path: the notice renders only in the surface the reader is looking at, so
 * a background tab load, a milestone step, or a reload cannot manufacture an
 * observation of a warning nobody saw. Remounts — tab switch, surface handoff —
 * are deduplicated per warning for the app load.
 *
 * @see src/lib/guide-version.ts for the fail-open policy behind the verdict.
 */

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
  /**
   * The open guide's manifests, most authoritative first. Absent for docs pages
   * and legacy learning journeys.
   */
  manifests?: ManifestCandidates;
  /** Identifies the guide in the impression event and its dedupe key. */
  guideUrl?: string;
  guideTitle?: string;
}

const reportedImpressions = new Set<string>();

/** Test-only: the dedupe set outlives a single render tree by design. */
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
