/**
 * Completed Section
 *
 * Learning paths the user has finished (100%). Rendered read-only with a
 * "Done" badge; there is no per-item completion date to show yet.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { LearningPath } from '../../../types/learning-paths.types';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface CompletedSectionProps {
  completed: LearningPath[];
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function CompletedSection({ completed, styles }: CompletedSectionProps) {
  return (
    <div className={styles.section} data-testid={testIds.learningPaths.completedSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>
          <Icon name="check-circle" size="lg" />
        </span>
        <div className={styles.sectionHeadingText}>
          <h2 className={styles.sectionTitle}>{t('myLearning.completed', 'Completed')}</h2>
          <p className={styles.sectionDescription}>
            {t('myLearning.completedDescription', "Courses and paths you've finished")}
          </p>
        </div>
      </div>

      {completed.length === 0 ? (
        <div className={styles.emptyMessage}>
          <Icon name="check-circle" size="xl" className={styles.emptyIcon} />
          <p>{t('myLearning.completedEmpty', 'Finish a course to see it here')}</p>
        </div>
      ) : (
        <div className={styles.completedList}>
          {completed.map((path) => (
            <div key={path.id} className={styles.completedItem}>
              <span className={styles.completedIcon}>
                <Icon name="check" size="sm" />
              </span>
              <span className={styles.completedTitle}>{path.title}</span>
              <span className={styles.completedDoneBadge}>
                <Icon name="check" size="xs" />
                {t('myLearning.completedDone', 'Done')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
