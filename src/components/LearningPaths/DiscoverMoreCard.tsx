/**
 * Discover More Card Component
 *
 * A not-yet-started upstream path, rendered with the same card chrome as
 * `LearningPathCard` so the two lists read as one visual system. Discover More
 * items carry no local progress or guide list, so the ring is always at zero
 * and the disclosure reveals the description instead of milestones.
 */

import React, { useId, useState } from 'react';
import { useStyles2, Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../constants/testIds';
import type { DiscoverMoreItem } from '../../learning-paths';

import { getLearningPathCardStyles } from './learning-paths.styles';
import { ProgressRing } from './ProgressRing';

interface DiscoverMoreCardProps {
  item: DiscoverMoreItem;
  onStart: (item: DiscoverMoreItem) => void;
  isStarting: boolean;
  startDisabled: boolean;
}

export function DiscoverMoreCard({ item, onStart, isStarting, startDisabled }: DiscoverMoreCardProps) {
  const styles = useStyles2(getLearningPathCardStyles);
  const [isExpanded, setIsExpanded] = useState(false);
  const descriptionId = useId();

  const canExpand = Boolean(item.description);
  const meta =
    item.milestoneCount != null
      ? t('myLearning.discoverMoreMilestones', '{{count}} milestones', { count: item.milestoneCount })
      : undefined;

  const handleToggleExpand = () => {
    if (canExpand) {
      setIsExpanded((expanded) => !expanded);
    }
  };

  return (
    <div className={styles.card} data-testid={testIds.learningPaths.discoverMoreCard(item.id)}>
      {/*
       * Deliberately not `role="button"`: that role is Children Presentational,
       * so it would hide the nested Start and chevron from assistive tech and
       * leave the card expandable but never launchable. The disclosure
       * semantics live on the chevron, which is already a real button; this
       * click handler is only a mouse convenience.
       */}
      <div
        className={cx(styles.header, !canExpand && styles.headerStatic)}
        onClick={canExpand ? handleToggleExpand : undefined}
      >
        <ProgressRing progress={0} size={40} strokeWidth={3} showPercentage={true} />

        <div className={styles.content}>
          <h3 className={styles.title}>{item.title}</h3>
          {meta && (
            <div className={styles.meta}>
              <span>{meta}</span>
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button
            className={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              onStart(item);
            }}
            disabled={startDisabled}
            data-testid={testIds.learningPaths.discoverMoreStart(item.id)}
          >
            <Icon name={isStarting ? 'fa fa-spinner' : 'play'} size="sm" />
            {isStarting ? t('myLearning.discoverMoreOpening', 'Opening…') : t('myLearning.discoverMoreStart', 'Start')}
          </button>
          {canExpand && (
            <button
              className={cx(styles.expandChevron, isExpanded && styles.expandChevronRotated)}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleExpand();
              }}
              aria-label={isExpanded ? t('myLearning.collapse', 'Collapse') : t('myLearning.expand', 'Expand')}
              aria-expanded={isExpanded}
              aria-controls={descriptionId}
              data-testid={testIds.learningPaths.discoverMoreExpand(item.id)}
            >
              <Icon name="angle-down" size="lg" />
            </button>
          )}
        </div>
      </div>

      {/*
       * The collapsed region is only visually hidden (max-height/opacity), so
       * without aria-hidden a screen reader would read the description straight
       * after hearing the toggle report itself collapsed.
       */}
      <div
        id={descriptionId}
        className={cx(styles.expandable, isExpanded && styles.expandableOpen)}
        aria-hidden={!isExpanded}
      >
        {item.description && <p className={styles.description}>{item.description}</p>}
      </div>
    </div>
  );
}
