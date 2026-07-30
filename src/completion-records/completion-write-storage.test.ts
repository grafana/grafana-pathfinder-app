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

import {
  createCompletionWriteStorage,
  currentCompletionQueueOwnerKey,
  type QueuedWrite,
} from './completion-write-storage';

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

  it('overlays a failed-persist update over its stale persisted twin', () => {
    const store = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const original = item('evt'); // attempts: 0, persisted successfully
    store.put(original);
    expect(store.list()).toEqual([original]);

    // Advance retry state, but the persisting setItem fails → volatile fallback.
    const updated: QueuedWrite = { ...original, attempts: 1, nextAttemptAt: 5000 };
    jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    store.put(updated);

    // list() must return the NEWER volatile copy, never revert to the old
    // persisted one (which would reset backoff to attempts: 0).
    expect(store.list()).toEqual([updated]);
  });

  it('allows one owner-scoped lease holder and recovers after expiry', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');

    expect(tabA.acquireLease(0).acquired).toBe(true);
    expect(tabB.acquireLease(1)).toEqual({ acquired: false, retryAfterMs: 29_999 });
    expect(tabB.acquireLease(30_001).acquired).toBe(true);
  });

  it('renews the holder lease and extends its expiry', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');

    expect(tabA.acquireLease(0).acquired).toBe(true);
    expect(tabA.renewLease(25_000)).toBe(true);
    expect(tabB.acquireLease(35_000)).toEqual({ acquired: false, retryAfterMs: 20_000 });
  });

  it('refuses to renew a lease another tab has taken over', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');

    tabA.acquireLease(0);
    expect(tabB.acquireLease(30_001).acquired).toBe(true);
    expect(tabA.renewLease(30_002)).toBe(false);
  });

  it('does not let an old holder release a newer lease', () => {
    const tabA = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    const tabB = createCompletionWriteStorage('user-7:org-3', 'tab-b');

    tabA.acquireLease(0);
    tabB.acquireLease(30_001);
    tabA.releaseLease();

    expect(tabA.acquireLease(30_002).acquired).toBe(false);
  });

  it('fails open (acquires) when localStorage throws during lease acquisition', () => {
    const store = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    jest.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage blocked');
    });
    expect(store.acquireLease(0)).toEqual({ acquired: true, retryAfterMs: 0 });
  });
});

describe('completion write corruption recovery (CF-02)', () => {
  function itemKeyFor(id: string): string {
    const key = Object.keys(localStorage).find((k) => k.endsWith(`:item:${id}`));
    if (!key) {
      throw new Error(`no storage key for item ${id}`);
    }
    return key;
  }

  it('quarantines an entry whose stored key suffix disagrees with its body id', () => {
    const store = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    store.put(item('A'));
    const keyA = itemKeyFor('A');

    // Corrupt: the value stored under key ...item:A now carries body id 'B'.
    localStorage.setItem(keyA, JSON.stringify({ ...item('B') }));

    // list() must reject the mismatched entry (it would otherwise be immortal:
    // sent under id 'B' but removed under key 'A') and delete it under its key.
    expect(store.list()).toEqual([]);
    expect(localStorage.getItem(keyA)).toBeNull();
  });
});

describe('completion write cross-tab subscribe (storage-event filtering)', () => {
  it('fires only for this owner’s item keys and stops after unsubscribe', () => {
    const store = createCompletionWriteStorage('user-7:org-3', 'tab-a');
    store.put(item('a'));
    const itemKey = Object.keys(localStorage).find((k) => k.endsWith(':item:a'))!;
    const leaseKey = itemKey.replace(/item:a$/, 'lease');

    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    window.dispatchEvent(new StorageEvent('storage', { key: itemKey }));
    expect(listener).toHaveBeenCalledTimes(1);

    // Lease key, an unrelated key, and a null key must NOT trigger a drain.
    window.dispatchEvent(new StorageEvent('storage', { key: leaseKey }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new StorageEvent('storage', { key: itemKey }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
