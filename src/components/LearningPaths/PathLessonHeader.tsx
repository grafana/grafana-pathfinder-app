import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Text, useStyles2 } from '@grafana/ui';
import { PathLessonProgressBar, type usePathLessonProgress } from './PathLessonProgressBar';

interface PathLessonHeaderProps {
  title?: string;
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
    <LessonReaderHeader
      title={title}
      emphasizeTitle={showProgressBar}
      titleDetail={!showProgressBar && progressLabel}
      navigation={actions}
      className={className}
    >
      {showProgressBar && progressLabel && (
        <div className={styles.progressRow}>
          <PathLessonProgressBar className={styles.progressBar} progress={progress} />
          {progressLabel}
        </div>
      )}
    </LessonReaderHeader>
  );
}

export function LessonReaderHeader({
  title,
  titleElement = 'p',
  emphasizeTitle = true,
  titleDetail,
  navigation,
  navigationLabel = 'Learning path navigation',
  className,
  children,
}: React.PropsWithChildren<{
  title?: string;
  titleElement?: 'h1' | 'p';
  emphasizeTitle?: boolean;
  titleDetail?: React.ReactNode;
  navigation?: React.ReactNode;
  navigationLabel?: string;
  className?: string;
}>) {
  const styles = useStyles2(getStyles);
  return (
    <div className={cx(styles.container, className)}>
      <div className={styles.titleRow}>
        {title !== undefined && (
          <div className={styles.title}>
            <Text element={titleElement} variant="base" weight={emphasizeTitle ? 'medium' : undefined} title={title}>
              {title}
            </Text>
            {titleDetail}
          </div>
        )}
        {navigation && (
          <nav className={styles.actions} aria-label={navigationLabel}>
            {navigation}
          </nav>
        )}
      </div>
      {children}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({ display: 'flex', flexDirection: 'column', gap: theme.spacing(0.5) }),
  titleRow: css({ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: theme.spacing(1) }),
  title: css({
    flex: 1,
    minWidth: 0,
    // Grafana Text's truncate tooltip can loop when mounted in the floating reader.
    '& > :first-child': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
  }),
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
