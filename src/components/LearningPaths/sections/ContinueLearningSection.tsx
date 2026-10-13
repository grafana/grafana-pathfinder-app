import React from 'react';
import { Icon } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { cx } from '@emotion/css';
import { useVerticalOverflow } from '../../../hooks';
import type { CatalogPackage } from '../../../types/package-catalog.types';
import type { CatalogProgress } from '../../../learning-paths';
import { LearningContentCard } from '../../LearningContentCard/LearningContentCard';
import { CatalogDetails } from '../../PackageBrowser/CatalogDetails';
import type { getMyLearningStyles } from '../MyLearningTab.styles';

export function ContinueLearningSection({
  items,
  catalogItems,
  scope,
  progress,
  onContinue,
  launchingKey,
  launchDisabled,
  launchError,
  styles,
}: {
  items: CatalogPackage[];
  catalogItems: CatalogPackage[];
  scope: string;
  progress: Map<string, CatalogProgress>;
  onContinue: (item: CatalogPackage) => void | Promise<void>;
  launchingKey: string | null;
  launchDisabled: boolean;
  launchError: { key: string; message: string } | null;
  styles: ReturnType<typeof getMyLearningStyles>;
}) {
  const [listRef, hasOverflow] = useVerticalOverflow<HTMLDivElement>();
  if (items.length === 0) {
    return null;
  }
  return (
    <section
      className={styles.section}
      aria-labelledby="continue-learning-title"
      data-testid="continue-learning-section"
    >
      <div className={styles.sectionHeader}>
        <Icon name="play" size="md" className={styles.sectionIcon} />
        <h2 id="continue-learning-title" className={styles.sectionTitle}>
          {t('myLearning.continueLearning', 'Continue learning')}
        </h2>
      </div>
      <p className={styles.sectionDescription}>
        {t('myLearning.continueLearningDescription', 'Pick up guides and paths you have started.')}
      </p>
      <div
        ref={listRef}
        className={cx(styles.discoverList, styles.scrollRegion, hasOverflow && styles.scrollRegionFaded)}
      >
        {items.map((item) => (
          <LearningContentCard
            key={`${scope}:${item.key}`}
            title={item.title}
            description={item.description}
            kind={item.format}
            organization={item.source === 'organization'}
            progress={progress.get(item.key)?.percent}
            effort={[
              item.memberIds
                ? t('packageBrowser.modules', '{{count}} modules', { count: item.memberIds.length })
                : item.activityCount !== undefined
                  ? t('packageBrowser.activities', '{{count}} activities', { count: item.activityCount })
                  : undefined,
              item.estimatedMinutes
                ? t('packageBrowser.time', 'About {{minutes}} min', { minutes: item.estimatedMinutes })
                : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
            onLaunch={() => onContinue(item)}
            launching={launchingKey === item.key}
            launchDisabled={launchDisabled}
            launchError={launchError?.key === item.key ? launchError.message : undefined}
            disclosureLabel={item.memberIds?.length ? t('learningCard.showModules', 'Show modules') : undefined}
            collapseLabel={item.memberIds?.length ? t('learningCard.hideModules', 'Hide modules') : undefined}
            details={
              item.memberIds?.length ? (
                <CatalogDetails item={item} items={catalogItems} scope={scope} progress={progress} />
              ) : undefined
            }
          />
        ))}
      </div>
    </section>
  );
}
