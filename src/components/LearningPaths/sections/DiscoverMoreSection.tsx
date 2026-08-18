/**
 * Discover More Section
 *
 * Novel, external content pulled from the upstream package index. Always
 * offers something new to explore; fails soft to an empty state when the
 * index is unavailable or offline.
 */

import React from 'react';
import { Icon } from '@grafana/ui';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { DiscoverMoreItem } from '../../../learning-paths';
import { useVerticalOverflow } from '../../../hooks';
import { SkeletonLoader } from '../../SkeletonLoader';
import { DiscoverMoreCard } from '../DiscoverMoreCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

interface DiscoverMoreSectionProps {
  items: DiscoverMoreItem[];
  isLoading: boolean;
  onStart: (item: DiscoverMoreItem) => void;
  startingId: string | null;
  startDisabled: boolean;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function DiscoverMoreSection({
  items,
  isLoading,
  onStart,
  startingId,
  startDisabled,
  styles,
}: DiscoverMoreSectionProps) {
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();

  return (
    <div className={styles.section} data-testid={testIds.learningPaths.discoverMoreSection}>
      <div className={styles.sectionHeader}>
        <Icon name="compass" size="md" className={styles.sectionIcon} />
        <h2 className={styles.sectionTitle}>{t('myLearning.discoverMore', 'Discover more')}</h2>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.discoverMoreDescription', 'Structured paths to help you master Grafana step by step')}
      </p>

      {isLoading ? (
        <SkeletonLoader type="recommendations" />
      ) : items.length === 0 ? (
        <div className={styles.emptyMessage}>
          <Icon name="compass" size="xl" className={styles.emptyIcon} />
          <p>{t('myLearning.discoverMoreEmpty', 'Nothing new to show right now — check back later')}</p>
        </div>
      ) : (
        <div
          ref={listRef}
          className={cx(styles.discoverList, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)}
        >
          {items.map((item) => (
            <DiscoverMoreCard
              key={item.id}
              item={item}
              onStart={onStart}
              isStarting={startingId === item.id}
              startDisabled={startDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}
