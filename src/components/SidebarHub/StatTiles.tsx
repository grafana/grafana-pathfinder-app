import React from 'react';
import { cx } from '@emotion/css';
import { useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { formatDueDate, type HubDue, type HubStats } from '../../learning-paths';
import { testIds } from '../../constants/testIds';
import { getSidebarHubStyles } from './sidebar-hub.styles';

function dueCaption(due: HubDue): string {
  switch (due.tone) {
    case 'today':
      return t('sidebarHub.dueToday', 'Due today');
    case 'later':
      return due.days === 1
        ? t('sidebarHub.dueTomorrow', 'Due tomorrow')
        : t('sidebarHub.dueInDays', 'Due in {{count}} days', { count: due.days });
    case 'overdue':
      return t('sidebarHub.dueOn', 'Due {{- date}}', { date: formatDueDate(due.dueAt) });
  }
}

export type HubTile = 'assignments' | 'in-progress' | 'completed';

export function StatTiles({ stats, onOpen }: { stats: HubStats; onOpen: (tile: HubTile) => void }) {
  const styles = useStyles2(getSidebarHubStyles);

  return (
    <div className={styles.tiles} data-testid={testIds.sidebarHub.tiles}>
      <button
        type="button"
        className={cx(styles.tile, stats.assignments > 0 && styles.tileAccent)}
        onClick={() => onOpen('assignments')}
        data-testid={testIds.sidebarHub.tile('assignments')}
      >
        <span className={styles.tileCount}>{stats.assignments}</span>
        <span className={styles.tileLabel}>{t('sidebarHub.assignments', 'Assignments')}</span>
        {stats.nextDue && <span className={styles.tileCaption}>{dueCaption(stats.nextDue)}</span>}
      </button>
      <button
        type="button"
        className={styles.tile}
        onClick={() => onOpen('in-progress')}
        data-testid={testIds.sidebarHub.tile('in-progress')}
      >
        <span className={styles.tileCount}>{stats.inProgress}</span>
        <span className={styles.tileLabel}>{t('sidebarHub.inProgress', 'In progress')}</span>
      </button>
      <button
        type="button"
        className={styles.tile}
        onClick={() => onOpen('completed')}
        data-testid={testIds.sidebarHub.tile('completed')}
      >
        <span className={styles.tileCount}>{stats.completed}</span>
        <span className={styles.tileLabel}>{t('sidebarHub.completed', 'Completed')}</span>
      </button>
    </div>
  );
}
