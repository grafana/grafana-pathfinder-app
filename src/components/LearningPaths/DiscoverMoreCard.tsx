import { milestoneCountText } from '../LearningContentCard/learning-effort';
import React from 'react';
import { t } from '@grafana/i18n';
import { testIds } from '../../constants/testIds';
import type { DiscoverMoreItem, CatalogProgress } from '../../learning-paths';
import type { CatalogPackage } from '../../types/package-catalog.types';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { CatalogDetails } from '../PackageBrowser/CatalogDetails';
import { catalogTopic } from '../../lib/catalog-discovery';

interface DiscoverMoreCardProps {
  item: DiscoverMoreItem;
  onStart: (item: DiscoverMoreItem) => void | Promise<void>;
  isStarting: boolean;
  startDisabled: boolean;
  items?: CatalogPackage[];
  scope?: string;
  progress?: Map<string, CatalogProgress>;
  launchError?: string;
}

export function DiscoverMoreCard({
  item,
  onStart,
  isStarting,
  startDisabled,
  items = [],
  scope = '',
  progress,
  launchError,
}: DiscoverMoreCardProps) {
  const entry = item.catalogPackage;
  const effort = [
    item.milestoneCount != null ? milestoneCountText(item.milestoneCount) : undefined,
    entry?.estimatedMinutes
      ? t('packageBrowser.time', 'About {{minutes}} min', { minutes: entry.estimatedMinutes })
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <LearningContentCard
      title={item.title}
      topic={catalogTopic(entry ?? { id: item.id, title: item.title })}
      kind={entry?.format ?? 'path'}
      description={item.description}
      organization={entry?.source === 'organization'}
      effort={effort}
      progress={progress?.get(item.key ?? '')?.percent}
      onLaunch={() => onStart(item)}
      launching={isStarting}
      launchDisabled={startDisabled}
      launchError={launchError}
      testId={testIds.learningPaths.discoverMoreCard(item.id)}
      actionTestId={testIds.learningPaths.discoverMoreStart(item.id)}
      disclosureTestId={testIds.learningPaths.discoverMoreExpand(item.id)}
      disclosureLabel={entry?.memberIds?.length ? t('learningCard.showModules', 'Show milestones') : undefined}
      collapseLabel={entry?.memberIds?.length ? t('learningCard.hideModules', 'Hide milestones') : undefined}
      details={
        entry?.memberIds?.length && progress ? (
          <CatalogDetails item={entry} items={items} scope={scope} progress={progress} />
        ) : undefined
      }
    />
  );
}
