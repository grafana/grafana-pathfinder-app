import { createQueueStorage } from '../completion-write-storage';
import { MAX_RETENTION_MS } from '../completion-write-timing';

import { createEventQueue, MAX_QUEUED_EVENTS } from './achievement-event-queue';
import type { AchievementEventBody, EventOutcome } from './achievements-client';

const NOW = Date.parse('2026-11-01T00:00:00.000Z');

function event(eventId: string, occurredAt = new Date(NOW).toISOString()): AchievementEventBody {
  return {
    schemaVersion: 1,
    eventId,
    entity: 'guides',
    action: 'completed',
    occurredAt,
    context: { guideSource: 'bundled', guideId: eventId, guideCategory: 'interactive' },
  };
}

const evaluated = (retry: boolean): EventOutcome => ({
  kind: 'evaluated',
  response: { eventId: 'e', retry, decisions: [] },
});

function setup(outcomes: EventOutcome[]) {
  let now = NOW;
  const sent: AchievementEventBody[] = [];
  const onEvaluated = jest.fn();
  let i = 0;
  const storage = createQueueStorage<AchievementEventBody>('test-achievement-queue:', 'user-1:org-1', 'tab-a');
  const queue = createEventQueue({
    now: () => now,
    random: () => 0.5,
    storage,
    onEvaluated,
    send: async (body) => {
      sent.push(body);
      return outcomes[Math.min(i++, outcomes.length - 1)]!;
    },
  });
  return { queue, sent, onEvaluated, storage, advance: (ms: number) => (now += ms) };
}

beforeEach(() => localStorage.clear());

describe('achievement event queue', () => {
  it('removes an event the route evaluated with retry false and hands the response on', async () => {
    const { queue, sent, onEvaluated } = setup([evaluated(false)]);
    queue.enqueue(event('e1'));
    const result = await queue.processDue();
    expect(sent.map((b) => b.eventId)).toEqual(['e1']);
    expect(onEvaluated).toHaveBeenCalledTimes(1);
    expect(queue.snapshot()).toEqual([]);
    expect(result).toEqual({ nextDelayMs: null, disarmed: false });
  });

  it('requeues an event answered with retry true, resends the same eventId, and still hands the response on', async () => {
    const { queue, sent, onEvaluated, advance } = setup([evaluated(true), evaluated(false)]);
    queue.enqueue(event('e1'));
    const first = await queue.processDue();
    expect(onEvaluated).toHaveBeenCalledTimes(1);
    expect(queue.snapshot()).toHaveLength(1);
    expect(first.nextDelayMs).toBe(1000);
    advance(1000);
    await queue.processDue();
    expect(sent.map((b) => b.eventId)).toEqual(['e1', 'e1']);
    expect(queue.snapshot()).toEqual([]);
  });

  it('keeps and backs off on a transient failure (401, 429, 5xx, 503 definitions-unavailable, network)', async () => {
    const { queue } = setup([{ kind: 'transient' }]);
    queue.enqueue(event('e1'));
    const result = await queue.processDue();
    expect(queue.snapshot()[0]?.attempts).toBe(1);
    expect(result.nextDelayMs).toBe(1000);
  });

  it('drops an event the route rejects with a 400', async () => {
    const { queue, onEvaluated } = setup([{ kind: 'terminal' }]);
    queue.enqueue(event('e1'));
    await queue.processDue();
    expect(queue.snapshot()).toEqual([]);
    expect(onEvaluated).not.toHaveBeenCalled();
  });

  it.each(['route-missing', 'forbidden'] as const)('disarms on %s and keeps the event persisted', async (kind) => {
    const { queue, sent, storage } = setup([{ kind }]);
    queue.enqueue(event('e1'));
    queue.enqueue(event('e2'));
    expect(await queue.processDue()).toEqual({ nextDelayMs: null, disarmed: true });
    expect(await queue.processDue()).toEqual({ nextDelayMs: null, disarmed: true });
    expect(sent).toHaveLength(1);
    expect(storage.list().map((i) => i.id)).toEqual(expect.arrayContaining(['e1', 'e2']));
  });

  it('drops events past the 30-day retention without sending them', async () => {
    const { queue, sent } = setup([evaluated(false)]);
    queue.enqueue(event('old', new Date(NOW - MAX_RETENTION_MS - 1).toISOString()));
    await queue.processDue();
    expect(sent).toEqual([]);
    expect(queue.snapshot()).toEqual([]);
  });

  it('drops the oldest event over the cap', () => {
    const { queue } = setup([evaluated(false)]);
    for (let i = 0; i <= MAX_QUEUED_EVENTS; i++) {
      queue.enqueue(event(`e${i}`));
    }
    const ids = queue.snapshot().map((i) => i.id);
    expect(ids).toHaveLength(MAX_QUEUED_EVENTS);
    expect(ids).not.toContain('e0');
  });

  it('sends at most ten events per leased pass', async () => {
    const { queue, sent } = setup([evaluated(false)]);
    for (let i = 0; i < 12; i++) {
      queue.enqueue(event(`e${i}`));
    }
    expect((await queue.processDue()).nextDelayMs).toBe(0);
    expect(sent).toHaveLength(10);
  });

  it('drains what an earlier load persisted', async () => {
    const first = setup([evaluated(false)]);
    first.queue.enqueue(event('persisted'));
    const second = setup([evaluated(false)]);
    await second.queue.processDue();
    expect(second.sent.map((b) => b.eventId)).toEqual(['persisted']);
  });
});
