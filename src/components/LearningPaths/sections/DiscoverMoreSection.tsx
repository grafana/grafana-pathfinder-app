/**
 * Discover More Section
 *
 * Novel, external content pulled from the upstream package index. Always
 * offers something new to explore; fails soft to an empty state when the
 * index is unavailable or offline.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { DiscoverMoreItem } from '../../../learning-paths';
import { SkeletonLoader } from '../../SkeletonLoader';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface DiscoverMoreSectionProps {
  items: DiscoverMoreItem[];
  isLoading: boolean;
  onStart: (item: DiscoverMoreItem) => void;
  startingId: string | null;
  startDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}

function DiscoverMoreCard({
  item,
  onStart,
  isStarting,
  startDisabled,
  styles,
}: {
  item: DiscoverMoreItem;
  onStart: (item: DiscoverMoreItem) => void;
  isStarting: boolean;
  startDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}) {
  const meta =
    item.milestoneCount != null
      ? t('myLearning.discoverMoreMilestones', '{{count}} milestones', { count: item.milestoneCount })
      : item.description;

  return (
    <div className={styles.discoverCard} data-testid={testIds.learningPaths.discoverMoreCard(item.id)}>
      <div className={styles.discoverIcon}>
        <Icon name="compass" size="lg" />
      </div>
      <div className={styles.discoverBody}>
        <h3 className={styles.discoverTitle}>{item.title}</h3>
        {meta && <p className={styles.discoverMeta}>{meta}</p>}
      </div>
      <button
        className={styles.discoverStartButton}
        onClick={() => onStart(item)}
        disabled={startDisabled}
        data-testid={testIds.learningPaths.discoverMoreStart(item.id)}
      >
        <Icon name={isStarting ? 'fa fa-spinner' : 'play'} size="sm" />
        {isStarting ? t('myLearning.discoverMoreOpening', 'Opening…') : t('myLearning.discoverMoreStart', 'Start')}
      </button>
    </div>
  );
}

export function DiscoverMoreSection({
  items,
  isLoading,
  onStart,
  startingId,
  startDisabled,
  styles,
}: DiscoverMoreSectionProps) {
  return (
    <div className={styles.section} data-testid={testIds.learningPaths.discoverMoreSection}>
      <div className={styles.sectionHeader}>
        <Icon name="compass" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.discoverMore', 'Discover more')}</h2>
      </div>
      {isLoading ? (
        <SkeletonLoader type="recommendations" />
      ) : items.length === 0 ? (
        <div className={styles.emptyMessage}>
          <Icon name="compass" size="xl" className={styles.emptyIcon} />
          <p>{t('myLearning.discoverMoreEmpty', 'Nothing new to show right now — check back later')}</p>
        </div>
      ) : (
        <div className={styles.discoverList}>
          {items.map((item) => (
            <DiscoverMoreCard
              key={item.id}
              item={item}
              onStart={onStart}
              isStarting={startingId === item.id}
              startDisabled={startDisabled}
              styles={styles}
            />
          ))}
        </div>
      )}
    </div>
  );
}
