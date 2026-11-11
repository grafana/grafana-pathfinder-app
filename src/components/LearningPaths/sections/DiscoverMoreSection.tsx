import React from 'react';
import { Button, Icon } from '@grafana/ui';
import { openCatalogBrowser } from '../../docs-panel/utils/open-catalog-browser';
import { useBooleanFlag } from '../../../utils/openfeature';
import { cx } from '@emotion/css';
import { t } from '@grafana/i18n';

import { testIds } from '../../../constants/testIds';
import type { DiscoverMoreItem, CatalogProgress } from '../../../learning-paths';
import { useVerticalOverflow } from '../../../hooks';
import { SkeletonLoader } from '../../SkeletonLoader';
import { DiscoverMoreCard } from '../DiscoverMoreCard';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

import type { CatalogPackage } from '../../../types/package-catalog.types';

interface DiscoverMoreSectionProps {
  items: DiscoverMoreItem[];
  isLoading: boolean;
  onStart: (item: DiscoverMoreItem) => void;
  startingId: string | null;
  startDisabled: boolean;
  catalogItems?: CatalogPackage[];
  scope?: string;
  progress?: Map<string, CatalogProgress>;
  launchError?: { key: string; message: string } | null;
  styles: ReturnType<typeof getMyLearningStyles>;
}

export function DiscoverMoreSection({
  items,
  isLoading,
  onStart,
  startingId,
  startDisabled,
  styles,
  catalogItems,
  scope,
  progress,
  launchError,
}: DiscoverMoreSectionProps) {
  const browseEnabled = useBooleanFlag('pathfinder.package-browser', true);
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();

  return (
    <div className={styles.section} data-testid={testIds.learningPaths.discoverMoreSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>
          <Icon name="compass" size="lg" />
        </span>
        <div className={styles.sectionHeadingText}>
          <h2 className={styles.sectionTitle}>{t('myLearning.discoverMore', 'Discover more')}</h2>
          <p className={styles.sectionDescription}>
            {t('myLearning.discoverMoreDescription', 'Structured paths to help you master Grafana step by step')}
          </p>
        </div>
        {browseEnabled && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openCatalogBrowser({ source: 'my_learning_discover_more' })}
          >
            {t('packageBrowser.browseAll', 'Browse all')}
          </Button>
        )}
      </div>

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
              key={item.key ?? item.id}
              item={item}
              onStart={onStart}
              isStarting={startingId === (item.key ?? item.id)}
              startDisabled={startDisabled}
              items={catalogItems}
              scope={scope}
              progress={progress}
              launchError={launchError?.key === (item.key ?? item.id) ? launchError.message : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
