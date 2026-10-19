import React from 'react';
import { Badge } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { testIds } from '../../constants/testIds';
import type { HubGuide } from './GuideRow';

export function FeaturedGuide({
  guide,
  disabled,
  onLaunch,
}: {
  guide: HubGuide;
  disabled: boolean;
  onLaunch: () => void | Promise<void>;
}) {
  const topicLabel = getLearningTopicMetadata(guide.topic, guide.kind).label;

  return (
    <LearningContentCard
      variant="featured"
      eyebrow={t('sidebarHub.recommendedForYou', 'Recommended for you')}
      title={guide.title}
      kind={guide.kind}
      topic={guide.topic}
      description={guide.summary}
      effort={guide.effort}
      progress={guide.progress}
      badges={topicLabel ? <Badge text={topicLabel} color="darkgrey" /> : undefined}
      launchDisabled={disabled}
      onLaunch={onLaunch}
      testId={testIds.sidebarHub.featured}
      actionTestId={testIds.sidebarHub.featuredAction}
    />
  );
}
