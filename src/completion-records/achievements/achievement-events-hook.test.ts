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
  __resetAchievementEventsForTests,
} from './achievement-events-hook';
import type { AchievementEventBody, EventOutcome } from './achievements-client';

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

function arm(enabled: Promise<boolean>, outcome?: EventOutcome) {
  const sent: AchievementEventBody[] = [];
  const evaluated = jest.fn();
  let id = 0;
  armAchievementEvents({
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
    expect(sent.map((b) => b.context.guideId)).toEqual(['intro']);
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
      expect(sent.map((b) => b.context.guideId)).toEqual(['first']);
      const persisted = createQueueStorage<AchievementEventBody>('test-events:', 'user-1:org-1', 'other-tab').list();
      expect(persisted.map((i) => i.body.context.guideId).sort()).toEqual(['first', 'second']);

      __resetAchievementEventsForTests();
      const later = arm(Promise.resolve(true));
      await flush();
      await flush();
      expect(later.sent.map((b) => b.context.guideId).sort()).toEqual(['first', 'second']);
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
