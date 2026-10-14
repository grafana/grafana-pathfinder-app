import { milestoneCountText } from '../LearningContentCard/learning-effort';
import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { Alert, Button, Icon, Input, Combobox, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { CATALOG_BATCH_SIZE, type CatalogPackage, type CatalogViewState } from '../../types/package-catalog.types';
import { filterCatalog } from '../../lib/package-catalog';
import { getCatalogView, subscribeCatalogView, updateCatalogView } from '../../global-state/package-browser';
import { usePackageCatalog, useCatalogProgress } from '../../learning-paths';
import { catalogStarters, catalogTopic, catalogTopicCounts, catalogTopicShortcuts } from '../../lib/catalog-discovery';
import type { PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { useCatalogLaunch } from '../LearningPaths/useCatalogLaunch';
import { getPackageBrowserStyles } from './package-browser.styles';
import { SkeletonLoader } from '../SkeletonLoader';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { CatalogDetails } from './CatalogDetails';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';

export interface PackageBrowserProps {
  onOpenGuide: (launch: PreparedGuideLaunch) => void;
}

function topicLabel(topic: string): string {
  switch (topic) {
    case 'dashboards':
      return t('packageBrowser.topicDashboards', 'Dashboards');
    case 'data-sources':
      return t('packageBrowser.topicDataSources', 'Data sources');
    case 'alerting':
      return t('packageBrowser.topicAlerting', 'Alerting');
    case 'metrics':
      return t('packageBrowser.topicMetrics', 'Metrics');
    case 'logs':
      return t('packageBrowser.topicLogs', 'Logs');
    case 'k6':
      return t('packageBrowser.topicK6', 'Performance testing');
    case 'getting-started':
      return t('packageBrowser.topicGettingStarted', 'Getting started');
    case 'uncategorized':
      return t('packageBrowser.uncategorized', 'Other topics');
    default:
      return topic.replace(/-/g, ' ');
  }
}

export function PackageBrowser({ onOpenGuide }: PackageBrowserProps) {
  const styles = useStyles2(getPackageBrowserStyles);
  const catalog = usePackageCatalog();
  const snapshot = useCallback(() => getCatalogView(catalog.scope), [catalog.scope]);
  const view = useSyncExternalStore(subscribeCatalogView, snapshot, snapshot);
  const container = useRef<HTMLDivElement>(null);
  const update = useCallback(
    (patch: Partial<CatalogViewState>) => {
      const filtersChanged = 'query' in patch || 'format' in patch || 'source' in patch || 'category' in patch;
      const navigationChanged = filtersChanged || 'mode' in patch;
      updateCatalogView(catalog.scope, {
        ...(navigationChanged ? { focusKey: null, visibleCount: CATALOG_BATCH_SIZE } : {}),
        ...(filtersChanged ? { mode: 'all' as const } : {}),
        ...patch,
      });
      if (navigationChanged && container.current) {
        container.current.scrollTop = 0;
      }
    },
    [catalog.scope]
  );
  const progress = useCatalogProgress(catalog.items, catalog.scope);
  const normalizedItems = useMemo(
    () => catalog.items.map((item) => ({ ...item, category: catalogTopic(item) })),
    [catalog.items]
  );
  const items = useMemo(() => filterCatalog(normalizedItems, view), [normalizedItems, view]);
  const categories = useMemo(() => catalogTopicCounts(catalog.items), [catalog.items]);
  const starters = useMemo(() => catalogStarters(catalog.items), [catalog.items]);
  const shortcuts = useMemo(() => catalogTopicShortcuts(catalog.items), [catalog.items]);
  const cardButtons = useRef(new Map<string, HTMLButtonElement>());
  const { launch, launchingKey, launchError } = useCatalogLaunch(catalog.items, catalog.scope, progress, {
    onOpenGuide,
    onAcceptedLaunch: (item) => update({ focusKey: item.key }),
    interactionLocation: 'package_browser',
  });
  const searchId = useId();

  useLayoutEffect(() => {
    if (container.current) {
      container.current.scrollTop = view.scrollTop;
    }
  }, [catalog.scope, view.scrollTop]);
  useLayoutEffect(() => {
    if (view.focusKey) {
      cardButtons.current.get(view.focusKey)?.focus({ preventScroll: true });
    }
  }, [catalog.scope, view.focusKey]);
  const effort = (item: CatalogPackage) =>
    [
      item.memberIds
        ? milestoneCountText(item.memberIds.length)
        : item.format === 'guide' && item.activityCount !== undefined
          ? t('packageBrowser.activities', '{{count}} activities', { count: item.activityCount })
          : null,
      item.estimatedMinutes
        ? t('packageBrowser.time', 'About {{minutes}} min', { minutes: item.estimatedMinutes })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const renderCard = (item: CatalogPackage, variant: 'featured' | 'compact' = 'compact') => (
    <LearningContentCard
      key={`${catalog.scope}:${item.key}`}
      title={item.title}
      kind={item.format}
      variant={variant}
      topic={catalogTopic(item)}
      description={item.description}
      effort={effort(item)}
      organization={item.source === 'organization'}
      progress={progress.get(item.key)?.percent}
      onLaunch={() => launch(item)}
      launching={launchingKey === item.key}
      launchDisabled={launchingKey !== null && launchingKey !== item.key}
      launchError={launchError?.key === item.key ? launchError.message : undefined}
      expanded={view.expandedKeys.includes(item.key)}
      onToggleDetails={() =>
        update({
          expandedKeys: view.expandedKeys.includes(item.key)
            ? view.expandedKeys.filter((key) => key !== item.key)
            : [...view.expandedKeys, item.key],
        })
      }
      disclosureLabel={item.memberIds?.length ? t('learningCard.showModules', 'Show milestones') : undefined}
      collapseLabel={item.memberIds?.length ? t('learningCard.hideModules', 'Hide milestones') : undefined}
      details={
        item.memberIds?.length ? (
          <CatalogDetails
            key={`${catalog.scope}:${item.key}:${JSON.stringify(item.memberIds)}`}
            item={item}
            items={catalog.items}
            scope={catalog.scope}
            progress={progress}
          />
        ) : undefined
      }
      actionRef={(node) => {
        if (node) {
          cardButtons.current.set(item.key, node);
        } else {
          cardButtons.current.delete(item.key);
        }
      }}
    />
  );

  return (
    <div
      ref={container}
      className={styles.container}
      data-testid="package-browser"
      onScroll={(event) => updateCatalogView(catalog.scope, { scrollTop: event.currentTarget.scrollTop }, false)}
    >
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            <h2>{t('packageBrowser.title', 'Explore learning')}</h2>
            <p className={styles.description}>
              {t('packageBrowser.description', 'Find something to learn or build in Grafana.')}
            </p>
          </div>
          <span className={styles.catalogCount}>
            {t('packageBrowser.catalogCount', '{{count}} to explore', { count: catalog.items.length })}
          </span>
        </div>
        <label htmlFor={searchId} className={styles.searchLabel}>
          {t('packageBrowser.searchLabel', 'Search guides and paths')}
        </label>
        <Input
          id={searchId}
          value={view.query}
          prefix={<Icon name="search" />}
          placeholder={t('packageBrowser.searchPlaceholder', 'Search dashboards, metrics, paths…')}
          onChange={(event) => update({ query: event.currentTarget.value, scrollTop: 0 })}
        />
        <div className={styles.navigation} role="group" aria-label={t('packageBrowser.browseView', 'Browse view')}>
          <button
            type="button"
            className={styles.viewTab}
            aria-pressed={view.mode === 'explore'}
            onClick={() =>
              update({ mode: 'explore', query: '', format: 'all', source: 'all', category: 'all', scrollTop: 0 })
            }
          >
            {t('packageBrowser.explore', 'Explore')}
          </button>
          <button
            type="button"
            className={styles.viewTab}
            aria-pressed={view.mode === 'all'}
            onClick={() => update({ mode: 'all', scrollTop: 0 })}
          >
            {t('packageBrowser.allContent', 'All content')}
          </button>
        </div>
        {view.mode === 'all' && (
          <div className={styles.filters}>
            <label htmlFor={`${searchId}-format`}>
              {t('packageBrowser.format', 'Format')}
              <Combobox
                id={`${searchId}-format`}
                aria-label={t('packageBrowser.format', 'Format')}
                value={view.format}
                options={[
                  { value: 'all', label: t('packageBrowser.allFormats', 'All formats') },
                  { value: 'guide', label: t('packageBrowser.guides', 'Guides') },
                  { value: 'path', label: t('packageBrowser.paths', 'Learning paths') },
                ]}
                onChange={(option) => update({ format: option.value as CatalogViewState['format'], scrollTop: 0 })}
              />
            </label>
            <label htmlFor={`${searchId}-topic`}>
              {t('packageBrowser.topic', 'Topic')}
              <Combobox
                id={`${searchId}-topic`}
                aria-label={t('packageBrowser.topic', 'Topic')}
                value={view.category}
                options={[
                  { value: 'all', label: t('packageBrowser.allTopics', 'All topics') },
                  ...categories.map((category) => ({ value: category.id, label: topicLabel(category.id) })),
                ]}
                onChange={(option) => update({ category: option.value ?? 'all', scrollTop: 0 })}
              />
            </label>
            <fieldset className={styles.sourceFilter}>
              <legend>{t('packageBrowser.source', 'Source')}</legend>
              <div className={styles.sourceSegments}>
                {(
                  [
                    { value: 'all', label: t('packageBrowser.allSourcesPill', 'All') },
                    { value: 'grafana', label: t('packageBrowser.official', 'Official') },
                    { value: 'organization', label: t('packageBrowser.organization', 'Your organization') },
                  ] as const
                ).map((source) => (
                  <button
                    key={source.value}
                    type="button"
                    className={styles.sourceSegment}
                    aria-pressed={view.source === source.value}
                    onClick={() => update({ source: source.value, scrollTop: 0 })}
                  >
                    {source.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}
        {(catalog.publicUnavailable || catalog.privateUnavailable) && (
          <Alert severity="warning" title={t('packageBrowser.sourceUnavailable', 'Some content is unavailable')}>
            <p>
              {catalog.publicUnavailable
                ? t(
                    'packageBrowser.publicUnavailable',
                    'Online Grafana content could not be loaded. Bundled guides remain available.'
                  )
                : t('packageBrowser.privateUnavailable', 'Organization content could not be loaded.')}
            </p>
            <Button size="sm" variant="secondary" disabled={catalog.loading} onClick={catalog.retry}>
              {t('packageBrowser.retry', 'Retry')}
            </Button>
          </Alert>
        )}
        {view.mode === 'explore' && (
          <>
            {starters.length > 0 && (
              <section className={styles.section} aria-labelledby={`${searchId}-starters`}>
                <div className={styles.sectionHeading}>
                  <h3 id={`${searchId}-starters`}>
                    {t('packageBrowser.startEssentials', 'Start with the essentials')}
                  </h3>
                  <span>{t('packageBrowser.guidedIntroductions', 'Guided introductions')}</span>
                </div>
                <div className={styles.grid}>
                  {starters.map((item, index) => (
                    <React.Fragment key={item.key}>
                      {index > 0 && item.format === 'guide' && (
                        <p className={styles.starterNote}>
                          {t('packageBrowser.singleGuide', 'Prefer a single guide?')}
                        </p>
                      )}
                      {renderCard(item, index === 0 && item.format === 'path' ? 'featured' : 'compact')}
                    </React.Fragment>
                  ))}
                </div>
              </section>
            )}
            {shortcuts.length > 0 && (
              <section className={styles.section} aria-labelledby={`${searchId}-topics`}>
                <div className={styles.sectionHeading}>
                  <h3 id={`${searchId}-topics`}>{t('packageBrowser.exploreTopics', 'Explore by topic')}</h3>
                </div>
                <div className={styles.topics}>
                  {shortcuts.map((topic) => (
                    <button
                      key={topic.id}
                      type="button"
                      className={styles.topicShortcut}
                      onClick={() =>
                        update({ category: topic.id, query: '', format: 'all', source: 'all', scrollTop: 0 })
                      }
                    >
                      <LearningTopicIcon topic={topic.id} size="sm" />
                      <span className={styles.topicContent}>
                        <strong>{topicLabel(topic.id)}</strong>
                        <small>
                          {t('packageBrowser.topicResults', '{{count}} guides and paths', { count: topic.count })}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className={styles.exploreFooter}>
              <span>{t('packageBrowser.specificTask', 'Have something specific in mind?')}</span>
              <Button
                variant="primary"
                fill="text"
                size="sm"
                icon="arrow-right"
                onClick={() => update({ mode: 'all', scrollTop: 0 })}
              >
                {t('packageBrowser.browseAllContent', 'Browse all content')}
              </Button>
            </div>
          </>
        )}
        {view.mode === 'all' && (
          <>
            <div className={styles.resultRow}>
              <span role="status" aria-live="polite">
                {t('packageBrowser.results', '{{count}} results', { count: items.length })}
                {catalog.loading && ` · ${t('packageBrowser.loading', 'Loading more content…')}`}
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => update({ query: '', format: 'all', source: 'all', category: 'all', scrollTop: 0 })}
              >
                {t('packageBrowser.clear', 'Clear filters')}
              </Button>
            </div>
            <div className={styles.grid}>{items.slice(0, view.visibleCount).map((item) => renderCard(item))}</div>
            {items.length > view.visibleCount && (
              <div className={`${styles.resultRow} ${styles.pagination}`}>
                <span>
                  {t('packageBrowser.showing', 'Showing {{shown}} of {{total}} results', {
                    shown: view.visibleCount,
                    total: items.length,
                  })}
                </span>
                <Button
                  variant="secondary"
                  onClick={() => update({ visibleCount: view.visibleCount + CATALOG_BATCH_SIZE })}
                >
                  {t('packageBrowser.showMore', 'Show more')}
                </Button>
              </div>
            )}
            {items.length === 0 && !catalog.loading && (
              <div className={styles.empty}>
                <Icon name="search" size="xl" />
                <h3>{t('packageBrowser.noResults', 'No guides match these filters')}</h3>
                <p>{t('packageBrowser.noResultsDescription', 'Clear the filters or try another search.')}</p>
              </div>
            )}
          </>
        )}
        {catalog.loading && (view.mode === 'explore' ? starters.length === 0 : items.length === 0) && (
          <SkeletonLoader type="recommendations" />
        )}
      </div>
    </div>
  );
}
