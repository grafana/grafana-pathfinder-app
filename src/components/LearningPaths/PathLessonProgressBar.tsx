import React, { useSyncExternalStore } from 'react';
import { t } from '@grafana/i18n';
import { journeyMilestonePercentages, type ActiveMilestoneToolbarContext } from '../../docs-retrieval';
import { getGuideProgressRevision, subscribeGuideProgressRevision } from '../../global-state/progress-events';
import { SegmentedProgressBar, type ProgressSegmentState } from './SegmentedProgressBar';

export function usePathLessonProgress(context: ActiveMilestoneToolbarContext | null) {
  useSyncExternalStore(subscribeGuideProgressRevision, getGuideProgressRevision, getGuideProgressRevision);

  const percentages = context ? journeyMilestonePercentages(context.baseUrl, context.milestones) : [];
  const completed = percentages.filter(({ percent }) => percent === 100).length;
  const segments = percentages.map(({ milestone, percent }): ProgressSegmentState => {
    if (milestone.number === context?.currentMilestone) {
      return 'current';
    }
    return percent === 100 ? 'done' : 'upcoming';
  });
  const label = t('coverPage.completedOfTotal', '{{completed}} of {{total}} completed', {
    completed,
    total: segments.length,
  });
  return { percentages, completed, segments, label };
}

export function PathLessonProgressBar({
  progress: { completed, segments, label },
  className,
}: {
  progress: ReturnType<typeof usePathLessonProgress>;
  className?: string;
}) {
  if (segments.length === 0) {
    return null;
  }

  return (
    <div
      className={className}
      role="progressbar"
      aria-label={t('docsPanel.learningJourney', 'Learning path')}
      aria-valuemin={0}
      aria-valuemax={segments.length}
      aria-valuenow={completed}
      aria-valuetext={label}
    >
      <SegmentedProgressBar segments={segments} highContrast currentColor="primary" />
    </div>
  );
}
