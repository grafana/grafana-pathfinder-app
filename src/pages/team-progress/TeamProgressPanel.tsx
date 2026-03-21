import React, { useEffect, useMemo, useState } from 'react';
import {
  EmbeddedScene,
  SceneDataNode,
  SceneFlexItem,
  SceneFlexLayout,
  SceneObjectBase,
  VizPanel,
  type SceneObjectState,
} from '@grafana/scenes';
import { InteractiveTable, PanelChrome, useStyles2, type Column } from '@grafana/ui';
import { config } from '@grafana/runtime';
import { createDataFrame, FieldType, LoadingState } from '@grafana/data';

import { GuideCompletionResource } from '../../types/guide-completion.types';
import { fetchGuideCompletions } from '../../lib/fetchGuideCompletions';
import { getTeamProgressStyles } from './team-progress.styles';

// ============================================================================
// SCENE OBJECT
// ============================================================================

interface TeamProgressPanelState extends SceneObjectState {
  /** Bumped on each activation to trigger a data re-fetch */
  fetchEpoch?: number;
}

export class TeamProgressPanel extends SceneObjectBase<TeamProgressPanelState> {
  public static Component = TeamProgressPanelRenderer;

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

  return Array.from(map.values())
    .map((v) => ({
      id: v.displayName,
      userDisplayName: v.displayName,
      completed: v.completed,
      inProgress: v.inProgress,
    }))
    .sort((a, b) => b.completed - a.completed || b.inProgress - a.inProgress);
}

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

function buildChartScene(items: GuideCompletionResource[], referenceNow: number): EmbeddedScene {
  const days = 30;
  const now = new Date(referenceNow);
  const countMap = new Map<string, number>();

  for (const item of items.filter(isCompleted)) {
    const d = new Date(item.spec.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    countMap.set(key, (countMap.get(key) ?? 0) + 1);
  }

  const timestamps: number[] = [];
  const counts: number[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
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
          from: new Date(timestamps[0]!),
          to: new Date(timestamps[timestamps.length - 1]!),
          raw: { from: 'now-30d', to: 'now' },
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

// ============================================================================
// RENDERER
// ============================================================================

function TeamProgressPanelRenderer({ model }: { model: TeamProgressPanel }) {
  const styles = useStyles2(getTeamProgressStyles);
  const { fetchEpoch } = model.useState();
  const [completions, setCompletions] = useState<GuideCompletionResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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

  const [now] = useState(() => Date.now());

  const statsScene = useMemo(() => {
    const completed = completions.filter(isCompleted);
    const inProgress = completions.filter((c) => !isCompleted(c));
    let avgSeconds = 0;
    let topGuide = '-';

    if (completed.length > 0) {
      avgSeconds = completed.reduce((s, c) => s + c.spec.durationSeconds, 0) / completed.length;
      topGuide = aggregateByGuide(completed)[0]?.guideTitle ?? '-';
    }

    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const activeUsers = new Set(
      completions.filter((c) => new Date(c.spec.completedAt).getTime() > sevenDaysAgo).map((c) => c.spec.userLogin)
    ).size;

    return new SceneFlexLayout({
      direction: 'row',
      children: [
        buildStatPanel('Completed', completed.length),
        buildStatPanel('In progress', inProgress.length),
        buildStatPanel('Active learners this week', activeUsers),
        buildStatPanel('Avg completion time', Math.round(avgSeconds), 's'),
        buildStatPanel('Most popular guide', topGuide),
      ],
    });
  }, [completions, now]);

  const guideRows = useMemo(() => aggregateByGuide(completions), [completions]);
  const userRows = useMemo(() => aggregateByUser(completions), [completions]);
  const chartScene = useMemo(() => buildChartScene(completions, now), [completions, now]);

  if (isLoading) {
    return (
      <div className={styles.emptyState}>
        <p>Loading team progress data...</p>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className={styles.emptyState} data-testid="team-progress-access-denied">
        <p>Team progress requires admin access.</p>
      </div>
    );
  }

  if (completions.length === 0) {
    return (
      <div className={styles.emptyState} data-testid="team-progress-empty">
        <p>No completion data yet. Completions will appear here as users complete guides.</p>
      </div>
    );
  }

  return (
    <div className={styles.container} data-testid="team-progress-page">
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

      {/* Leaderboard */}
      <PanelChrome title="Leaderboard">
        <InteractiveTable columns={USER_COLUMNS} data={userRows} getRowId={(row) => row.id} />
      </PanelChrome>
    </div>
  );
}
