import React, { useMemo } from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { Badge, Button, InteractiveTable, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { formatDueDate, getDueStatus, type LearningPathEntry } from '../../../learning-paths';
import { dueLabel } from '../AssignmentBadges';
import { ProgressRing } from '../ProgressRing';
import { SkeletonLoader } from '../../SkeletonLoader';

type Columns = React.ComponentProps<typeof InteractiveTable<LearningPathEntry>>['columns'];

export function HomeAssignmentsTable({
  entries,
  onView,
  selectedCardKey,
  isLoading = false,
  hasError = false,
  onRetry,
}: {
  entries: LearningPathEntry[];
  onView: (entry: LearningPathEntry) => void;
  selectedCardKey?: string | null;
  isLoading?: boolean;
  hasError?: boolean;
  onRetry?: () => void;
}) {
  const styles = useStyles2(getStyles);
  const columns = useMemo<Columns>(
    () => [
      {
        id: 'assignment',
        header: t('myLearning.assignmentTitle', 'Assignment'),
        cell: ({ row: { original: entry } }) => (
          <div className={styles.courseCell}>
            <button
              type="button"
              className={cx(styles.course, styles.truncated)}
              title={entry.path.title}
              data-assignment-key={entry.key}
              aria-current={selectedCardKey === entry.key ? 'true' : undefined}
              onClick={() => onView(entry)}
            >
              {entry.path.title}
            </button>
            {entry.assignment?.trackLabel && (
              <span className={cx(styles.track, styles.truncated)} title={entry.assignment.trackLabel}>
                {t('myLearning.assignedTrack', 'Track')} {entry.assignment.trackLabel}
              </span>
            )}
          </div>
        ),
      },
      {
        id: 'progress',
        header: t('myLearning.assignmentProgress', 'Progress'),
        cell: ({ row: { original: entry } }) => (
          <ProgressRing progress={entry.percent} size={32} strokeWidth={2} showPercentage />
        ),
      },
      {
        id: 'assignedAt',
        header: t('myLearning.assignedDate', 'Assigned'),
        cell: ({ row: { original: entry } }) => {
          const value = entry.assignment?.assignedAt;
          const date = value ? new Date(value) : undefined;
          return date && Number.isFinite(date.getTime()) ? (
            <time dateTime={value}>
              {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </time>
          ) : (
            '—'
          );
        },
      },
      {
        id: 'dueAt',
        header: t('myLearning.assignmentDueDate', 'Due'),
        cell: ({ row: { original: entry } }) => {
          const status = entry.assignment ? getDueStatus(entry.assignment) : undefined;
          return status ? (
            <div className={styles.due}>
              <time dateTime={entry.assignment?.dueAt}>{formatDueDate(entry.assignment!.dueAt!)}</time>
              {status.tone !== 'later' && (
                <Badge color={status.tone === 'overdue' ? 'red' : 'orange'} text={dueLabel(status)} />
              )}
            </div>
          ) : (
            '—'
          );
        },
      },
      {
        id: 'assignedBy',
        header: t('myLearning.assignedBy', 'Assigned by'),
        cell: ({ row: { original: entry } }) => (
          <span className={styles.truncated} title={entry.assignment?.assignedBy}>
            {entry.assignment?.assignedBy || '—'}
          </span>
        ),
      },
    ],
    [onView, selectedCardKey, styles]
  );
  const error = hasError && (
    <div role="alert">
      <p className={styles.emptyTitle}>{t('myLearning.assignmentsLoadError', 'Assignments couldn’t be loaded.')}</p>
      <Button variant="secondary" fill="text" size="sm" onClick={onRetry} disabled={isLoading}>
        {t('common.retry', 'Retry')}
      </Button>
    </div>
  );

  return (
    <div
      role="presentation"
      className={styles.container}
      onClick={(event) => {
        if (!(event.target instanceof Element) || event.target.closest('button')) {
          return;
        }
        const button = event.target
          .closest('tbody tr')
          ?.querySelector<HTMLButtonElement>('button[data-assignment-key]');
        const entry = entries.find((candidate) => candidate.key === button?.dataset.assignmentKey);
        if (entry) {
          onView(entry);
        }
      }}
    >
      {entries.length > 0 && error}
      {entries.length ? (
        <InteractiveTable data={entries} columns={columns} getRowId={getRowId} className={styles.table} />
      ) : (
        <table className={cx(styles.table, styles.emptyTable)}>
          <tbody>
            <tr>
              <td colSpan={columns.length}>
                {isLoading ? (
                  <div role="status" aria-label={t('myLearning.loadingAssignments', 'Loading assignments…')}>
                    <SkeletonLoader type="recommendations" />
                  </div>
                ) : hasError ? (
                  error
                ) : (
                  <>
                    <p className={styles.emptyTitle}>{t('myLearning.assignmentsClear', 'You’re all clear!')}</p>
                    <p className={styles.emptyDescription}>
                      {t(
                        'myLearning.assignmentsEmptyDescription',
                        'No assignments right now. Explore a guide or learning path while you’re here.'
                      )}
                    </p>
                  </>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

const getRowId = (entry: LearningPathEntry) => entry.key;

const getStyles = (theme: GrafanaTheme2) => ({
  container: css({ '& > div': { overflow: 'visible' } }),
  emptyTable: css({
    width: '100%',
    '&&&': { minWidth: 0 },
    '&&& tbody tr': { cursor: 'default', '&:hover': { background: 'none' } },
    '&&& td': { height: theme.spacing(14), textAlign: 'center', whiteSpace: 'normal', padding: theme.spacing(3, 2) },
  }),
  emptyTitle: css({ ...theme.typography.base, fontWeight: theme.typography.fontWeightMedium, margin: 0 }),
  emptyDescription: css({
    ...theme.typography.base,
    color: theme.colors.text.secondary,
    margin: theme.spacing(0.5, 0, 0),
  }),
  table: css({
    '&&': {
      ...theme.typography.base,
      minWidth: theme.spacing(120),
      tableLayout: 'fixed',
      borderCollapse: 'separate',
      borderSpacing: 0,
      '& th': {
        position: 'sticky',
        top: 0,
        zIndex: 1,
        background: theme.colors.background.secondary,
        ...theme.typography.base,
        fontWeight: theme.typography.fontWeightMedium,
        color: theme.colors.text.primary,
        padding: theme.spacing(0.75, 2),
        height: `calc(${theme.spacing(5.5)} + 1px)`,
        textAlign: 'left',
      },
      '& th, & td': {
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      '& td': { padding: theme.spacing(0.75, 2), borderBottom: `1px solid ${theme.colors.border.weak}` },
      '& tbody tr': { cursor: 'pointer' },
      '& tbody tr:hover': { background: theme.colors.action.hover },
      '& tbody tr:has(button[aria-current="true"])': { background: theme.colors.action.selected },
      '& tbody tr:last-child td': { borderBottom: 0 },
      '& th:nth-child(1)': { width: '34%' },
      '& th:nth-child(2)': { width: '10%' },
      '& th:nth-child(3)': { width: '15%' },
      '& th:nth-child(4)': { width: '21%' },
      '& th:nth-child(5)': { width: '20%' },
      '& th:nth-child(2), & td:nth-child(2)': { textAlign: 'center' },
      '& td:nth-child(2)': { lineHeight: 0 },
    },
  }),
  course: css({
    minWidth: 0,
    flex: '0 1 auto',
    font: 'inherit',
    color: theme.colors.text.link,
    background: 'none',
    border: 0,
    padding: 0,
    textAlign: 'left',
    cursor: 'pointer',
    '&:hover': { textDecoration: 'underline' },
    '&:focus-visible': { outline: `2px solid ${theme.colors.primary.main}`, outlineOffset: 2 },
  }),
  courseCell: css({ display: 'flex', alignItems: 'center', gap: theme.spacing(1), minWidth: 0 }),
  truncated: css({
    display: 'block',
    maxWidth: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  }),
  track: css({ ...theme.typography.sm, color: theme.colors.text.secondary, flexShrink: 0, maxWidth: '45%' }),
  due: css({ display: 'flex', alignItems: 'center', flexWrap: 'nowrap', gap: theme.spacing(1) }),
});
