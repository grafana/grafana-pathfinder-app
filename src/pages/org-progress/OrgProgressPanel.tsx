import React, { useEffect, useMemo, useState } from 'react';
import {
  EmbeddedScene,
  sceneGraph,
  SceneDataNode,
  SceneFlexItem,
  SceneFlexLayout,
  SceneObjectBase,
  VizPanel,
  type SceneObjectState,
} from '@grafana/scenes';
import { InteractiveTable, PanelChrome, RadioButtonGroup, useStyles2, type Column } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { createDataFrame, FieldType, LoadingState } from '@grafana/data';

import { GuideCompletionResource } from '../../types/guide-completion.types';
import { fetchGuideCompletions } from '../../lib/fetchGuideCompletions';
import { getOrgProgressStyles } from './org-progress.styles';

// ============================================================================
// SCENE OBJECT
// ============================================================================

interface OrgProgressPanelState extends SceneObjectState {
  /** Bumped on each activation to trigger a data re-fetch */
  fetchEpoch?: number;
}

export class OrgProgressPanel extends SceneObjectBase<OrgProgressPanelState> {
  public static Component = OrgProgressPanelRenderer;

  constructor() {
    super({ fetchEpoch: 0 });
    this.addActivationHandler(() => {
      this.setState({ fetchEpoch: Date.now() });
    });
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function isAdmin(): boolean {
  return config.bootData?.user?.orgRole === 'Admin';
}

interface GuideRow {
  id: string;
  guideTitle: string;
  completed: number;
  inProgress: number;
  uniqueUsers: number;
  avgDuration: string;
  avgCompletionPercent: number;
}

interface UserRow {
  id: string;
  userDisplayName: string;
  completed: number;
  inProgress: number;
}

function isCompleted(item: GuideCompletionResource): boolean {
  return item.spec.completionPercent >= 100;
}

function aggregateByGuide(items: GuideCompletionResource[]): GuideRow[] {
  const map = new Map<string, { records: GuideCompletionResource[]; users: Set<string> }>();

  for (const item of items) {
    const key = item.spec.guideId;
    if (!map.has(key)) {
      map.set(key, { records: [], users: new Set() });
    }
    const entry = map.get(key)!;
    entry.records.push(item);
    entry.users.add(item.spec.userLogin);
  }

  return Array.from(map.entries())
    .map(([id, { records, users }]) => {
      const totalDuration = records.reduce((sum, c) => sum + c.spec.durationSeconds, 0);
      const totalPercent = records.reduce((sum, c) => sum + c.spec.completionPercent, 0);
      return {
        id,
        guideTitle: records[0]!.spec.guideTitle,
        completed: records.filter(isCompleted).length,
        inProgress: records.filter((r) => !isCompleted(r)).length,
        uniqueUsers: users.size,
        avgDuration: formatDuration(Math.round(totalDuration / records.length)),
        avgCompletionPercent: Math.round(totalPercent / records.length),
      };
    })
    .sort((a, b) => b.completed - a.completed || b.avgCompletionPercent - a.avgCompletionPercent);
}

function aggregateByUser(items: GuideCompletionResource[]): UserRow[] {
  const map = new Map<string, { displayName: string; completed: number; inProgress: number }>();

  for (const item of items) {
    const key = item.spec.userLogin;
    if (!map.has(key)) {
      map.set(key, { displayName: item.spec.userDisplayName, completed: 0, inProgress: 0 });
    }
    const entry = map.get(key)!;
    if (isCompleted(item)) {
      entry.completed++;
    } else {
      entry.inProgress++;
    }
  }

  return Array.from(map.entries())
    .map(([userLogin, v]) => ({
      id: userLogin,
      userDisplayName: v.displayName,
      completed: v.completed,
      inProgress: v.inProgress,
    }))
    .sort((a, b) => b.completed - a.completed || b.inProgress - a.inProgress);
}

interface DropOffRow {
  id: string;
  guideTitle: string;
  below50: number;
  between50and99: number;
  totalStalled: number;
  avgStallPoint: number;
}

function aggregateDropOff(items: GuideCompletionResource[]): DropOffRow[] {
  const gracePeriod = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const stalled = items.filter(
    (c) => c.spec.completionPercent < 100 && now - new Date(c.metadata.creationTimestamp ?? 0).getTime() > gracePeriod
  );

  const map = new Map<string, { title: string; percents: number[] }>();
  for (const item of stalled) {
    const key = item.spec.guideId;
    if (!map.has(key)) {
      map.set(key, { title: item.spec.guideTitle, percents: [] });
    }
    map.get(key)!.percents.push(item.spec.completionPercent);
  }

  return Array.from(map.entries())
    .map(([id, { title, percents }]) => {
      const below50 = percents.filter((p) => p < 50).length;
      const between50and99 = percents.filter((p) => p >= 50).length;
      const avgStallPoint = Math.round(percents.reduce((s, p) => s + p, 0) / percents.length);
      return { id, guideTitle: title, below50, between50and99, totalStalled: percents.length, avgStallPoint };
    })
    .sort((a, b) => b.totalStalled - a.totalStalled);
}

type CategoryFilter = 'all' | 'interactive' | 'documentation' | 'learning-journey';

const CATEGORY_OPTIONS: Array<{ label: string; value: CategoryFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Interactive', value: 'interactive' },
  { label: 'Documentation', value: 'documentation' },
  { label: 'Learning journey', value: 'learning-journey' },
];

function buildStatPanel(title: string, value: number | string, unit?: string): SceneFlexItem {
  const isNumeric = typeof value === 'number';
  const frame = createDataFrame({
    fields: [
      {
        name: title,
        type: isNumeric ? FieldType.number : FieldType.string,
        values: [value],
        config: unit ? { unit } : {},
      },
    ],
  });

  return new SceneFlexItem({
    minWidth: 200,
    height: 120,
    body: new VizPanel({
      pluginId: 'stat',
      title,
      options: {
        colorMode: 'background_solid',
        graphMode: 'none',
        textMode: 'value',
        justifyMode: 'auto',
        reduceOptions: { calcs: isNumeric ? ['lastNotNull'] : ['last'], fields: isNumeric ? '' : '/.+/' },
      },
      fieldConfig: {
        defaults: {
          color: { mode: 'fixed', fixedColor: 'blue' },
        },
        overrides: [],
      },
      $data: new SceneDataNode({
        data: {
          series: [frame],
          state: LoadingState.Done,
          timeRange: { from: new Date(), to: new Date(), raw: { from: 'now', to: 'now' } } as any,
        },
      }),
    }),
  });
}

function buildChartScene(items: GuideCompletionResource[], from: Date, to: Date): EmbeddedScene {
  const days = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  const useWeekly = days > 90;

  const countMap = new Map<string, number>();

  for (const item of items.filter(isCompleted)) {
    const d = new Date(item.spec.completedAt);
    let key: string;
    if (useWeekly) {
      const weekStart = new Date(d);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  const timestamps: number[] = [];
  const counts: number[] = [];
  const step = useWeekly ? 7 : 1;
  const cappedDays = Math.min(days, 365);

  for (let i = cappedDays - 1; i >= 0; i -= step) {
    const d = new Date(to);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    if (useWeekly) {
      d.setDate(d.getDate() - d.getDay());
    }
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    timestamps.push(d.getTime());
    counts.push(countMap.get(key) ?? 0);
  }

  const frame = createDataFrame({
    fields: [
      { name: 'Time', type: FieldType.time, values: timestamps },
      { name: 'Completions', type: FieldType.number, values: counts },
    ],
  });

  return new EmbeddedScene({
    $data: new SceneDataNode({
      data: {
        series: [frame],
        state: LoadingState.Done,
        timeRange: {
          from: timestamps.length > 0 ? new Date(timestamps[0]!) : from,
          to: timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1]!) : to,
          raw: { from: from.toISOString(), to: to.toISOString() },
        } as any,
      },
    }),
    body: new SceneFlexLayout({
      children: [
        new SceneFlexItem({
          body: new VizPanel({
            pluginId: 'barchart',
            title: '',
            options: {
              xTickLabelSpacing: 100,
              stacking: 'none',
              barWidth: 0.8,
              showValue: 'never',
              legend: { showLegend: false },
              tooltip: { mode: 'single' },
            },
            fieldConfig: {
              defaults: {
                color: { mode: 'fixed', fixedColor: 'blue' },
              },
              overrides: [],
            },
          }),
        }),
      ],
    }),
  });
}

// ============================================================================
// TABLE COLUMNS (memoized at module level)
// ============================================================================

const GUIDE_COLUMNS: Array<Column<GuideRow>> = [
  { id: 'guideTitle', header: 'Guide title', sortType: 'alphanumeric' },
  { id: 'completed', header: 'Completed', sortType: 'number' },
  { id: 'inProgress', header: 'In progress', sortType: 'number' },
  { id: 'uniqueUsers', header: 'Unique users', sortType: 'number' },
  { id: 'avgDuration', header: 'Avg duration', sortType: 'alphanumeric' },
  {
    id: 'avgCompletionPercent',
    header: 'Avg completion %',
    sortType: 'number',
    cell: ({ value }: { value: number }) => <>{value}%</>,
  },
];

const USER_COLUMNS: Array<Column<UserRow>> = [
  { id: 'userDisplayName', header: 'User', sortType: 'alphanumeric' },
  { id: 'completed', header: 'Completed', sortType: 'number' },
  { id: 'inProgress', header: 'In progress', sortType: 'number' },
];

const DROP_OFF_COLUMNS: Array<Column<DropOffRow>> = [
  { id: 'guideTitle', header: 'Guide title', sortType: 'alphanumeric' },
  { id: 'below50', header: 'Below 50%', sortType: 'number' },
  { id: 'between50and99', header: '50–99%', sortType: 'number' },
  { id: 'totalStalled', header: 'Total stalled', sortType: 'number' },
  {
    id: 'avgStallPoint',
    header: 'Avg stall point',
    sortType: 'number',
    cell: ({ value }: { value: number }) => <>{value}%</>,
  },
];

// ============================================================================
// RENDERER
// ============================================================================

function OrgProgressPanelRenderer({ model }: { model: OrgProgressPanel }) {
  const styles = useStyles2(getOrgProgressStyles);
  const { fetchEpoch } = model.useState();
  const [completions, setCompletions] = useState<GuideCompletionResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<CategoryFilter>('all');

  // Subscribe to the Scenes time range picker
  const timeRange = sceneGraph.getTimeRange(model);
  const { value: range } = timeRange.useState();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchGuideCompletions().then((items) => {
      if (cancelled) {
        return;
      }
      setCompletions(items);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchEpoch]);

  const admin = isAdmin();

  // Filter by category and time range
  const filteredCompletions = useMemo(() => {
    let items = completions;
    if (category !== 'all') {
      items = items.filter((c) => c.spec.guideCategory === category);
    }
    items = items.filter((c) => {
      const ts = new Date(c.metadata.creationTimestamp ?? 0).getTime();
      return ts >= range.from.valueOf() && ts <= range.to.valueOf();
    });
    return items;
  }, [completions, category, range]);

  const statsScene = useMemo(() => {
    const completed = filteredCompletions.filter(isCompleted);
    const inProgress = filteredCompletions.filter((c) => !isCompleted(c));
    let topGuide = '-';

    if (completed.length > 0) {
      topGuide = aggregateByGuide(completed)[0]?.guideTitle ?? '-';
    }

    const activeUsers = new Set(filteredCompletions.map((c) => c.spec.userLogin)).size;

    return new SceneFlexLayout({
      direction: 'row',
      children: [
        buildStatPanel('Completed', completed.length),
        buildStatPanel('In progress', inProgress.length),
        buildStatPanel('Active learners', activeUsers),
        buildStatPanel('Most popular guide', topGuide),
      ],
    });
  }, [filteredCompletions]);

  const guideRows = useMemo(() => aggregateByGuide(filteredCompletions), [filteredCompletions]);
  const userRows = useMemo(() => aggregateByUser(filteredCompletions), [filteredCompletions]);
  const dropOffRows = useMemo(() => aggregateDropOff(filteredCompletions), [filteredCompletions]);
  const chartScene = useMemo(
    () => buildChartScene(filteredCompletions, range.from.toDate(), range.to.toDate()),
    [filteredCompletions, range]
  );

  if (isLoading) {
    return (
      <div className={styles.emptyState}>
        <p>Loading org progress data...</p>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className={styles.emptyState} data-testid="org-progress-access-denied">
        <p>Org progress requires admin access.</p>
      </div>
    );
  }

  if (completions.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="org-progress-empty">
        <p>No completion data yet. Completions will appear here as users complete guides.</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="org-progress-page">
      {/* Category filter */}
      <div className={styles.filterBar}>
        <RadioButtonGroup options={CATEGORY_OPTIONS} value={category} onChange={setCategory} size="sm" />
      </div>

      {/* Empty filter state */}
      {filteredCompletions.length === 0 ? (
        <div className={styles.emptyState}>
          <p>No data matches the current filters.</p>
        </div>
      ) : (
        <>
          {/* Summary stat panels */}
          <div className={styles.statRow}>
            <statsScene.Component model={statsScene} key="stats" />
          </div>

          {/* Completions over time — native Grafana bar chart */}
          <PanelChrome title="Completions over time">
            <div className={styles.chartContainer}>
              <chartScene.Component model={chartScene} />
            </div>
          </PanelChrome>

          {/* Guide completion rates */}
          <PanelChrome title="Guide completion rates">
            <InteractiveTable columns={GUIDE_COLUMNS} data={guideRows} getRowId={(row) => row.id} />
          </PanelChrome>

          {/* Stalled learners */}
          {dropOffRows.length > 0 && (
            <PanelChrome title="Stalled learners" description="Excludes items started within the last 24 hours">
              <InteractiveTable columns={DROP_OFF_COLUMNS} data={dropOffRows} getRowId={(row) => row.id} />
            </PanelChrome>
          )}

          {/* Leaderboard */}
          <PanelChrome title="Leaderboard">
            <InteractiveTable columns={USER_COLUMNS} data={userRows} getRowId={(row) => row.id} />
          </PanelChrome>
        </>
      )}
    </div>
  );
}
