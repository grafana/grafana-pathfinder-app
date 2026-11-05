import React from 'react';
import { Icon } from '@grafana/ui';
import type { IconName } from '@grafana/data';

import { getLearningPreview } from '../../LearningContentCard/learning-previews';

import { LearningPathCard } from '../LearningPathCard';
import { LearningCardsRow } from './LearningCardsRow';
import { HomeAssignmentsTable } from './HomeAssignmentsTable';
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
  selectedCardKey,
  assignmentsLoading,
  assignmentsError,
  onRetryAssignments,
}: {
  title: string;
  description?: string;
  icon: IconName;
  entries: HomePathEntry[];
  children?: React.ReactNode;
  onView: (entry: HomePathEntry) => void;
  styles: ReturnType<typeof getMyLearningStyles>;
  presentation?: 'continue' | 'assigned';
  selectedCardKey?: string | null;
  assignmentsLoading?: boolean;
  assignmentsError?: boolean;
  onRetryAssignments?: () => void;
}) {
  if (presentation !== 'assigned' && !entries.length && !React.Children.count(children)) {
    return null;
  }
  const cards = [
    ...entries.map((entry, index) => (
      <LearningPathCard
        key={entry.key}
        tile
        selected={selectedCardKey === entry.key}
        presentation={presentation === 'continue' ? (index === 0 ? 'resume' : 'compact') : undefined}
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
  if (presentation !== 'continue' && presentation !== 'assigned') {
    return (
      <LearningCardsRow title={title} description={description} icon={icon} styles={styles}>
        {cards}
      </LearningCardsRow>
    );
  }
  return (
    <section className={styles.openSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>
          <Icon name={icon} size="lg" />
        </span>
        <div className={styles.sectionHeadingText}>
          <h2 className={styles.sectionTitle}>{title}</h2>
          {description && <p className={styles.sectionDescription}>{description}</p>}
        </div>
      </div>
      {presentation === 'assigned' ? (
        <div
          className={styles.homeAssignmentsList}
          data-has-assignments={entries.length > 0 ? true : undefined}
          role="region"
          aria-label={title}
          tabIndex={entries.length > 0 ? 0 : undefined}
        >
          <HomeAssignmentsTable
            entries={entries}
            onView={onView}
            selectedCardKey={selectedCardKey}
            isLoading={assignmentsLoading}
            hasError={assignmentsError}
            onRetry={onRetryAssignments}
          />
        </div>
      ) : (
        <div className={styles.homeContinueStack}>
          <div className={styles.homeContinueLayout} data-single-card={cards.length === 1 ? true : undefined}>
            <div className={styles.homeContinuePrimary}>{cards[0]}</div>
            {cards.length > 1 && <div className={styles.homeContinueSecondary}>{cards.slice(1, 7)}</div>}
          </div>
          {cards.length > 7 && <div className={styles.homeContinueOverflow}>{cards.slice(7)}</div>}
        </div>
      )}
    </section>
  );
}
