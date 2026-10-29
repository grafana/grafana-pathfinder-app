import React from 'react';
import { Badge } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { testIds } from '../../constants/testIds';
import type { Milestone } from '../../types/content.types';
import { GuideDetails } from './GuideDetails';
import type { HubGuide } from './GuideRow';

export function FeaturedGuide({
  guide,
  disabled,
  onLaunch,
  onOpenModule,
}: {
  guide: HubGuide;
  disabled: boolean;
  onLaunch: () => void | Promise<void>;
  onOpenModule: (module: Milestone) => void | Promise<void>;
}) {
  const topicLabel = getLearningTopicMetadata(guide.topic, guide.kind).label;
  const { expansion } = guide;

  return (
    <LearningContentCard
      variant="featured"
      eyebrow={t('sidebarHub.recommendedForYou', 'Recommended for you')}
      expandableDescription
      actionAtBottom
      title={guide.title}
      kind={guide.kind}
      topic={guide.topic}
      description={guide.summary}
      effort={guide.effort}
      progress={guide.progress}
      badges={topicLabel ? <Badge text={topicLabel} color="darkgrey" /> : undefined}
      launchDisabled={disabled}
      onLaunch={onLaunch}
      expanded={expansion?.expanded}
      onToggleDetails={expansion?.onToggle}
      disclosureLabel={expansion?.hasModules ? t('learningCard.showModules', 'Show milestones') : undefined}
      collapseLabel={expansion?.hasModules ? t('learningCard.hideModules', 'Hide milestones') : undefined}
      details={
        expansion?.hasDetails ? (
          <GuideDetails
            expansion={expansion}
            loadingTestId={testIds.sidebarHub.featuredDetailsLoading}
            moduleTestId={testIds.sidebarHub.featuredModule}
            onOpenModule={onOpenModule}
          />
        ) : undefined
      }
      testId={testIds.sidebarHub.featured}
      actionTestId={testIds.sidebarHub.featuredAction}
      disclosureTestId={testIds.sidebarHub.featuredToggle}
      detailsTestId={testIds.sidebarHub.featuredDetails}
    />
  );
}
