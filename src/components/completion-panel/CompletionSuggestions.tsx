import React, { useMemo, useState } from 'react';
import { Button, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import type { RawContent } from '../../types/content.types';
import type { AnalyticsCompletionIdentity } from '../../docs-retrieval';
import { useCatalogProgress } from '../../learning-paths';
import { useCompletionRecommendations } from './useCompletionRecommendations';
import { selectCompletionSuggestions, completionSuggestionReason } from '../../lib/completion-suggestions';
import { catalogTopic } from '../../lib/catalog-discovery';
import { getPathfinderSurface } from '../../lib/telemetry/surface';
import { useCatalogLaunch } from '../LearningPaths/useCatalogLaunch';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { getCompletionPanelStyles } from './completion-panel.styles';
import { openCatalogBrowser } from '../docs-panel/utils/open-catalog-browser';

interface Props {
  content: RawContent;
  completionIdentity?: AnalyticsCompletionIdentity;
  inPath?: boolean;
}

function SuggestionFallback() {
  const styles = useStyles2(getCompletionPanelStyles);
  return (
    <div className={styles.featured}>
      <div className={styles.eyebrow}>{t('completionPanel.curiosity', 'What catches your interest?')}</div>
      <h3>{t('completionPanel.findNext', 'Find your next thing to learn.')}</h3>
      <p>
        {t(
          'completionPanel.exploreDescription',
          'Explore guides and paths for dashboards, data sources, alerting and more.'
        )}
      </p>
      <Button icon="arrow-right" onClick={() => openCatalogBrowser({ source: 'content_completion_panel' })}>
        {t('completionPanel.explore', 'Explore learning')}
      </Button>
      {getPathfinderSurface() !== 'sidebar' && (
        <div className={styles.metadata}>{t('completionPanel.opensSidebar', 'Opens in sidebar')}</div>
      )}
    </div>
  );
}

export function CompletionSuggestions({ content, completionIdentity, inPath = false }: Props) {
  const styles = useStyles2(getCompletionPanelStyles);
  const catalog = useCompletionRecommendations(content, completionIdentity, inPath);
  const rawProgress = useCatalogProgress(catalog.items, catalog.scope);
  const progress = useMemo(
    () =>
      new Map(
        catalog.items.map((item) => [
          item.key,
          item.source === 'organization' ? { percent: 0 } : (rawProgress.get(item.key) ?? { percent: 0 }),
        ])
      ),
    [catalog.items, rawProgress]
  );
  const selectionKey = JSON.stringify([
    catalog.scope,
    content.url,
    completionIdentity?.guideSource,
    completionIdentity?.guideId,
    completionIdentity?.sourceConfirmed,
    catalog.context,
  ]);
  const [selection, setSelection] = useState<{ key: string; keys: string[] } | null>(null);
  const ready = !catalog.loading && catalog.items.every((item) => rawProgress.has(item.key));
  if (ready && selection?.key !== selectionKey) {
    const candidates = selectCompletionSuggestions(catalog.items, progress, catalog.context);
    setSelection({ key: selectionKey, keys: candidates.map((item) => item.key) });
  }
  const suggestions =
    selection?.key === selectionKey && ready
      ? selection.keys.flatMap((key) => {
          const item = catalog.items.find((candidate) => candidate.key === key);
          return item && (progress.get(key)?.percent ?? 0) < 100 ? [item] : [];
        })
      : [];
  const { launch, launchingKey, launchError } = useCatalogLaunch(catalog.items, catalog.scope, progress, {
    interactionLocation: 'content_completion_panel',
  });
  if (!ready || selection?.key !== selectionKey) {
    return (
      <p className={styles.metadata} role="status">
        {t('completionPanel.finding', 'Finding your next step…')}
      </p>
    );
  }
  if (suggestions.length === 0) {
    return <SuggestionFallback />;
  }
  const outsideSidebar = getPathfinderSurface() !== 'sidebar';
  return (
    <div className={styles.suggestions}>
      {suggestions.map((item, index) => (
        <LearningContentCard
          key={`${catalog.scope}:${item.key}`}
          title={item.title}
          variant={index === 0 ? 'featured' : 'compact'}
          eyebrow={
            completionSuggestionReason(item, catalog.context) === 'recommended'
              ? t('completionPanel.recommended', 'Recommended learning')
              : completionSuggestionReason(item, catalog.context) === 'suggested'
                ? t('completionPanel.related', 'Related learning')
                : t('completionPanel.nextExplore', 'A next step to explore')
          }
          kind={item.format}
          organization={item.source === 'organization'}
          topic={catalogTopic(item)}
          description={item.description}
          effort={
            item.memberIds?.length
              ? t('completionPanel.modules', '{{count}} modules', { count: item.memberIds.length })
              : item.estimatedMinutes
                ? t('completionPanel.minutes', 'About {{minutes}} min', { minutes: item.estimatedMinutes })
                : undefined
          }
          progress={progress.get(item.key)?.percent}
          onLaunch={() => launch(item)}
          launching={launchingKey === item.key}
          launchDisabled={launchingKey !== null && launchingKey !== item.key}
          launchError={launchError?.key === item.key ? launchError.message : undefined}
        />
      ))}
      {outsideSidebar && <div className={styles.metadata}>{t('completionPanel.opensSidebar', 'Opens in sidebar')}</div>}
      <Button variant="secondary" size="sm" onClick={() => openCatalogBrowser({ source: 'content_completion_panel' })}>
        {t('completionPanel.explore', 'Explore learning')}
      </Button>
    </div>
  );
}
