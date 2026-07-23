const user = { id: 7, orgId: 3 };

jest.mock('@grafana/runtime', () => ({
  config: {
    bootData: {
      get user() {
        return user;
      },
    },
  },
}));

import { createCompletionWriteStorage, currentCompletionQueueOwnerKey } from './completion-write-storage';
import type { QueuedWrite } from './completion-write-queue';

function item(id: string): QueuedWrite {
  return {
    id,
    body: {
      guideSource: 'bundled',
      guideId: id,
      guideTitle: id,
      guideCategory: 'interactive',
      completionPercent: 100,
      source: 'objectives',
      completedAt: '2026-07-20T00:00:00.000Z',
      platform: 'cloud',
    },
    attempts: 0,
    createdAt: 1,
    nextAttemptAt: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  user.id = 7;
  user.orgId = 3;
});

describe('completion write owner', () => {
  it('partitions by the current user and org', () => {
    expect(currentCompletionQueueOwnerKey()).toBe('user-7:org-3');
    user.id = 0;
    expect(currentCompletionQueueOwnerKey()).toBeNull();
  });

  it('does not expose one owner queue to another owner', () => {
    const userA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const userB = createCompletionWriteStorage('user-8:org-3', 'tab-b');
    userA.put(item('a'));

    expect(userA.list().map((entry) => entry.id)).toEqual(['a']);
    expect(userB.list()).toEqual([]);
  });
});

describe('completion write cross-tab storage', () => {
  it('keeps independently written events instead of replacing a shared snapshot', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');
    tabA.put(item('a'));
    tabB.put(item('b'));

    expect(
      tabA
        .list()
        .map((entry) => entry.id)
        .sort()
    ).toEqual(['a', 'b']);
  });

  it('retains an in-memory retry when localStorage rejects a write', () => {
    const store = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const write = item('volatile');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    store.put(write);

    expect(store.list()).toEqual([write]);
  });

  it('allows one owner-scoped lease holder and recovers after expiry', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');

    expect(tabA.acquireLease(0).acquired).toBe(true);
    expect(tabB.acquireLease(1)).toEqual({ acquired: false, retryAfterMs: 29_999 });
    expect(tabB.acquireLease(30_001).acquired).toBe(true);
  });

  it('does not let an old holder release a newer lease', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');

    tabA.acquireLease(0);
    tabB.acquireLease(30_001);
    tabA.releaseLease();

    expect(tabA.acquireLease(30_002).acquired).toBe(false);
  });
});
