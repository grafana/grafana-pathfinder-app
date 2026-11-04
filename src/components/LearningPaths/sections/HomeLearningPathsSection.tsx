import React from 'react';
import { Icon } from '@grafana/ui';
import type { IconName } from '@grafana/data';

import { getLearningPreview } from '../../LearningContentCard/learning-previews';

import { LearningPathCard } from '../LearningPathCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';
import type { LearningPathEntry as HomePathEntry } from '../../../learning-paths';

export type { LearningPathEntry as HomePathEntry } from '../../../learning-paths';

export function HomeLearningPathsSection({
  title,
  description,
  icon,
  entries,
  children,
  onView,
  styles,
  presentation,
  aside,
}: {
  title: string;
  description: string;
  icon: IconName;
  entries: HomePathEntry[];
  children?: React.ReactNode;
  onView: (entry: HomePathEntry) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
  presentation?: 'continue' | 'compact';
  aside?: React.ReactNode;
}) {
  if (!entries.length && !React.Children.count(children)) {
    return null;
  }
  const cards = [
    ...entries.map((entry, index) => (
      <LearningPathCard
        key={entry.key}
        tile
        presentation={presentation === 'continue' && index === 0 ? 'resume' : presentation ? 'compact' : undefined}
        preview={entry.path.isPrivate ? undefined : getLearningPreview(entry.path.id)}
        showOrganization
        topic={entry.topic}
        path={entry.path}
        guides={entry.guides}
        progress={entry.percent}
        isCompleted={false}
        assignment={entry.assignment}
        onContinue={() => onView(entry)}
        onViewPath={() => onView(entry)}
      />
    )),
    ...React.Children.toArray(children),
  ];
  return (
    <section className={styles.openSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>
          <Icon name={icon} size="lg" />
        </span>
        <div className={styles.sectionHeadingText}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <p className={styles.sectionDescription}>{description}</p>
        </div>
      </div>
      {presentation === 'continue' ? (
        <div className={styles.homeContinueLayout}>
          <div className={styles.homeContinuePrimary}>{cards[0]}</div>
          <div className={styles.homeContinueSecondary}>
            {cards.slice(1)}
            {aside}
          </div>
        </div>
      ) : (
        <div className={presentation === 'compact' ? styles.homeAvailableGrid : styles.pathsGrid}>{cards}</div>
      )}
    </section>
  );
}
