import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Alert, Button, Icon, Input, Combobox, EmptyState, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { t } from '@grafana/i18n';
import { ControlsLabel } from '@grafana/scenes';

import { useLearningPageScroll } from '../../hooks';
import { resolvePackageNavLinks } from '../../docs-retrieval';
import { milestoneCountText } from '../LearningContentCard/learning-effort';
import {
  CATALOG_BATCH_SIZE,
  EMPTY_CATALOG_VIEW,
  type CatalogPackage,
  type CatalogViewState,
} from '../../types/package-catalog.types';
import { catalogSearchTopic, publicCatalogTopics, reportCatalogInteraction } from '../../lib/catalog-analytics';
import { filterCatalog, withoutPathMembers } from '../../lib/package-catalog';
import { getCatalogView, subscribeCatalogView, updateCatalogView } from '../../global-state/package-browser';
import {
  catalogIdentity,
  selectLearningPathEntries,
  usePackageCatalog,
  useCatalogProgress,
  useLearningPaths,
  useMyAssignments,
} from '../../learning-paths';
import { catalogStarters, catalogTopic, catalogTopicCounts, catalogTopicShortcuts } from '../../lib/catalog-discovery';
import type { PreparedGuideLaunch } from '../docs-panel/utils/prepare-guide-launch';
import { useCatalogLaunch } from '../LearningPaths/useCatalogLaunch';
import { getPackageBrowserStyles } from './package-browser.styles';
import { SkeletonLoader } from '../SkeletonLoader';
import { LearningContentCard } from '../LearningContentCard/LearningContentCard';
import { useLearningCardSelection } from '../LearningContentCard/useLearningCardSelection';
import { getLearningPreview } from '../LearningContentCard/learning-previews';
import { CatalogDetails } from './CatalogDetails';
import { LearningTopicIcon } from '../LearningContentCard/LearningTopicIcon';

const SEARCH_REPORT_COOLDOWN_MS = 5000;

export interface PackageBrowserProps {
  page?: boolean;
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

function CatalogFilter({
  label,
  id,
  page,
  children,
}: {
  label: string;
  id: string;
  page: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles2(getPackageBrowserStyles);
  return page ? (
    <div className={styles.pageFilter}>
      <ControlsLabel label={label} htmlFor={id} />
      {children}
    </div>
  ) : (
    <label htmlFor={id}>
      {label}
      {children}
    </label>
  );
}

export function PackageBrowser({ page = false, ...props }: PackageBrowserProps) {
  return page ? <PagePackageBrowser {...props} /> : <PackageBrowserContent {...props} />;
}

function PagePackageBrowser(props: Omit<PackageBrowserProps, 'page'>) {
  const learning = useLearningPaths();
  const assignments = useMyAssignments({
    paths: learning.paths,
    getPathProgress: learning.getPathProgress,
    getPathGuides: learning.getPathGuides,
    completedGuides: learning.progress.completedGuides,
    resolveNavLinks: resolvePackageNavLinks,
  });
  return <PackageBrowserContent {...props} page pageLearning={{ learning, assignments }} />;
}

function PackageBrowserContent({
  onOpenGuide,
  page = false,
  pageLearning,
}: PackageBrowserProps & {
  pageLearning?: { learning: ReturnType<typeof useLearningPaths>; assignments: ReturnType<typeof useMyAssignments> };
}) {
  const styles = useStyles2(getPackageBrowserStyles);
  const catalog = usePackageCatalog();
  const { selectedCardKey, selectCard } = useLearningCardSelection(catalog.scope);
  const viewScope = page ? `${catalog.scope}:homepage-explore` : catalog.scope;
  const snapshot = useCallback(() => getCatalogView(catalog.scope), [catalog.scope]);
  const sidebarView = useSyncExternalStore(subscribeCatalogView, snapshot, snapshot);
  const [pageView, setPageView] = useState<CatalogViewState>(() => {
    const params = new URLSearchParams(window.location.search);
    const topic = params.get('topic');
    return {
      ...EMPTY_CATALOG_VIEW,
      ...(page ? { mode: 'all' as const } : {}),
      ...(page && (topic || params.get('view') === 'all') ? { mode: 'all' as const, category: topic || 'all' } : {}),
    };
  });
  const [completionFilter, setCompletionFilter] = useState<'all' | 'in-progress' | 'completed'>('all');
  const view = page ? pageView : sidebarView;
  const writeView = useCallback(
    (patch: Partial<CatalogViewState>, notify = true) => {
      if (page) {
        setPageView((current) => ({ ...current, ...patch }));
      } else {
        updateCatalogView(catalog.scope, patch, notify);
      }
    },
    [page, catalog.scope]
  );
  const container = useRef<HTMLDivElement>(null);
  useLearningPageScroll(container, page);
  const editedSearchScope = useRef<string | null>(null);
  const searchReportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSearchTopic = useRef<string | null>(null);
  const lastSearchReportedAt = useRef<number | undefined>(undefined);
  const cancelPendingSearch = useCallback(() => {
    clearTimeout(searchReportTimer.current);
    searchReportTimer.current = undefined;
  }, []);
  const reportSearch = useCallback(() => {
    if (editedSearchScope.current !== viewScope) {
      return;
    }
    editedSearchScope.current = null;
    cancelPendingSearch();
    const topic = catalogSearchTopic(view.query);
    if (!view.query.trim() || topic === lastSearchTopic.current) {
      return;
    }
    const emit = () => {
      searchReportTimer.current = undefined;
      lastSearchTopic.current = topic;
      lastSearchReportedAt.current = Date.now();
      reportCatalogInteraction({ action: 'search', topic });
    };
    const remaining =
      lastSearchReportedAt.current === undefined
        ? 0
        : lastSearchReportedAt.current + SEARCH_REPORT_COOLDOWN_MS - Date.now();
    if (remaining > 0) {
      searchReportTimer.current = setTimeout(emit, remaining);
    } else {
      emit();
    }
  }, [cancelPendingSearch, viewScope, view.query]);
  useEffect(() => {
    editedSearchScope.current = null;
    lastSearchTopic.current = null;
    lastSearchReportedAt.current = undefined;
    return cancelPendingSearch;
  }, [viewScope, cancelPendingSearch]);
  const update = useCallback(
    (patch: Partial<CatalogViewState>) => {
      if ('query' in patch && !patch.query?.trim()) {
        cancelPendingSearch();
        editedSearchScope.current = null;
        lastSearchTopic.current = null;
      }
      const filtersChanged = 'query' in patch || 'format' in patch || 'source' in patch || 'category' in patch;
      const navigationChanged = filtersChanged || 'mode' in patch;
      writeView({
        ...(navigationChanged ? { focusKey: null, visibleCount: CATALOG_BATCH_SIZE } : {}),
        ...(filtersChanged ? { mode: 'all' as const } : {}),
        ...patch,
      });
      if (navigationChanged && container.current) {
        container.current.scrollTop = 0;
      }
    },
    [writeView, cancelPendingSearch]
  );
  const selectView = (mode: CatalogViewState['mode']) => {
    if (mode !== view.mode) {
      reportCatalogInteraction({ action: 'view', view: mode, previousView: view.mode });
    }
    update(
      mode === 'explore'
        ? { mode, query: '', format: 'all', source: 'all', category: 'all', scrollTop: 0 }
        : { mode, scrollTop: 0 }
    );
  };
  const publicTopics = useMemo(() => publicCatalogTopics(catalog.items), [catalog.items]);
  const selectTopic = (topic: string, control: 'shortcut' | 'filter') => {
    reportCatalogInteraction({ action: 'topic', topic, control, publicTopics });
    update(
      control === 'shortcut'
        ? { category: topic, query: '', format: 'all', source: 'all', scrollTop: 0 }
        : { category: topic, scrollTop: 0 }
    );
  };
  const catalogProgress = useCatalogProgress(catalog.items, catalog.scope);
  const pathEntries = useMemo(
    () =>
      pageLearning
        ? selectLearningPathEntries({
            paths: pageLearning.learning.paths,
            onlinePaths: pageLearning.assignments.onlinePaths,
            assignmentByTargetId: pageLearning.assignments.assignmentByTargetId,
            catalogItems: catalog.items,
            catalogProgress,
            getPathProgress: pageLearning.learning.getPathProgress,
            getPathGuides: pageLearning.assignments.getPathGuides,
            includeCompleted: true,
          })
        : [],
    [pageLearning, catalog.items, catalogProgress]
  );
  const pageItems = useMemo(() => {
    if (!page) {
      return catalog.items;
    }
    const merged = new Map(catalog.items.map((item) => [catalogIdentity(item), item]));
    for (const entry of pathEntries) {
      if (!merged.has(entry.key)) {
        merged.set(entry.key, {
          key: `assigned:${entry.key}`,
          id: entry.path.id,
          title: entry.path.title,
          description: entry.path.description,
          format: 'path',
          source: entry.path.isPrivate ? 'organization' : 'grafana',
          url: entry.path.url ?? '',
          category: entry.topic,
          memberIds: entry.path.guides,
          curatedPath: entry.path,
          packageInfo: entry.path.isPrivate
            ? {
                packageId: entry.path.id,
                repository: 'app-platform',
                packageManifest: entry.path.manifest,
                trackId: entry.assignment?.trackId,
              }
            : undefined,
        });
      }
    }
    return [...merged.values()];
  }, [page, catalog.items, pathEntries]);
  const progress = useMemo(() => {
    if (!page) {
      return catalogProgress;
    }
    const merged = new Map(catalogProgress);
    for (const entry of pathEntries) {
      const item = pageItems.find(
        (candidate) => candidate.format === 'path' && catalogIdentity(candidate) === entry.key
      );
      if (item) {
        const nextGuide =
          entry.guides.find((guide) => guide.isCurrent && !guide.completed) ??
          entry.guides.find((guide) => !guide.completed);
        merged.set(item.key, {
          ...merged.get(item.key),
          percent: entry.percent,
          nextId: nextGuide?.id ?? merged.get(item.key)?.nextId,
        });
      }
    }
    return merged;
  }, [page, catalogProgress, pathEntries, pageItems]);
  const browsable = useMemo(
    () =>
      page
        ? completionFilter !== 'all'
          ? pageItems
          : withoutPathMembers(pageItems)
        : withoutPathMembers(catalog.items),
    [catalog.items, pageItems, page, completionFilter]
  );
  const normalizedItems = useMemo(
    () => browsable.map((item) => ({ ...item, category: catalogTopic(item) })),
    [browsable]
  );
  const items = useMemo(
    () =>
      filterCatalog(normalizedItems, view).filter((item) => {
        if (!page || completionFilter === 'all') {
          return true;
        }
        const percent = progress.get(item.key)?.percent ?? 0;
        return completionFilter === 'completed' ? percent >= 100 : percent > 0 && percent < 100;
      }),
    [normalizedItems, view, page, completionFilter, progress]
  );
  const categories = useMemo(() => catalogTopicCounts(browsable), [browsable]);
  const starters = useMemo(() => catalogStarters(catalog.items), [catalog.items]);
  const shortcuts = useMemo(() => catalogTopicShortcuts(browsable), [browsable]);
  const cardButtons = useRef(new Map<string, HTMLButtonElement>());
  const { launch, launchingKey, launchError } = useCatalogLaunch(
    page ? pageItems : catalog.items,
    catalog.scope,
    progress,
    {
      onOpenGuide,
      loadInSidebar: page,
      onAcceptedLaunch: (item) => {
        update({ focusKey: item.key });
        selectCard(item.key);
      },
      interactionLocation: 'package_browser',
    }
  );
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
      !page && item.estimatedMinutes
        ? t('packageBrowser.time', 'About {{minutes}} min', { minutes: item.estimatedMinutes })
        : null,
    ]
      .filter(Boolean)
      .join(' · ');

  const renderCard = (item: CatalogPackage, variant: 'featured' | 'compact' = 'compact') => (
    <LearningContentCard
      key={`${catalog.scope}:${item.key}`}
      title={item.title}
      tile={page}
      selected={page && selectedCardKey === item.key && launchError?.key !== item.key}
      preview={page && item.source === 'grafana' ? getLearningPreview(item.id) : undefined}
      onViewPath={page ? () => launch(item) : undefined}
      kind={item.format}
      variant={variant}
      topic={catalogTopic(item)}
      description={item.description}
      effort={effort(item)}
      estimatedMinutes={page ? item.estimatedMinutes : undefined}
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

  const searchControl = (
    <>
      <label htmlFor={searchId} className={styles.searchLabel}>
        {t('packageBrowser.searchLabel', 'Search guides and learning paths')}
      </label>
      <Input
        id={searchId}
        value={view.query}
        prefix={<Icon name="search" />}
        placeholder={
          page
            ? t('packageBrowser.pageSearchPlaceholder', 'Search')
            : t('packageBrowser.searchPlaceholder', 'Search dashboards, metrics, learning paths…')
        }
        onChange={(event) => {
          const query = event.currentTarget.value;
          cancelPendingSearch();
          editedSearchScope.current = viewScope;
          update({ query, scrollTop: 0 });
        }}
        onBlur={reportSearch}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            reportSearch();
          }
        }}
      />
    </>
  );

  return (
    <div
      ref={container}
      className={page ? styles.pageContainer : styles.container}
      data-testid="package-browser"
      onScroll={(event) => writeView({ scrollTop: event.currentTarget.scrollTop }, false)}
    >
      <div className={styles.inner}>
        <div className={styles.header}>
          <div>
            {page ? (
              <h1>{t('packageBrowser.title', 'Explore learning')}</h1>
            ) : (
              <h2>{t('packageBrowser.title', 'Explore learning')}</h2>
            )}
            <p className={styles.description}>
              {t('packageBrowser.description', 'Browse all guides and learning paths.')}
            </p>
          </div>
          {!page && (
            <span className={styles.catalogCount}>
              {t('packageBrowser.catalogCount', '{{count}} to explore', { count: browsable.length })}
            </span>
          )}
        </div>
        {!page && searchControl}
        {!page && (
          <div className={styles.navigation} role="group" aria-label={t('packageBrowser.browseView', 'Browse view')}>
            <button
              type="button"
              className={styles.viewTab}
              aria-pressed={view.mode === 'explore'}
              onClick={() => selectView('explore')}
            >
              {t('packageBrowser.explore', 'Explore')}
            </button>
            <button
              type="button"
              className={styles.viewTab}
              aria-pressed={view.mode === 'all'}
              onClick={() => selectView('all')}
            >
              {t('packageBrowser.allContent', 'All content')}
            </button>
          </div>
        )}
        {view.mode === 'all' && (
          <div className={page ? styles.pageFilters : undefined}>
            <div className={page ? styles.pageFilterControls : styles.filters}>
              {page && (
                <fieldset className={styles.completionFilter} aria-label={t('packageBrowser.status', 'Status')}>
                  <RadioButtonGroup<'all' | 'in-progress' | 'completed'>
                    className={styles.completionToggle}
                    options={[
                      { value: 'all', label: t('packageBrowser.allStatus', 'All') },
                      { value: 'in-progress', label: t('packageBrowser.inProgress', 'In progress') },
                      { value: 'completed', label: t('packageBrowser.completed', 'Completed') },
                    ]}
                    value={completionFilter}
                    onChange={(value) => {
                      setCompletionFilter(value);
                      update({ scrollTop: 0, visibleCount: CATALOG_BATCH_SIZE });
                    }}
                  />
                </fieldset>
              )}
              <CatalogFilter label={t('packageBrowser.format', 'Format')} id={`${searchId}-format`} page={page}>
                <Combobox
                  id={`${searchId}-format`}
                  aria-label={t('packageBrowser.format', 'Format')}
                  {...(page ? { width: 'auto' as const, minWidth: 12, maxWidth: 24 } : { width: undefined })}
                  value={view.format}
                  options={[
                    { value: 'all', label: t('packageBrowser.allFormats', 'All formats') },
                    { value: 'guide', label: t('packageBrowser.guides', 'Guides') },
                    { value: 'path', label: t('packageBrowser.paths', 'Learning paths') },
                  ]}
                  onChange={(option) => update({ format: option.value as CatalogViewState['format'], scrollTop: 0 })}
                />
              </CatalogFilter>
              <CatalogFilter label={t('packageBrowser.topic', 'Topic')} id={`${searchId}-topic`} page={page}>
                <Combobox
                  id={`${searchId}-topic`}
                  aria-label={t('packageBrowser.topic', 'Topic')}
                  {...(page ? { width: 'auto' as const, minWidth: 12, maxWidth: 24 } : { width: undefined })}
                  value={view.category}
                  options={[
                    { value: 'all', label: t('packageBrowser.allTopics', 'All topics') },
                    ...categories.map((category) => ({ value: category.id, label: topicLabel(category.id) })),
                  ]}
                  onChange={(option) => selectTopic(option.value ?? 'all', 'filter')}
                />
              </CatalogFilter>
              {page ? (
                <CatalogFilter label={t('packageBrowser.source', 'Source')} id={`${searchId}-source`} page>
                  <Combobox<CatalogViewState['source']>
                    id={`${searchId}-source`}
                    aria-label={t('packageBrowser.source', 'Source')}
                    width="auto"
                    minWidth={12}
                    maxWidth={24}
                    options={[
                      { value: 'all', label: t('packageBrowser.allSourcesPill', 'All') },
                      { value: 'grafana', label: t('packageBrowser.official', 'Official') },
                      { value: 'organization', label: t('packageBrowser.organization', 'Your organization') },
                    ]}
                    value={view.source}
                    onChange={(option) => {
                      const source = option.value;
                      if (source !== view.source) {
                        reportCatalogInteraction({ action: 'source', source, previousSource: view.source });
                      }
                      update({ source, scrollTop: 0 });
                    }}
                  />
                </CatalogFilter>
              ) : (
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
                        onClick={() => {
                          if (source.value !== view.source) {
                            reportCatalogInteraction({
                              action: 'source',
                              source: source.value,
                              previousSource: view.source,
                            });
                          }
                          update({ source: source.value, scrollTop: 0 });
                        }}
                      >
                        {source.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
            {page && <div className={styles.pageSearch}>{searchControl}</div>}
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
        {!page && view.mode === 'explore' && (
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
                      onClick={() => selectTopic(topic.id, 'shortcut')}
                    >
                      <LearningTopicIcon topic={topic.id} size="sm" />
                      <span className={styles.topicContent}>
                        <strong>{topicLabel(topic.id)}</strong>
                        <small>
                          {t('packageBrowser.topicResults', '{{count}} guides and learning paths', {
                            count: topic.count,
                          })}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className={styles.exploreFooter}>
              <span>{t('packageBrowser.specificTask', 'Have something specific in mind?')}</span>
              <Button variant="primary" fill="text" size="sm" icon="arrow-right" onClick={() => selectView('all')}>
                {t('packageBrowser.browseAllContent', 'Browse all content')}
              </Button>
            </div>
          </>
        )}
        {view.mode === 'all' && (
          <>
            {!page && (
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
            )}
            <div className={page ? styles.pageGrid : styles.grid}>
              {items.slice(0, view.visibleCount).map((item) => renderCard(item))}
            </div>
            {items.length > view.visibleCount && (
              <div className={`${styles.resultRow} ${page ? styles.pagePagination : styles.pagination}`}>
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
              <EmptyState variant="not-found" message={t('packageBrowser.noResults', 'No guides match these filters')}>
                {t('packageBrowser.noResultsDescription', 'Clear the filters or try another search.')}
              </EmptyState>
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
