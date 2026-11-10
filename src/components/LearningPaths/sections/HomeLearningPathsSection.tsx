import React, { useLayoutEffect, useRef, useState } from 'react';
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
  launchingKey,
  launchDisabled,
  launchError,
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
  launchingKey?: string | null;
  launchDisabled?: boolean;
  launchError?: { key: string; message: string } | null;
  assignmentsLoading?: boolean;
  assignmentsError?: boolean;
  onRetryAssignments?: () => void;
}) {
  const layout = useRef<HTMLDivElement>(null);
  const [secondaryCardLimit, setSecondaryCardLimit] = useState(6);
  const hasCards = entries.length > 0 || React.Children.count(children) > 0;
  useLayoutEffect(() => {
    const element = layout.current;
    if (!element || presentation !== 'continue') {
      return;
    }
    const updateCardLimit = () => {
      const limit = Number(getComputedStyle(element).getPropertyValue('--continue-card-limit'));
      if (limit > 0) {
        setSecondaryCardLimit(limit);
      }
    };
    updateCardLimit();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(updateCardLimit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [presentation, hasCards]);

  if (presentation !== 'assigned' && !hasCards) {
    return null;
  }
  const cards = [
    ...entries.map((entry, index) => (
      <LearningPathCard
        key={entry.key}
        tile
        selected={selectedCardKey === entry.key && launchError?.key !== entry.key}
        isLaunching={launchingKey === entry.key}
        launchDisabled={launchDisabled}
        launchError={launchError?.key === entry.key ? launchError.message : undefined}
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
            launchingKey={launchingKey}
            launchDisabled={launchDisabled}
            launchError={launchError}
            isLoading={assignmentsLoading}
            hasError={assignmentsError}
            onRetry={onRetryAssignments}
          />
        </div>
      ) : (
        <div className={styles.homeContinueStack}>
          <div
            ref={layout}
            className={styles.homeContinueLayout}
            data-single-card={cards.length === 1 ? true : undefined}
          >
            <div className={styles.homeContinuePrimary}>{cards[0]}</div>
            {cards.length > 1 && (
              <div className={styles.homeContinueSecondary}>{cards.slice(1, secondaryCardLimit + 1)}</div>
            )}
          </div>
          {cards.length > secondaryCardLimit + 1 && (
            <div className={styles.homeContinueOverflow}>{cards.slice(secondaryCardLimit + 1)}</div>
          )}
        </div>
      )}
    </section>
  );
}
