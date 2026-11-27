import type { CompletionWriteBody, WriteOutcome } from './completion-write-client';
import { attemptWriteId, createWriteQueue } from './completion-write-queue';
import { createCompletionWriteStorage, LEASE_TTL_MS } from './completion-write-storage';

function heldResponse() {
  let finish!: (outcome: WriteOutcome) => void;
  const response = new Promise<WriteOutcome>((resolve) => {
    finish = resolve;
  });
  return { send: jest.fn(() => response), finish };
}

function completionBody(completionPercent: number, attemptId?: string): CompletionWriteBody {
  return {
    guideSource: 'bundled',
    guideId: 'guide',
    guideTitle: 'Guide',
    guideCategory: 'interactive',
    completionPercent,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    platform: 'cloud',
    ...(attemptId === undefined ? {} : { attemptId }),
  };
}

it('keeps the takeover key and discards a late retry in the tab that reset', async () => {
  const event: CompletionWriteBody = {
    guideSource: 'bundled',
    guideId: 'guide',
    guideTitle: 'Guide',
    guideCategory: 'interactive',
    completionPercent: 100,
    source: 'objectives',
    completedAt: '2026-07-20T00:00:00.000Z',
    platform: 'cloud',
  };
  let clock = Date.parse(event.completedAt);
  const now = () => clock;
  const original = createCompletionWriteStorage('pilot-owner', 'original');
  const successor = createCompletionWriteStorage('pilot-owner', 'successor');
  const firstResponse = heldResponse();
  const secondResponse = heldResponse();
  const first = createWriteQueue({ now, storage: original, send: firstResponse.send });
  const second = createWriteQueue({ now, storage: successor, send: secondResponse.send });

  first.enqueue(event, { id: 'original-key' });
  const firstPass = first.processDue();
  expect(firstResponse.send).toHaveBeenCalledWith(event, 'original-key');
  await second.processDue();
  expect(secondResponse.send).not.toHaveBeenCalled();

  clock += LEASE_TTL_MS + 1;
  const secondPass = second.processDue();
  expect(secondResponse.send).toHaveBeenCalledWith(event, 'original-key');
  second.clear();
  secondResponse.finish({ kind: 'transient' });
  await secondPass;
  expect(original.list()).toEqual([]);

  firstResponse.finish({ kind: 'created' });
  await firstPass;
  expect(original.list()).toEqual([]);
});

it('keeps a new completion and its retry key after the original tab resets', async () => {
  const oldEvent = completionBody(100);
  const newEvent = { ...oldEvent, completedAt: '2026-07-20T00:00:01.000Z' };
  let clock = Date.parse(newEvent.completedAt);
  const originalStorage = createCompletionWriteStorage('reset-recomplete', 'original');
  const newStorage = createCompletionWriteStorage('reset-recomplete', 'new');
  const oldResponse = heldResponse();
  const newSend = jest
    .fn<Promise<WriteOutcome>, [CompletionWriteBody, string]>()
    .mockResolvedValueOnce({ kind: 'transient' })
    .mockResolvedValue({ kind: 'created' });
  const original = createWriteQueue({ now: () => clock, storage: originalStorage, send: oldResponse.send });
  const successor = createWriteQueue({ now: () => clock, storage: newStorage, send: newSend, random: () => 0.5 });

  expect(original.enqueue(oldEvent, { id: 'old-key' })).toBe(true);
  const oldPass = original.processDue();
  expect(oldResponse.send).toHaveBeenCalledWith(oldEvent, 'old-key');
  original.clear();
  expect(successor.enqueue(newEvent, { id: 'new-key' })).toBe(true);
  oldResponse.finish({ kind: 'transient' });
  await oldPass;
  expect(newStorage.list().map((item) => item.id)).toEqual(['new-key']);

  await successor.processDue();
  clock += 1000;
  await successor.processDue();
  expect(newSend).toHaveBeenNthCalledWith(1, newEvent, 'new-key');
  expect(newSend).toHaveBeenNthCalledWith(2, newEvent, 'new-key');
  expect(newStorage.list()).toEqual([]);
});

it.each([
  ['created', ['new-key']],
  ['transient', ['new-key', 'old-key']],
] as const)('keeps the new completion after a peer reset and an old %s response', async (kind, expectedKeys) => {
  const oldEvent = completionBody(100);
  const newEvent = { ...oldEvent, completedAt: '2026-07-20T00:00:01.000Z' };
  const now = () => Date.parse(newEvent.completedAt);
  const originalStorage = createCompletionWriteStorage(`peer-reset-recomplete-${kind}`, 'original');
  const successorStorage = createCompletionWriteStorage(`peer-reset-recomplete-${kind}`, 'successor');
  const oldResponse = heldResponse();
  const original = createWriteQueue({ now, storage: originalStorage, send: oldResponse.send });
  const successor = createWriteQueue({ now, storage: successorStorage, send: jest.fn() });

  original.enqueue(oldEvent, { id: 'old-key' });
  const oldPass = original.processDue();
  expect(oldResponse.send).toHaveBeenCalledWith(oldEvent, 'old-key');
  successor.clear();
  successor.enqueue(newEvent, { id: 'new-key' });
  oldResponse.finish({ kind });
  await oldPass;

  expect(
    successorStorage
      .list()
      .map((item) => item.id)
      .sort()
  ).toEqual(expectedKeys);
});

it.each(['created', 'transient'] as const)('keeps queued 100%% after a late 50%% %s', async (kind) => {
  const attemptId = 'a'.repeat(32);
  const partial = completionBody(50, attemptId);
  const complete = { ...partial, completionPercent: 100 };
  const now = () => Date.parse(partial.completedAt);
  const firstStorage = createCompletionWriteStorage(`partial-${kind}`, 'first');
  const secondStorage = createCompletionWriteStorage(`partial-${kind}`, 'second');
  const firstResponse = heldResponse();
  const first = createWriteQueue({ now, storage: firstStorage, send: firstResponse.send, partialDebounceMs: 0 });
  const second = createWriteQueue({ now, storage: secondStorage, send: jest.fn() });

  expect(first.enqueue(partial, { id: attemptWriteId(attemptId, 50) })).toBe(true);
  const firstPass = first.processDue();
  expect(firstResponse.send).toHaveBeenCalledWith(partial, attemptWriteId(attemptId, 50));
  expect(second.enqueue(partial, { id: attemptWriteId(attemptId, 50) })).toBe(true);
  expect(secondStorage.list().map((item) => item.id)).toEqual([attemptWriteId(attemptId, 50)]);
  expect(second.enqueue(complete, { id: attemptWriteId(attemptId, 100) })).toBe(true);
  firstResponse.finish({ kind });
  await firstPass;

  expect(secondStorage.list().map((item) => item.id)).toContain(attemptWriteId(attemptId, 100));
});

it('reports a failed replacement as non-durable and reloads the previous record', () => {
  const attemptId = 'a'.repeat(32);
  const partial = completionBody(50, attemptId);
  const complete = { ...partial, completionPercent: 100 };
  const storage = createCompletionWriteStorage('failed-replacement', 'before-reload');
  const queue = createWriteQueue({ now: () => Date.parse(partial.completedAt), storage, send: jest.fn() });
  expect(queue.enqueue(partial, { id: attemptWriteId(attemptId, 50) })).toBe(true);

  const setItem = Storage.prototype.setItem;
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.endsWith(attemptWriteId(attemptId, 100))) {
      throw new Error('storage write failed');
    }
    return setItem.call(this, key, value);
  });
  try {
    expect(queue.enqueue(complete, { id: attemptWriteId(attemptId, 100) })).toBe(false);
  } finally {
    spy.mockRestore();
  }

  expect(queue.snapshot().map((item) => item.id)).toEqual([attemptWriteId(attemptId, 50)]);
  expect(
    storage
      .list()
      .map((item) => item.id)
      .sort()
  ).toEqual([attemptWriteId(attemptId, 100), attemptWriteId(attemptId, 50)]);

  const reloaded = createCompletionWriteStorage('failed-replacement', 'after-reload');
  expect(reloaded.list().map((item) => item.id)).toEqual([attemptWriteId(attemptId, 50)]);
});

it('exposes a volatile replacement as accepted after refresh and duplicate enqueue', async () => {
  const attemptId = 'b'.repeat(32);
  const partial = completionBody(50, attemptId);
  const complete = completionBody(100, attemptId);
  const storage = createCompletionWriteStorage('failed-replacement-duplicate', 'before-reload');
  const response = heldResponse();
  const queue = createWriteQueue({ now: () => Date.parse(partial.completedAt), storage, send: response.send });
  const halfId = attemptWriteId(attemptId, 50);
  const fullId = attemptWriteId(attemptId, 100);
  expect(queue.enqueue(partial, { id: halfId })).toBe(true);

  const setItem = Storage.prototype.setItem;
  const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key.endsWith(fullId)) {
      throw new Error('storage write failed');
    }
    return setItem.call(this, key, value);
  });
  try {
    expect(queue.enqueue(complete, { id: fullId })).toBe(false);
  } finally {
    spy.mockRestore();
  }

  const pass = queue.processDue();
  expect(response.send).toHaveBeenCalledWith(complete, fullId);
  expect(queue.enqueue(complete, { id: fullId })).toBe(true);
  const reloaded = createCompletionWriteStorage('failed-replacement-duplicate', 'after-reload');
  expect(reloaded.list().map((item) => item.id)).toEqual([halfId]);

  response.finish({ kind: 'created' });
  await pass;
});
