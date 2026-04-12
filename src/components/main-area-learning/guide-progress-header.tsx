/**
 * Guide Progress Header
 *
 * Displays guide title and completion progress above the content area
 * in the main-area learning view.
 *
 * Progress updates via:
 * - Initial async read from interactiveCompletionStorage
 * - Real-time `interactive-progress-saved` window events from interactive components
 */

import React, { useState, useEffect } from 'react';
import { useStyles2 } from '@grafana/ui';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';

import { interactiveCompletionStorage } from '../../lib/user-storage';
import { testIds } from '../../constants/testIds';

type LayoutWidth = 'default' | 'wide' | 'full';

interface GuideProgressHeaderProps {
  title: string;
  contentKey: string;
  layoutWidth?: LayoutWidth;
}

export function GuideProgressHeader({ title, contentKey, layoutWidth = 'default' }: GuideProgressHeaderProps) {
  const styles = useStyles2(getStyles);
  const headerMaxWidth = layoutWidth === 'full' ? 'none' : layoutWidth === 'wide' ? '72rem' : '48rem';
  const [progress, setProgress] = useState(0);

  // Fetch initial progress from storage
  useEffect(() => {
    let cancelled = false;

    interactiveCompletionStorage.get(contentKey).then((value) => {
      if (!cancelled) {
        setProgress(value);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [contentKey]);

  // Listen for real-time progress updates from interactive components
  useEffect(() => {
    const handleProgressSaved = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.contentKey === contentKey && typeof detail?.completionPercentage === 'number') {
        setProgress(detail.completionPercentage);
      }
    };

    window.addEventListener('interactive-progress-saved', handleProgressSaved);
    return () => {
      window.removeEventListener('interactive-progress-saved', handleProgressSaved);
    };
  }, [contentKey]);

  const roundedProgress = Math.round(progress);

  return (
    <div
      className={styles.header}
      style={{ maxWidth: headerMaxWidth }}
      data-testid={testIds.mainAreaLearning.progressHeader}
    >
      <div className={styles.headerRow}>
        <h2 className={styles.title}>{title}</h2>
        <div className={styles.actions}>
          {roundedProgress > 0 && <span className={styles.progressText}>{roundedProgress}% complete</span>}
        </div>
      </div>
      <div className={styles.progressBar} data-testid={testIds.mainAreaLearning.progressBar}>
        <div className={styles.progressFill} style={{ width: `${roundedProgress}%` }} />
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  header: css({
    maxWidth: '48rem',
    marginLeft: 'auto',
    marginRight: 'auto',
    width: '100%',
    marginBottom: theme.spacing(2),
  }),
  headerRow: css({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.spacing(2),
    marginBottom: theme.spacing(1),
  }),
  title: css({
    fontSize: theme.typography.h3.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    margin: 0,
    lineHeight: 1.3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  }),
  actions: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    flexShrink: 0,
  }),
  progressText: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    whiteSpace: 'nowrap',
  }),
  progressBar: css({
    width: '100%',
    height: '3px',
    backgroundColor: theme.colors.background.secondary,
    borderRadius: '2px',
    overflow: 'hidden',
  }),
  progressFill: css({
    height: '100%',
    backgroundColor: theme.colors.success.main,
    transition: 'width 0.3s ease',
  }),
});
