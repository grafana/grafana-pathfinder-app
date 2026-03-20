import React, { useMemo, useState } from 'react';
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
import { getTeamProgressStyles } from './team-progress.styles';
import { MOCK_COMPLETIONS } from './mock-data';

// ============================================================================
// SCENE OBJECT
// ============================================================================

interface TeamProgressPanelState extends SceneObjectState {}

export class TeamProgressPanel extends SceneObjectBase<TeamProgressPanelState> {
  public static Component = TeamProgressPanelRenderer;
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
  totalCompletions: number;
  uniqueUsers: number;
  avgDuration: string;
  avgCompletionPercent: number;
}

interface UserRow {
  id: string;
  userDisplayName: string;
  completions: number;
}

function aggregateByGuide(items: GuideCompletionResource[]): GuideRow[] {
  const map = new Map<string, { completions: GuideCompletionResource[]; users: Set<string> }>();

  for (const item of items) {
    const key = item.spec.guideId;
    if (!map.has(key)) {
      map.set(key, { completions: [], users: new Set() });
    }
    const entry = map.get(key)!;
    entry.completions.push(item);
    entry.users.add(item.spec.userLogin);
  }

  return Array.from(map.entries())
    .map(([id, { completions, users }]) => {
      const totalDuration = completions.reduce((sum, c) => sum + c.spec.durationSeconds, 0);
      const totalPercent = completions.reduce((sum, c) => sum + c.spec.completionPercent, 0);
      return {
        id,
        guideTitle: completions[0]!.spec.guideTitle,
        totalCompletions: completions.length,
        uniqueUsers: users.size,
        avgDuration: formatDuration(Math.round(totalDuration / completions.length)),
        avgCompletionPercent: Math.round(totalPercent / completions.length),
      };
    })
    .sort((a, b) => b.totalCompletions - a.totalCompletions);
}

function aggregateByUser(items: GuideCompletionResource[]): UserRow[] {
  const map = new Map<string, { displayName: string; count: number }>();

  for (const item of items) {
    const key = item.spec.userLogin;
    if (!map.has(key)) {
      map.set(key, { displayName: item.spec.userDisplayName, count: 0 });
    }
    map.get(key)!.count++;
  }

  return Array.from(map.values())
    .map((v) => ({ id: v.displayName, userDisplayName: v.displayName, completions: v.count }))
    .sort((a, b) => b.completions - a.completions);
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

  for (const item of items) {
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
  { id: 'totalCompletions', header: 'Total completions', sortType: 'number' },
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
  { id: 'completions', header: 'Completions', sortType: 'number' },
];

// ============================================================================
// RENDERER
// ============================================================================

function TeamProgressPanelRenderer() {
  const styles = useStyles2(getTeamProgressStyles);
  // TODO: Replace with CRD API fetch when available
  const [completions] = useState<GuideCompletionResource[]>(MOCK_COMPLETIONS);

  const admin = isAdmin();

  const [now] = useState(() => Date.now());

  const statsScene = useMemo(() => {
    let total = 0;
    let activeUsers = 0;
    let avgSeconds = 0;
    let topGuide = '-';

    if (completions.length > 0) {
      total = completions.length;
      const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
      activeUsers = new Set(
        completions.filter((c) => new Date(c.spec.completedAt).getTime() > sevenDaysAgo).map((c) => c.spec.userLogin)
      ).size;
      avgSeconds = completions.reduce((s, c) => s + c.spec.durationSeconds, 0) / completions.length;
      topGuide = aggregateByGuide(completions)[0]?.guideTitle ?? '-';
    }

    return new SceneFlexLayout({
      direction: 'row',
      children: [
        buildStatPanel('Total completions', total),
        buildStatPanel('Active learners this week', activeUsers),
        buildStatPanel('Avg completion time', Math.round(avgSeconds), 's'),
        buildStatPanel('Most popular guide', topGuide),
      ],
    });
  }, [completions, now]);

  const guideRows = useMemo(() => aggregateByGuide(completions), [completions]);
  const userRows = useMemo(() => aggregateByUser(completions), [completions]);
  const chartScene = useMemo(() => buildChartScene(completions, now), [completions, now]);

  if (!admin) {
    return (
      <div className={styles.accessDenied} data-testid="team-progress-access-denied">
        <p>Team progress requires admin access.</p>
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
