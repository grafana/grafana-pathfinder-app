import React from 'react';
import { Icon } from '@grafana/ui';
import type { IconName } from '@grafana/data';
import type { LearningPath, PathGuide, ResolvedAssignment } from '../../../types/learning-paths.types';
import { LearningPathCard } from '../LearningPathCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

export interface HomePathEntry {
  key: string;
  path: LearningPath;
  guides: PathGuide[];
  percent: number;
  topic?: string;
  assignment?: ResolvedAssignment;
}

export function HomeLearningPathsSection({
  title,
  description,
  icon,
  entries,
  children,
  onView,
  styles,
}: {
  title: string;
  description: string;
  icon: IconName;
  entries: HomePathEntry[];
  children?: React.ReactNode;
  onView: (entry: HomePathEntry) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
}) {
  if (!entries.length && !React.Children.count(children)) {
    return null;
  }
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
      <div className={styles.pathsGrid}>
        {entries.map((entry) => (
          <LearningPathCard
            key={entry.key}
            tile
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
        ))}
        {children}
      </div>
    </section>
  );
}
