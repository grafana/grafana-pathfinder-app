import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { css, cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import { peekGuidePercentage, subscribeProgress } from '../../global-state/completion-store';
import { resolveGuideContentKey } from '../../global-state/guide-content-key';
import { testIds } from '../../constants/testIds';
import {
  getGuideIndex,
  subscribeGuideIndexPublications,
  getGuideIndexPublicationRevision,
  subscribeGuideIndexEvictions,
  getGuideIndexEvictionRevision,
} from '../../global-state/active-guide-index';
import { subscribeGuideProgressRevision, getGuideProgressRevision } from '../../global-state/progress-events';
import { useDocumentStepProgressFromEvents } from '../../hooks';
import { guideStepCompletionPercent } from '../../lib/guide-stats';

interface GuideProgressBarProps {
  contentUrl?: string;
  isCoverPage?: boolean;
  inToolbar?: boolean;
}

const NO_SUBSCRIPTION = () => undefined;

export function GuideProgressBar({
  contentUrl,
  isCoverPage = false,
  inToolbar = false,
}: GuideProgressBarProps): React.ReactElement | null {
  const styles = useStyles2(getStyles);
  const stepProgress = useDocumentStepProgressFromEvents(inToolbar && !isCoverPage);

  const [resolved, setResolved] = useState<{ contentUrl: string; contentKey: string } | null>(null);

  useEffect(() => {
    if (contentUrl === undefined) {
      return;
    }
    const contentKey = resolveGuideContentKey(contentUrl);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Ambient key publishers run in layout effects, after render.
    setResolved({ contentUrl, contentKey });
  }, [contentUrl]);

  const contentKey = resolved !== null && resolved.contentUrl === contentUrl ? resolved.contentKey : undefined;

  useSyncExternalStore(subscribeGuideProgressRevision, getGuideProgressRevision, getGuideProgressRevision);
  useSyncExternalStore(
    subscribeGuideIndexPublications,
    getGuideIndexPublicationRevision,
    getGuideIndexPublicationRevision
  );
  useSyncExternalStore(subscribeGuideIndexEvictions, getGuideIndexEvictionRevision, getGuideIndexEvictionRevision);

  const percentage = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (contentKey === undefined ? NO_SUBSCRIPTION : subscribeProgress(contentKey, listener)),
      [contentKey]
    ),
    useCallback(() => (contentKey === undefined ? 0 : peekGuidePercentage(contentKey)), [contentKey])
  );

  const activeIndex = contentKey === undefined ? undefined : getGuideIndex(contentKey);
  const steps = stepProgress?.contentKey === contentKey ? stepProgress : undefined;
  if (isCoverPage || (!steps && !activeIndex?.index.completableBlockCount)) {
    return null;
  }

  const filledPercent = steps ? guideStepCompletionPercent(steps.completed, steps.total) : percentage;
  const stepLabel = steps
    ? t('guideProgress.stepsCompleted', '{{completed}} of {{count}} steps completed', {
        completed: steps.completed,
        count: steps.total,
        defaultValue_one: '{{completed}} of {{count}} step completed',
      })
    : undefined;

  return (
    <div
      className={cx(styles.container, inToolbar ? styles.toolbar : styles.sticky)}
      data-testid={testIds.guideProgress.bar}
      role="progressbar"
      aria-valuenow={steps?.completed ?? percentage}
      aria-valuemin={0}
      aria-valuemax={steps?.total ?? 100}
      aria-valuetext={stepLabel}
      aria-label={
        steps
          ? t('learningCard.guide', 'Guide')
          : t('guideProgress.label', 'Guide progress: {{percent}}% complete', { percent: percentage })
      }
    >
      <div className={cx(styles.track, inToolbar && styles.toolbarTrack)}>
        <div className={styles.fill} style={{ width: `${filledPercent}%` }} />
      </div>
      <span className={styles.percentage} data-testid={testIds.guideProgress.percentage}>
        {stepLabel ?? t('guideProgress.percentComplete', '{{percent}}% complete', { percent: percentage })}
      </span>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    container: css({
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
    }),
    toolbar: css({
      flexWrap: 'wrap',
    }),
    sticky: css({
      position: 'sticky',
      top: 0,
      zIndex: 2,
      backgroundColor: theme.colors.background.canvas,
      padding: theme.spacing(0.5, 1),
      borderBottom: `1px solid ${theme.colors.border.weak}`,
    }),
    track: css({
      flex: 1,
      minWidth: 0,
      height: '4px',
      borderRadius: theme.shape.radius.pill,
      backgroundColor: theme.colors.background.secondary,
      overflow: 'hidden',
    }),
    toolbarTrack: css({
      flex: '1 1 0%',
      minWidth: theme.spacing(8),
    }),
    fill: css({
      height: '100%',
      backgroundColor: theme.colors.success.main,
      transition: 'width 600ms ease-out',
      '@media (prefers-reduced-motion: reduce)': {
        transition: 'none',
      },
    }),
    percentage: css({
      color: theme.colors.text.secondary,
      fontSize: theme.typography.sm.fontSize,
      lineHeight: theme.typography.sm.lineHeight,
      whiteSpace: 'nowrap',
    }),
  };
}
