import React from 'react';
import { css } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

export function LearningCardMetadata({
  progress,
  kind = 'path',
  effort,
  completion,
  opening = false,
}: {
  progress: number;
  kind?: 'path' | 'guide';
  effort?: React.ReactNode;
  completion?: { completed: number; total: number };
  opening?: boolean;
}) {
  const styles = useStyles2(getStyles);
  const status =
    progress >= 100
      ? t('learningCard.completed', 'Completed')
      : kind === 'path'
        ? progress > 0 && completion
          ? t('learningCard.completedOfTotal', '{{completed}} of {{total}} completed', completion)
          : undefined
        : effort;
  return (
    <div className={styles.line}>
      {status && <span className={progress >= 100 ? styles.completed : styles.status}>{status}</span>}
      <span className={styles.type}>
        {status && (
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
        )}
        {opening ? (
          <span role="status">{t('learningCard.opening', 'Opening…')}</span>
        ) : (
          <span>{kind === 'path' ? t('learningCard.path', 'Learning path') : t('learningCard.guide', 'Guide')}</span>
        )}
      </span>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  line: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: theme.spacing(1.5),
    rowGap: 0,
    minWidth: 0,
    overflow: 'hidden',
  }),
  status: css({ whiteSpace: 'nowrap' }),
  completed: css({ color: theme.colors.success.text, whiteSpace: 'nowrap' }),
  type: css({ position: 'relative', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }),
  separator: css({ position: 'absolute', left: theme.spacing(-1), width: theme.spacing(0.5), textAlign: 'center' }),
});
