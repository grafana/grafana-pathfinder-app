import React from 'react';
import { css, cx } from '@emotion/css';
import type { GrafanaTheme2 } from '@grafana/data';
import { t } from '@grafana/i18n';
import { Icon, useStyles2 } from '@grafana/ui';

import { testIds } from '../../constants/testIds';
import type { getMyLearningStyles } from '../LearningPaths/MyLearningTab.styles';

import { AchievementBadge } from './AchievementBadge';
import type { AchievementRowView, AchievementsView } from './achievements-view';
import { useAchievementsView } from './useAchievementsView';

interface AchievementsSectionProps {
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function AchievementsSection({ styles }: AchievementsSectionProps) {
  return <AchievementsSectionView view={useAchievementsView()} styles={styles} />;
}

export function AchievementsSectionView({ view, styles }: AchievementsSectionProps & { view: AchievementsView }) {
  const own = useStyles2(getStyles);
  if (view.kind === 'loading' || view.kind === 'hidden') {
    return null;
  }
  return (
    <section className={cx(styles.section, styles.columnSection)} data-testid={testIds.achievements.hubSection}>
      <div className={styles.sectionHeader}>
        <Icon name="star" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('achievements.hub.title', 'Achievements')}</h2>
      </div>
      {view.kind === 'unavailable' ? (
        <p className={styles.sectionDescription} data-testid={testIds.achievements.hubUnavailable}>
          {t('achievements.hub.unavailable', 'Achievements cannot be shown right now. Try again later.')}
        </p>
      ) : view.rows.length === 0 ? (
        <p className={styles.sectionDescription} data-testid={testIds.achievements.hubEmpty}>
          {t('achievements.hub.empty', 'Finish a guide to earn your first achievement.')}
        </p>
      ) : (
        <ul className={cx(own.list, styles.scrollRegion)}>
          {view.rows.map((row) => (
            <AchievementRow key={row.id} row={row} />
          ))}
        </ul>
      )}
      {view.kind === 'ready' && view.truncated && (
        <p className={own.note}>{t('achievements.hub.truncated', 'Some achievements could not be loaded.')}</p>
      )}
    </section>
  );
}

function AchievementRow({ row }: { row: AchievementRowView }) {
  const styles = useStyles2(getStyles);
  const percent = row.progress ? Math.min(100, Math.round((row.progress.units / row.progress.next) * 100)) : 0;
  return (
    <li className={styles.row} data-testid={testIds.achievements.hubRow(row.id)}>
      <AchievementBadge
        artUrl={row.earned?.artUrl ?? null}
        size={40}
        className={row.earned ? undefined : styles.unearned}
      />
      <div className={styles.body}>
        <div className={styles.titleLine}>
          <span className={styles.title}>{row.title}</span>
          {row.earned && <span className={styles.tier}>{row.earned.label}</span>}
        </div>
        <div className={styles.description}>{row.description}</div>
        {row.progress && (
          <div className={styles.progress}>
            <div
              className={styles.track}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={row.progress.next}
              aria-valuenow={row.progress.units}
              aria-label={t('achievements.hub.progressLabel', 'Progress toward the next tier')}
            >
              <div className={styles.fill} style={{ width: `${percent}%` }} />
            </div>
            <span className={styles.count}>
              {t('achievements.hub.progress', '{{units}} of {{next}} toward the next tier', {
                units: row.progress.units,
                next: row.progress.next,
              })}
            </span>
          </div>
        )}
      </div>
    </li>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  list: css({
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: theme.spacing(1.5),
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))',
  }),
  row: css({
    display: 'flex',
    gap: theme.spacing(1.5),
    alignItems: 'flex-start',
    minWidth: 0,
  }),
  unearned: css({
    filter: 'grayscale(1)',
    opacity: 0.5,
  }),
  body: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.25),
    minWidth: 0,
    flex: 1,
  }),
  titleLine: css({
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: theme.spacing(1),
  }),
  title: css({
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.text.primary,
    overflowWrap: 'anywhere',
  }),
  tier: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  description: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
    overflowWrap: 'anywhere',
  }),
  progress: css({
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(0.5),
    marginTop: theme.spacing(0.5),
  }),
  track: css({
    height: 4,
    borderRadius: theme.shape.radius.pill,
    background: theme.colors.background.canvas,
    overflow: 'hidden',
  }),
  fill: css({
    height: '100%',
    background: theme.colors.primary.main,
  }),
  count: css({
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
  note: css({
    margin: 0,
    marginTop: theme.spacing(1.5),
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.text.secondary,
  }),
});
