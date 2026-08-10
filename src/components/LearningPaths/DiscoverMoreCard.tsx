/**
 * Discover More Card Component
 *
 * A not-yet-started upstream path, rendered with the same card chrome as
 * `LearningPathCard` so the two lists read as one visual system. Discover More
 * items carry no local progress or guide list, so the ring is always at zero
 * and the disclosure reveals the description instead of milestones.
 */

import React, { useState } from 'react';
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
      <div
        className={styles.header}
        onClick={handleToggleExpand}
        role={canExpand ? 'button' : undefined}
        tabIndex={canExpand ? 0 : undefined}
        // Only the header's own keystrokes: a keydown bubbling up from Start or
        // the chevron would toggle here *and* fire that button's activation
        // click, cancelling out so the keyboard could never open the card.
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) {
            return;
          }
          e.preventDefault();
          handleToggleExpand();
        }}
        aria-expanded={canExpand ? isExpanded : undefined}
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
              data-testid={testIds.learningPaths.discoverMoreExpand(item.id)}
            >
              <Icon name="angle-down" size="lg" />
            </button>
          )}
        </div>
      </div>

      <div className={cx(styles.expandable, isExpanded && styles.expandableOpen)}>
        {item.description && <p className={styles.description}>{item.description}</p>}
      </div>
    </div>
  );
}
