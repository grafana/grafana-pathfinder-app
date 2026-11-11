import {
  invalidateAllEmittedCompletions,
  onCompletionRecorded,
  recordGuideCompletion,
  recordJourneyCompletion,
  __resetRecorderForTests,
} from '../completion-recorder';
import { createQueueStorage } from '../completion-write-storage';
import type { CompletionFact, GuideCompletionFact } from '../types';

import {
  armAchievementEvents,
  discardQueuedAchievementEvents,
  toGuideCompletedEvent,
  toSourceEvent,
  __resetAchievementEventsForTests,
} from './achievement-events-hook';
import type { AchievementEventBody, EventOutcome } from './achievements-client';
import {
  applyEchoSources,
  installEchoSubscriptions,
  subscribedEchoNames,
  __resetEchoSourcesForTests,
} from '../../lib/achievement-echo';

jest.mock('../../utils/openfeature', () => ({
  getFeatureFlagValue: jest.fn(() => false),
  evaluateFeatureFlag: jest.fn(async () => false),
}));
jest.mock('../completion-write-storage', () => ({
  ...jest.requireActual('../completion-write-storage'),
  currentCompletionQueueOwnerKey: () => 'user-1:org-1',
}));
jest.mock('../../lib/user-storage', () => {
  const guard = () => {
    const keys = new Set<string>();
    return {
      isEmitted: (key: string) => keys.has(key),
      markEmitted: async (key: string) => void keys.add(key),
      clear: async (key: string) => void keys.delete(key),
      clearAll: async () => keys.clear(),
    };
  };
  return { completionEmittedStorage: guard(), completionReportedStorage: guard() };
});
jest.mock('../completion-analytics', () => ({ reportCompletionAnalytics: jest.fn() }));

function guideFact(overrides: Partial<GuideCompletionFact> = {}): GuideCompletionFact {
  return {
    kind: 'guide',
    guideSource: 'bundled',
    guideId: 'intro',
    guideTitle: 'Intro',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-11-01T00:00:00.000Z',
    durationMs: 1234,
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const guideIds = (bodies: AchievementEventBody[]) => bodies.map((b) => ('context' in b ? b.context.guideId : b.source));

function fakeEcho() {
  const listeners = new Map<string, Set<(properties: Record<string, unknown>) => void>>();
  return {
    subscribe: (name: string, callback: (properties: Record<string, unknown>) => void) => {
      const set = listeners.get(name) ?? new Set();
      set.add(callback);
      listeners.set(name, set);
      return () => set.delete(callback);
    },
    report: (name: string, properties: Record<string, unknown>) => listeners.get(name)?.forEach((cb) => cb(properties)),
  };
}

const DASHBOARD_SOURCE = {
  interaction: 'grafana_dashboard_created',
  properties: ['result', 'uid'],
  when: [{ property: 'result', op: 'eq', value: 'success' }],
};

function arm(enabled: Promise<boolean>, outcome?: EventOutcome, refreshSources = jest.fn()) {
  const sent: AchievementEventBody[] = [];
  const evaluated = jest.fn();
  let id = 0;
  armAchievementEvents({
    refreshSources,
    enabled: () => enabled,
    ownerKey: () => 'user-1:org-1',
    storage: (owner) => createQueueStorage<AchievementEventBody>('test-events:', owner, 'tab'),
    send: async (body): Promise<EventOutcome> => {
      sent.push(body);
      return outcome ?? { kind: 'evaluated', response: { eventId: body.eventId, retry: false, decisions: [] } };
    },
    onEvaluated: evaluated,
    newId: () => `event-${++id}`,
  });
  return { sent, evaluated };
}

beforeEach(() => {
  __resetAchievementEventsForTests();
  __resetEchoSourcesForTests();
  __resetRecorderForTests();
  invalidateAllEmittedCompletions();
  localStorage.clear();
});

describe('toGuideCompletedEvent', () => {
  it('builds a guides.completed event with only the declared context fields', () => {
    expect(toGuideCompletedEvent(guideFact({ pathId: 'path-1' }), 'event-1', 0)).toEqual({
      schemaVersion: 1,
      eventId: 'event-1',
      entity: 'guides',
      action: 'completed',
      occurredAt: '2026-11-01T00:00:00.000Z',
      context: { guideSource: 'bundled', guideId: 'intro', guideCategory: 'interactive', pathId: 'path-1' },
    });
  });

  it('omits pathId when the fact has none', () => {
    expect(toGuideCompletedEvent(guideFact(), 'e', 0)?.context).not.toHaveProperty('pathId');
  });

  it('ignores journey facts, which have no declared pair yet', () => {
    expect(toGuideCompletedEvent({ ...guideFact(), kind: 'journey' } as CompletionFact, 'e', 0)).toBeNull();
  });

  it('rejects an invalid identifier rather than queue a certain 400', () => {
    expect(toGuideCompletedEvent(guideFact({ guideId: '' }), 'e', 0)).toBeNull();
  });
});

describe('armAchievementEvents', () => {
  it('posts a recorded guide completion once the flag resolves true', async () => {
    const { sent } = arm(Promise.resolve(true));
    onCompletionRecorded(() => true);
    recordGuideCompletion(guideFact());
    await flush();
    await flush();
    expect(guideIds(sent)).toEqual(['intro']);
  });

  it('holds facts seen before the flag resolves, then sends them', async () => {
    let resolve!: (on: boolean) => void;
    const { sent } = arm(new Promise((r) => (resolve = r)));
    onCompletionRecorded(() => true);
    recordGuideCompletion(guideFact());
    await flush();
    expect(sent).toEqual([]);
    resolve(true);
    await flush();
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('discards held facts and sends nothing when the flag resolves false', async () => {
    const { sent } = arm(Promise.resolve(false));
    onCompletionRecorded(() => true);
    recordGuideCompletion(guideFact());
    await flush();
    recordGuideCompletion(guideFact({ guideId: 'second' }));
    await flush();
    expect(sent).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it('receives the recorder startup replay when armed before the durable listener', async () => {
    recordGuideCompletion(guideFact());
    const { sent } = arm(Promise.resolve(true));
    onCompletionRecorded(() => true);
    await flush();
    await flush();
    expect(sent).toHaveLength(1);
  });

  it('never counts as durable acceptance, so a rejected completion stays recordable', () => {
    arm(Promise.resolve(true));
    const durable = jest.fn(() => false);
    onCompletionRecorded(durable);
    recordGuideCompletion(guideFact());
    recordGuideCompletion(guideFact());
    expect(durable).toHaveBeenCalledTimes(2);
  });

  it('does not post journey completions', async () => {
    const { sent } = arm(Promise.resolve(true));
    onCompletionRecorded(() => true);
    recordJourneyCompletion({ ...guideFact(), kind: 'journey' });
    await flush();
    await flush();
    expect(sent).toEqual([]);
  });

  it.each(['route-missing', 'forbidden'] as const)(
    'on %s stops sending for the session but keeps later events for a later load',
    async (kind) => {
      const { sent } = arm(Promise.resolve(true), { kind });
      onCompletionRecorded(() => true);
      recordGuideCompletion(guideFact({ guideId: 'first' }));
      await flush();
      await flush();
      recordGuideCompletion(guideFact({ guideId: 'second' }));
      await flush();
      await flush();
      expect(guideIds(sent)).toEqual(['first']);
      const persisted = createQueueStorage<AchievementEventBody>('test-events:', 'user-1:org-1', 'other-tab').list();
      expect(guideIds(persisted.map((i) => i.body)).sort()).toEqual(['first', 'second']);

      __resetAchievementEventsForTests();
      const later = arm(Promise.resolve(true));
      await flush();
      await flush();
      expect(guideIds(later.sent).sort()).toEqual(['first', 'second']);
    }
  );

  it('holds at most 50 facts while the flag is unresolved', async () => {
    let resolve!: (on: boolean) => void;
    const { sent } = arm(new Promise((r) => (resolve = r)));
    onCompletionRecorded(() => true);
    for (let i = 0; i < 55; i++) {
      recordGuideCompletion(guideFact({ guideId: `guide-${i}` }));
    }
    resolve(true);
    for (let i = 0; i < 12; i++) {
      await flush();
    }
    expect(sent).toHaveLength(50);
  });

  it('discards events an earlier load persisted when reset lands before the flag resolves', async () => {
    createQueueStorage<AchievementEventBody>('test-events:', 'user-1:org-1', 'old-tab').put({
      id: 'old',
      body: toGuideCompletedEvent(guideFact({ guideId: 'old' }), 'old', Date.now())!,
      attempts: 0,
      createdAt: Date.now(),
      nextAttemptAt: Date.now(),
    });
    let resolve!: (on: boolean) => void;
    const { sent } = arm(new Promise((r) => (resolve = r)));
    discardQueuedAchievementEvents();
    resolve(true);
    await flush();
    await flush();
    expect(sent).toEqual([]);
  });

  it('discards queued and held events on a progress reset', async () => {
    let resolve!: (on: boolean) => void;
    const { sent } = arm(new Promise((r) => (resolve = r)));
    onCompletionRecorded(() => true);
    recordGuideCompletion(guideFact());
    discardQueuedAchievementEvents();
    resolve(true);
    await flush();
    await flush();
    expect(sent).toEqual([]);
  });

  it('hands each evaluated response to the display', async () => {
    const { evaluated } = arm(Promise.resolve(true));
    onCompletionRecorded(() => true);
    recordGuideCompletion(guideFact());
    await flush();
    await flush();
    expect(evaluated).toHaveBeenCalledWith({ eventId: 'event-1', retry: false, decisions: [] });
  });
});

describe('Echo delivery', () => {
  function installWithCachedSource() {
    const echo = fakeEcho();
    localStorage.setItem(
      'grafana-pathfinder-app-achievement-sources-v1:user-1:org-1',
      JSON.stringify([DASHBOARD_SOURCE])
    );
    installEchoSubscriptions({
      subscribe: echo.subscribe,
      ownerKey: () => 'user-1:org-1',
      now: () => Date.parse('2026-11-10T12:00:00Z'),
    });
    return echo;
  }

  it('builds a source-shaped event that names no pair', () => {
    expect(
      toSourceEvent(
        {
          source: 'grafana_dashboard_created',
          properties: { uid: 'abc' },
          occurredAt: Date.parse('2026-11-10T12:00:00Z'),
        },
        'e1'
      )
    ).toEqual({
      schemaVersion: 1,
      eventId: 'e1',
      source: 'grafana_dashboard_created',
      occurredAt: '2026-11-10T12:00:00.000Z',
      properties: { uid: 'abc' },
    });
  });

  it('queues events held before the flag resolves true, then live ones, with only listed properties', async () => {
    const echo = installWithCachedSource();
    echo.report('grafana_dashboard_created', { uid: 'early', result: 'success', title: 'Prod' });
    let resolve!: (on: boolean) => void;
    const { sent } = arm(new Promise((r) => (resolve = r)));
    await flush();
    expect(sent).toEqual([]);

    resolve(true);
    await flush();
    echo.report('grafana_dashboard_created', { uid: 'live', result: 'success' });
    echo.report('grafana_dashboard_created', { uid: 'failed', result: 'failure' });
    for (let i = 0; i < 4; i++) {
      await flush();
    }
    expect(sent).toEqual([
      expect.objectContaining({ source: 'grafana_dashboard_created', properties: { uid: 'early', result: 'success' } }),
      expect.objectContaining({ source: 'grafana_dashboard_created', properties: { uid: 'live', result: 'success' } }),
    ]);
    expect(new Set(sent.map((b) => b.eventId)).size).toBe(2);
  });

  it('asks for /definitions once the flag resolves true, so a fresh browser subscribes', async () => {
    const refresh = jest.fn();
    arm(Promise.resolve(true), undefined, refresh);
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps queued source events when learning progress is reset, and withdraws the guide events', async () => {
    const echo = installWithCachedSource();
    arm(Promise.resolve(true), { kind: 'route-missing' });
    onCompletionRecorded(() => true);
    await flush();
    recordGuideCompletion(guideFact({ guideId: 'reset-me' }));
    echo.report('grafana_dashboard_created', { uid: 'keep-me', result: 'success' });
    await flush();
    await flush();
    discardQueuedAchievementEvents();
    const persisted = createQueueStorage<AchievementEventBody>('test-events:', 'user-1:org-1', 'other-tab').list();
    expect(guideIds(persisted.map((item) => item.body))).toEqual(['grafana_dashboard_created']);
  });

  it('discards held events, unsubscribes and forgets the cached list when the flag resolves false', async () => {
    const echo = installWithCachedSource();
    echo.report('grafana_dashboard_created', { uid: 'early', result: 'success' });
    const refresh = jest.fn();
    const { sent } = arm(Promise.resolve(false), undefined, refresh);
    await flush();
    await flush();
    echo.report('grafana_dashboard_created', { uid: 'late', result: 'success' });
    await flush();
    expect(sent).toEqual([]);
    expect(subscribedEchoNames()).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    applyEchoSources([DASHBOARD_SOURCE]);
    expect(subscribedEchoNames()).toEqual([]);
  });
});
