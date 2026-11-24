import React, { useId, useState } from 'react';
import { Icon, Text, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { LearningDetailsToggle } from '../LearningContentCard/LearningDetailsToggle';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';
import { FeaturedGuide } from './FeaturedGuide';
import type { HubGuide } from './GuideRow';
import { getHubActionLabel } from './hub-action-label';
import { getSidebarHubStyles } from './sidebar-hub.styles';

export function FeaturedGuides({
  guides,
  title,
  disabled,
  run,
}: {
  guides: HubGuide[];
  title?: string;
  disabled: boolean;
  run: (action: () => void | Promise<void>) => void;
}) {
  const styles = useStyles2(getSidebarHubStyles);
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const [openSummary, setOpenSummary] = useState<string>();
  if (guides.length === 1) {
    const guide = guides[0]!;
    return (
      <FeaturedGuide
        guide={guide}
        disabled={disabled}
        onLaunch={() => run(guide.onLaunch)}
        onOpenModule={(module) => run(() => guide.expansion?.onOpenModule(module))}
      />
    );
  }
  const heading = title ?? t('sidebarHub.recommendedForYou', 'Recommended for you');
  const done = guides.filter((guide) => guide.progress === 100).length;
  const progress = t('sidebarHub.groupProgress', '{{done}} of {{total}} complete', { done, total: guides.length });
  return (
    <section className={styles.spotlightGroup} aria-label={heading}>
      <h3>
        <button
          type="button"
          className={styles.groupControl}
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded(!expanded)}
        >
          {heading}
          <Icon name={expanded ? 'angle-up' : 'angle-down'} />
        </button>
      </h3>
      <ul id={listId} hidden={!expanded} className={styles.spotlightList}>
        {guides.map((guide, index) => (
          <li key={guide.key}>
            <button
              type="button"
              className={styles.groupControl}
              disabled={disabled}
              aria-label={getHubActionLabel(guide.kind, guide.progress, guide.title)}
              onClick={() => run(guide.onLaunch)}
            >
              <LearningTopicIcon topic={guide.topic} kind={guide.kind} size="sm" />
              <span>{guide.title}</span>
              <Icon name={guide.progress === 100 ? 'check-circle' : 'angle-right'} />
            </button>
            {guide.summary && (
              <div className={styles.spotlightSummary}>
                <LearningDetailsToggle
                  subtle
                  expanded={openSummary === guide.key}
                  hasDetails={false}
                  controls={`${listId}-summary-${index}`}
                  onToggle={() => setOpenSummary((current) => (current === guide.key ? undefined : guide.key))}
                />
                <p id={`${listId}-summary-${index}`} hidden={openSummary !== guide.key}>
                  {guide.summary}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className={styles.spotlightProgress}>
        <Text variant="bodySmall" color="secondary">
          {progress}
        </Text>
        <progress aria-label={progress} value={done} max={guides.length} />
      </div>
    </section>
  );
}
