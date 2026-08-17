/**
 * Interactive-learning banner — treatment arm of
 * `pathfinder.interactive-learning-banner-experiment`.
 *
 * Explains what interactive learning is at the top of the context page, with a CTA
 * that starts a bubble tour of the panel. Renders nothing for the control and
 * excluded arms, so control is byte-identical to pre-experiment behaviour.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, useStyles2 } from '@grafana/ui';
import { GrafanaTheme2 } from '@grafana/data';
import { css } from '@emotion/css';
import { t } from '@grafana/i18n';

import { reportAppInteraction, UserInteraction } from '../../lib/analytics';
import { enrollInteractiveLearningBannerExperiment } from '../../utils/experiments/interactive-learning-banner';
import { StorageKeys } from '../../lib/storage-keys';
import { testIds } from '../../constants/testIds';
import { startInteractiveLearningTour } from './tour-store';

const INTERACTION_LOCATION = 'interactive_learning_banner';

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

// The context panel remounts on every tab switch, so without this the shown event
// would count tab switches rather than banner impressions.
let reportedShownThisPageLoad = false;

/** Resets the once-per-page-load impression guard. Test-only. */
export function clearBannerImpressionCache(): void {
  reportedShownThisPageLoad = false;
}

export function InteractiveLearningBanner() {
  const styles = useStyles2(getStyles);
  const [dismissed, setDismissed] = useState(hasDismissed);

  // Enrollment happens at the sidebar-mount seam in module.tsx; this call covers the
  // floating and full-screen surfaces, where that effect never runs. Memoised
  // upstream, so whichever fires first is the only evaluation.
  const { variant } = useMemo(() => enrollInteractiveLearningBannerExperiment(), []);
  const isTreatment = variant === 'treatment';

  const handleDismiss = useCallback(() => {
    markDismissed();
    setDismissed(true);
    reportAppInteraction(UserInteraction.InteractiveLearningBannerDismissed, {
      interaction_location: INTERACTION_LOCATION,
    });
  }, []);

  const handleStartTour = useCallback(() => {
    reportAppInteraction(UserInteraction.InteractiveLearningTourStarted, {
      interaction_location: INTERACTION_LOCATION,
    });
    startInteractiveLearningTour();
  }, []);

  const isVisible = isTreatment && !dismissed;

  useEffect(() => {
    if (!isVisible || reportedShownThisPageLoad) {
      return;
    }
    reportedShownThisPageLoad = true;
    reportAppInteraction(UserInteraction.InteractiveLearningBannerShown, {
      interaction_location: INTERACTION_LOCATION,
    });
  }, [isVisible]);

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
        <Button
          variant="secondary"
          size="sm"
          icon="play"
          onClick={handleStartTour}
          data-testid={testIds.contextPanel.interactiveLearningBannerCta}
        >
          {t('interactiveLearningBanner.cta', 'Show me around')}
        </Button>
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
    margin: `0 0 ${theme.spacing(1.5)} 0`,
    fontSize: theme.typography.bodySmall.fontSize,
    lineHeight: theme.typography.bodySmall.lineHeight,
  }),
});
