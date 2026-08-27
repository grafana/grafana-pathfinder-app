/**
 * Interactive-learning banner — treatment arm of
 * `pathfinder.interactive-learning-banner-experiment`.
 *
 * Explains what interactive learning is, at the top of the context page and again
 * above opened guide content — a guide reached by `?doc=`, a deep link, or the
 * highlighted-guide auto-open never passes through the context page at all. Renders
 * nothing for the control and excluded arms, so control is byte-identical to
 * pre-experiment behaviour.
 *
 * The two placements are never mounted at once (the sidebar's content area is an
 * if/else, and floating and full-screen have no context page), so the dismissal
 * needs no cross-instance plumbing: one localStorage key, re-read on every mount.
 */

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { t } from '@grafana/i18n';

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { getEnrolledInteractiveLearningBannerConfig } from '../../utils/experiments/interactive-learning-banner';
import { subscribeToEnrollment } from '../../utils/experiments/enrollment-notifier';
import { StorageKeys } from '../../lib/storage-keys';
import { testIds } from '../../constants/testIds';

/** Where the banner is rendered. Drives analytics only — the copy is the same. */
export type BannerPlacement = 'context-page' | 'guide';

// 'context-page' keeps the original value: it is already in the analytics stream.
const INTERACTION_LOCATIONS: Record<BannerPlacement, string> = {
  'context-page': 'interactive_learning_banner',
  guide: 'interactive_learning_banner_guide',
};

function getDismissalKey(): string {
  return `${StorageKeys.INTERACTIVE_LEARNING_BANNER_DISMISSED_PREFIX}${window.location.hostname}`;
}

function hasDismissed(): boolean {
  try {
    return localStorage.getItem(getDismissalKey()) === 'true';
  } catch {
    return false;
  }
}

function markDismissed(): void {
  try {
    localStorage.setItem(getDismissalKey(), 'true');
  } catch {
    // localStorage unavailable — the banner reappears next page load. Better than
    // failing the dismissal outright.
  }
}

// Both placements remount on every tab switch, so without this the shown event would
// count tab switches rather than banner impressions. One impression per page load,
// whichever placement got there first — which interaction_location then records.
let reportedShownThisPageLoad = false;

/** Resets the once-per-page-load impression guard. Test-only. */
export function clearBannerImpressionCache(): void {
  reportedShownThisPageLoad = false;
}

export function InteractiveLearningBanner({ placement = 'context-page' }: { placement?: BannerPlacement } = {}) {
  const styles = useStyles2(getStyles);
  const [dismissed, setDismissed] = useState(hasDismissed);

  // Read-only, never an evaluation: the panel-mount seams own enrollment. Enrolling
  // from here instead would let a render React replays or throws away burn the
  // exposure on a banner nobody saw. The subscription is what covers mounting before
  // a seam's effect runs, which floating and full-screen genuinely do — their manager
  // owns the seam, and child effects run before the parent's.
  const config = useSyncExternalStore(subscribeToEnrollment, getEnrolledInteractiveLearningBannerConfig);
  const isTreatment = config?.variant === 'treatment';

  const handleDismiss = useCallback(() => {
    markDismissed();
    setDismissed(true);
    reportAppInteraction(UserInteraction.InteractiveLearningBannerDismissed, {
      interaction_location: INTERACTION_LOCATIONS[placement],
    });
  }, [placement]);

  const isVisible = isTreatment && !dismissed;

  useEffect(() => {
    if (!isVisible || reportedShownThisPageLoad) {
      return;
    }
    reportedShownThisPageLoad = true;
    reportAppInteraction(UserInteraction.InteractiveLearningBannerShown, {
      interaction_location: INTERACTION_LOCATIONS[placement],
    });
  }, [isVisible, placement]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className={styles.container} data-testid={testIds.contextPanel.interactiveLearningBanner}>
      <Alert
        title={t('interactiveLearningBanner.title', 'Learn by doing')}
        severity="info"
        onRemove={handleDismiss}
        className={styles.alert}
      >
        <p className={styles.body}>
          {t(
            'interactiveLearningBanner.body',
            'Interactive guides walk you through Grafana one step at a time. "Show me" highlights the control to use, and "Do it" performs the step for you.'
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
