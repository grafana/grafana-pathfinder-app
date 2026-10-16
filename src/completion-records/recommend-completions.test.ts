import type { MyCompletionsResponseWire } from '../types/backend-api.schema';
import { projectRecommendCompletions, RECOMMEND_COMPLETIONS_MAX_ITEMS } from './recommend-completions';

type Completed = MyCompletionsResponseWire['completions'][number];
type InProgress = MyCompletionsResponseWire['inProgress'][number];

function completed(overrides: Overrides<Completed> = {}): Completed {
  return {
    guideSource: 'interactive-tutorials',
    guideId: 'g',
    guideTitle: 'G',
    guideCategory: 'interactive',
    pathId: '',
    count: 1,
    latestCompletedAt: '2026-09-01T00:00:00Z',
    latestSource: 'objectives',
    maxCompletionPercent: 100,
    ...overrides,
  };
}

type Overrides<T> = Partial<T>;

function partial(overrides: Overrides<InProgress> = {}): InProgress {
  return {
    guideSource: 'interactive-tutorials',
    guideId: 'g',
    guideTitle: 'G',
    guideCategory: 'interactive',
    pathId: '',
    completionPercent: 40,
    lastUpdatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function my(
  completions: Completed[] = [],
  inProgress: InProgress[] = [],
  extra: object = {}
): MyCompletionsResponseWire {
  return { capability: { available: true }, completions, inProgress, ...extra };
}

describe('projectRecommendCompletions', () => {
  it('returns an empty envelope for empty input', () => {
    expect(projectRecommendCompletions(my())).toEqual({ v: 1, truncated: false, items: [] });
  });

  it('uses the backend asOf, never the client clock', () => {
    expect(projectRecommendCompletions(my([], [], { asOf: '2026-10-13T12:00:00Z' })).as_of).toBe(
      '2026-10-13T12:00:00Z'
    );
  });

  it('drops non-public sources and local bundled guides, keeps other bundled guides', () => {
    const out = projectRecommendCompletions(
      my([
        completed({ guideSource: 'app-platform', guideId: 'a' }),
        completed({ guideSource: 'remote-repo:acme', guideId: 'b' }),
        completed({ guideSource: 'bundled', guideId: 'wysiwyg-preview' }),
        completed({ guideSource: 'bundled', guideId: 'e2e-test/content.json' }),
        completed({ guideSource: 'bundled', guideId: 'linux' }),
      ])
    );
    expect(out.items.map((i) => [i.guide_source, i.guide_id])).toEqual([['bundled', 'linux']]);
  });

  it('drops an in-progress app-platform row', () => {
    const out = projectRecommendCompletions(my([], [partial({ guideSource: 'app-platform', guideId: 'x' })]));
    expect(out.items).toEqual([]);
  });

  it('merges online-cdn and interactive-tutorials rows for the same id', () => {
    const out = projectRecommendCompletions(
      my([
        completed({ guideSource: 'online-cdn', guideId: 'x', count: 1, latestCompletedAt: '2026-07-01T00:00:00Z' }),
        completed({ guideSource: 'interactive-tutorials', guideId: 'x', count: 2 }),
      ])
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ guide_source: 'interactive-tutorials', guide_id: 'x', count: 3 });
  });

  it('merges legacy /content.json ids', () => {
    const out = projectRecommendCompletions(
      my([
        completed({ guideSource: 'bundled', guideId: 'x' }),
        completed({ guideSource: 'bundled', guideId: 'x/content.json' }),
      ])
    );
    expect(out.items).toHaveLength(1);
    expect(out.items[0]).toMatchObject({ guide_id: 'x', count: 2 });
  });

  it('takes the snapshot from the later completion when rows merge', () => {
    const out = projectRecommendCompletions(
      my([
        completed({
          guideSource: 'online-cdn',
          guideId: 'x',
          guideTitle: 'Old',
          latestCompletedAt: '2026-01-01T00:00:00Z',
        }),
        completed({
          guideId: 'x',
          guideTitle: 'New',
          latestCompletedAt: '2026-02-01T00:00:00Z',
          latestSource: 'manual',
        }),
      ])
    );
    expect(out.items[0]).toMatchObject({ method: 'manual', completed_at: '2026-02-01T00:00:00Z' });
  });

  it('never sends titles, categories or path ids, even for a public guide inside a private path', () => {
    const out = projectRecommendCompletions(
      my(
        [completed({ guideTitle: 'Secret title', guideCategory: 'secret', pathId: 'private-path' })],
        [partial({ guideId: 'p', guideTitle: 'Secret partial', pathId: 'private-path' })]
      )
    );
    expect(out.items).toHaveLength(2);
    for (const item of out.items) {
      expect(item).not.toHaveProperty('guide_title');
      expect(item).not.toHaveProperty('guide_category');
      expect(item).not.toHaveProperty('path_id');
    }
    expect(JSON.stringify(out)).not.toMatch(/Secret|private-path/);
  });

  it('clamps a negative count to zero', () => {
    expect(projectRecommendCompletions(my([completed({ count: -3 })])).items[0]?.count).toBe(0);
  });

  it('represents an in-progress-only guide with count 0 and no completion fields', () => {
    const [item] = projectRecommendCompletions(my([], [partial({ attemptStartedAt: '2026-10-01T00:00:00Z' })])).items;
    expect(item).toEqual({
      guide_source: 'interactive-tutorials',
      guide_id: 'g',
      percent: 40,
      count: 0,
      started_at: '2026-10-01T00:00:00Z',
      recorded_at: '2026-10-01T00:00:00Z',
    });
    expect(item).not.toHaveProperty('completed_at');
    expect(item).not.toHaveProperty('method');
  });

  it('keeps 100 percent for a completed-then-restarted guide with fresher timing', () => {
    const [item] = projectRecommendCompletions(
      my(
        [completed({ latestAttemptStartedAt: '2026-09-01T00:00:00Z', lastRecordedAt: '2026-09-01T00:00:05Z' })],
        [partial({ attemptStartedAt: '2026-10-02T09:01:10Z', lastUpdatedAt: '2026-10-02T09:12:40Z' })]
      )
    ).items;
    expect(item).toMatchObject({
      percent: 100,
      completed_at: '2026-09-01T00:00:00Z',
      started_at: '2026-10-02T09:01:10Z',
      recorded_at: '2026-10-02T09:12:40Z',
    });
  });

  it('does not coerce a legacy completion below 100 percent', () => {
    const [item] = projectRecommendCompletions(my([completed({ maxCompletionPercent: 80 })])).items;
    expect(item?.percent).toBe(80);
  });

  it('omits empty strings and zero durations', () => {
    const [item] = projectRecommendCompletions(
      my([completed({ guideTitle: '', guideCategory: '', pathId: '', latestDurationSeconds: 0 })])
    ).items;
    expect(Object.keys(item!).sort()).toEqual([
      'completed_at',
      'count',
      'guide_id',
      'guide_source',
      'method',
      'percent',
    ]);
  });

  it('sorts by recorded_at descending with missing and unparseable stamps last, passing the string through', () => {
    const out = projectRecommendCompletions(
      my([
        completed({ guideId: 'none' }),
        completed({ guideId: 'bad', lastRecordedAt: 'not-a-time' }),
        completed({ guideId: 'old', lastRecordedAt: '2026-01-01T00:00:00Z' }),
        completed({ guideId: 'new', lastRecordedAt: '2026-02-01T00:00:00Z' }),
      ])
    );
    expect(out.items.map((i) => i.guide_id)).toEqual(['new', 'old', 'bad', 'none']);
    expect(out.items[2]?.recorded_at).toBe('not-a-time');
  });

  it('breaks ties by source then id ascending', () => {
    const out = projectRecommendCompletions(
      my([
        completed({ guideSource: 'interactive-tutorials', guideId: 'b' }),
        completed({ guideSource: 'bundled', guideId: 'z' }),
        completed({ guideSource: 'interactive-tutorials', guideId: 'a' }),
      ])
    );
    expect(out.items.map((i) => `${i.guide_source}:${i.guide_id}`)).toEqual([
      'bundled:z',
      'interactive-tutorials:a',
      'interactive-tutorials:b',
    ]);
  });

  it('caps at the maximum and drops the oldest', () => {
    const rows = Array.from({ length: RECOMMEND_COMPLETIONS_MAX_ITEMS + 1 }, (_, i) =>
      completed({ guideId: `g${i}`, lastRecordedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString() })
    );
    const out = projectRecommendCompletions(my(rows));
    expect(out.items).toHaveLength(RECOMMEND_COMPLETIONS_MAX_ITEMS);
    expect(out.truncated).toBe(true);
    expect(out.items.map((i) => i.guide_id)).not.toContain('g0');
  });

  it('never forwards identity or customer fields', () => {
    const forbidden = [
      'userId',
      'userLogin',
      'userDisplayName',
      'orgId',
      'stackNamespace',
      'platform',
      'schemaVersion',
      'name',
    ];
    const poisoned = {
      ...completed({ latestAttemptStartedAt: '2026-10-01T00:00:00Z' }),
      userId: 'user:1',
      userLogin: 'login',
      orgId: 7,
      stackNamespace: 'stacks-1',
      platform: 'cloud',
      schemaVersion: 2,
      name: 'meta-name',
    };
    const out = projectRecommendCompletions(
      my([poisoned], [{ ...partial({ guideId: 'p' }), userId: 'user:1' } as InProgress], { userId: 'user:1' })
    );

    const keys = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          keys.add(k);
          walk(v);
        }
      }
    };
    walk(out);

    for (const key of forbidden) {
      expect(keys.has(key)).toBe(false);
    }
    expect(JSON.stringify(out)).not.toContain('user:1');
  });
});
