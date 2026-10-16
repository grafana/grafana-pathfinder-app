import React, { useId } from 'react';
import { useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { getLearningTopicMetadata } from '../LearningContentCard/learning-topic-visual';
import { testIds } from '../../constants/testIds';
import { getSidebarHubStyles } from './sidebar-hub.styles';
import { HubActionButton } from './HubActionButton';
import type { HubGuide } from './GuideRow';

export function FeaturedGuide({
  guide,
  disabled,
  onLaunch,
}: {
  guide: HubGuide;
  disabled: boolean;
  onLaunch: () => void;
}) {
  const styles = useStyles2(getSidebarHubStyles);
  const titleId = useId();
  const topicLabel = getLearningTopicMetadata(guide.topic, guide.kind).label;

  return (
    <section
      className={styles.featured(guide.topic, guide.kind)}
      aria-labelledby={titleId}
      data-testid={testIds.sidebarHub.featured}
    >
      <div className={styles.featuredTop}>
        <LearningTopicIcon topic={guide.topic} kind={guide.kind} size="lg" />
        <div className={styles.featuredHeading}>
          <span className={styles.eyebrow}>{t('sidebarHub.recommendedForYou', 'Recommended for you')}</span>
          {topicLabel && <span className={styles.chip}>{topicLabel}</span>}
        </div>
      </div>
      <h3 id={titleId} className={styles.featuredTitle}>
        {guide.title}
      </h3>
      {guide.summary && <p className={styles.featuredSummary}>{guide.summary}</p>}
      <div className={styles.footer}>
        <span className={styles.effort}>{guide.effort}</span>
        <HubActionButton
          guide={guide}
          className={styles.cta}
          testId={testIds.sidebarHub.featuredAction}
          disabled={disabled}
          onLaunch={onLaunch}
        />
      </div>
    </section>
  );
}
