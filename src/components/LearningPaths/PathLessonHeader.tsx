import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, useStyles2 } from '@grafana/ui';
import { PathLessonProgressBar, type usePathLessonProgress } from './PathLessonProgressBar';

interface PathLessonHeaderProps {
  title: string;
  progress: ReturnType<typeof usePathLessonProgress>;
  actions?: React.ReactNode;
  showProgressBar?: boolean;
  className?: string;
}

export function PathLessonHeader({
  title,
  progress,
  actions,
  showProgressBar = true,
  className,
}: PathLessonHeaderProps) {
  const styles = useStyles2(getStyles);
  const progressLabel = progress.segments.length > 0 && (
    <Text variant="sm" color="secondary">
      {progress.label}
    </Text>
  );

  return (
    <div className={cx(styles.container, className)}>
      <div className={styles.titleRow}>
        <div className={styles.title}>
          <Text element="p" variant="base" weight={showProgressBar ? 'medium' : undefined} truncate>
            {title}
          </Text>
          {!showProgressBar && progressLabel}
        </div>
        {actions && (
          <nav className={styles.actions} aria-label="Learning path navigation">
            {actions}
          </nav>
        )}
      </div>
      {showProgressBar && progressLabel && (
        <div className={styles.progressRow}>
          <PathLessonProgressBar className={styles.progressBar} progress={progress} />
          {progressLabel}
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  titleRow: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1) }),
  title: css({ flex: 1, minWidth: 0 }),
  actions: css({
    display: 'flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 0,
    '& > button': {
      margin: 0,
      minWidth: theme.spacing(3),
      minHeight: theme.spacing(3),
    },
  }),
  progressRow: css({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: theme.spacing(1) }),
  progressBar: css({ flex: '1 1 0%', minWidth: theme.spacing(8) }),
});
