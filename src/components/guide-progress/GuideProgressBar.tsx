import React, { useCallback, useSyncExternalStore } from 'react';
import { css } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';

import { peekGuidePercentage, subscribeProgress } from '../../global-state/completion-store';
import { resolveGuideContentKey } from '../../global-state/guide-content-key';

interface GuideProgressBarProps {
  /**
   * The rendered guide's URL. Resolved to the progress storage key with the
   * SAME resolver the Mark complete footer uses, so this bar and the footer can
   * never report different numbers for the same guide.
   */
  contentUrl?: string;
}

/** No key resolved yet, so there is nothing to subscribe to. */
const NO_SUBSCRIPTION = () => undefined;

/**
 * Sticky guide progress bar.
 *
 * A read-only mirror of the completion percentage already shown by the
 * `MarkCompleteFooter`, pinned to the top of the guide panel so progress stays
 * visible while the reader scrolls. It intentionally renders ONLY the
 * track + "NN% complete" label — the "Mark complete" action stays at the foot
 * of the guide where it belongs.
 *
 * It reads from the same source as the footer (`peekGuidePercentage` /
 * `subscribeProgress`, keyed via `resolveGuideContentKey`). Because the guide
 * completion mark is already folded into that percentage (a marked guide reads
 * 100), this bar reaches 100% exactly when the footer does — the two can never
 * disagree.
 */
export function GuideProgressBar({ contentUrl }: GuideProgressBarProps): React.ReactElement | null {
  const styles = useStyles2(getStyles);
  const contentKey = contentUrl === undefined ? undefined : resolveGuideContentKey(contentUrl);

  const percentage = useSyncExternalStore(
    useCallback(
      (listener: () => void) => (contentKey === undefined ? NO_SUBSCRIPTION : subscribeProgress(contentKey, listener)),
      [contentKey]
    ),
    useCallback(() => (contentKey === undefined ? 0 : peekGuidePercentage(contentKey)), [contentKey])
  );

  if (contentKey === undefined) {
    return null;
  }

  return (
    <div
      className={styles.sticky}
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={t('guideProgress.label', 'Guide progress: {{percent}}% complete', { percent: percentage })}
    >
      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${percentage}%` }} />
      </div>
      <span className={styles.percentage}>
        {t('guideProgress.percentComplete', '{{percent}}% complete', { percent: percentage })}
      </span>
    </div>
  );
}

function getStyles(theme: GrafanaTheme2) {
  return {
    sticky: css({
      position: 'sticky',
      top: 0,
      zIndex: 2,
      display: 'flex',
      alignItems: 'center',
      gap: theme.spacing(1),
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
      fontSize: theme.typography.bodySmall.fontSize,
      whiteSpace: 'nowrap',
    }),
  };
}
