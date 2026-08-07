import { config } from '@grafana/runtime';

import { collectKeysByPrefix, clearKeysByPrefix } from '../lib/storage/key-utils';
import { StorageKeys } from '../lib/storage-keys';

import type { CompletionWriteBody } from './completion-write-client';
import { LEASE_TTL_MS } from './completion-write-timing';

export { LEASE_TTL_MS } from './completion-write-timing';

export interface QueuedWrite {
  id: string;
  body: CompletionWriteBody;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
}

export interface LeaseResult {
  acquired: boolean;
  retryAfterMs: number;
}

export interface CompletionWriteStorage {
  list(): QueuedWrite[];
  put(item: QueuedWrite): void;
  remove(id: string): void;
  clear(): void;
  acquireLease(now: number): LeaseResult;
  renewLease(now: number): boolean;
  releaseLease(): void;
  subscribe(listener: () => void): () => void;
}

interface StoredLease {
  tabId: string;
  expiresAt: number;
}

export function currentCompletionQueueOwnerKey(): string | null {
  const userId = config.bootData?.user?.id;
  const orgId = config.bootData?.user?.orgId;
  if (!Number.isInteger(userId) || Number(userId) <= 0 || !Number.isInteger(orgId) || Number(orgId) <= 0) {
    return null;
  }
  return `user-${userId}:org-${orgId}`;
}

export function createCompletionWriteStorage(ownerKey: string, tabId = randomId()): CompletionWriteStorage {
  const ownerPrefix = `${StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX}${ownerKey}:`;
  const itemPrefix = `${ownerPrefix}item:`;
  const leaseKey = `${ownerPrefix}lease`;
  const volatileItems = new Map<string, QueuedWrite>();

  function list(): QueuedWrite[] {
    // Load the persisted copies first, then overlay volatile entries so a newer
    // in-memory item (e.g. one whose backoff `put` failed and fell back to
    // volatile) wins over its stale persisted twin — never the reverse. Seeding
    // from volatile and letting localStorage overwrite would revert a fresher
    // retry state (attempts/nextAttemptAt) to the old persisted one.
    const result = new Map<string, QueuedWrite>();
    try {
      for (const key of collectKeysByPrefix(localStorage, itemPrefix)) {
        const item = parseQueuedWrite(localStorage.getItem(key));
        if (!item) {
          continue;
        }
        // The record is addressed by its storage key, but sends and removals use
        // the body id. A mismatch (corruption / partial write) would make the
        // entry immortal — sent under the body id while removals target the key.
        // Quarantine it: delete under its ACTUAL key and skip.
        const expectedId = key.slice(itemPrefix.length);
        if (item.id !== expectedId) {
          try {
            localStorage.removeItem(key);
          } catch {
            // Best-effort quarantine; skip regardless.
          }
          continue;
        }
        result.set(item.id, item);
      }
    } catch {
      // Fall through — the volatile overlay below is still applied.
    }
    for (const [id, item] of volatileItems) {
      result.set(id, item);
    }
    return Array.from(result.values());
  }

  function put(item: QueuedWrite): void {
    try {
      localStorage.setItem(`${itemPrefix}${item.id}`, JSON.stringify(item));
      volatileItems.delete(item.id);
    } catch {
      volatileItems.set(item.id, { ...item });
    }
  }

  function remove(id: string): void {
    volatileItems.delete(id);
    try {
      localStorage.removeItem(`${itemPrefix}${id}`);
    } catch {
      return;
    }
  }

  function clear(): void {
    volatileItems.clear();
    try {
      clearKeysByPrefix(localStorage, ownerPrefix);
    } catch {
      return;
    }
  }

  function acquireLease(now: number): LeaseResult {
    try {
      const existing = parseLease(localStorage.getItem(leaseKey));
      if (existing && existing.tabId !== tabId && existing.expiresAt > now) {
        return { acquired: false, retryAfterMs: existing.expiresAt - now };
      }
      const candidate: StoredLease = { tabId, expiresAt: now + LEASE_TTL_MS };
      localStorage.setItem(leaseKey, JSON.stringify(candidate));
      const stored = parseLease(localStorage.getItem(leaseKey));
      return {
        acquired: stored?.tabId === tabId,
        retryAfterMs: stored?.tabId === tabId ? 0 : Math.max(100, (stored?.expiresAt ?? now + 100) - now),
      };
    } catch {
      return { acquired: true, retryAfterMs: 0 };
    }
  }

  function renewLease(now: number): boolean {
    try {
      const existing = parseLease(localStorage.getItem(leaseKey));
      if (existing && existing.tabId !== tabId) {
        return false;
      }
      const candidate: StoredLease = { tabId, expiresAt: now + LEASE_TTL_MS };
      localStorage.setItem(leaseKey, JSON.stringify(candidate));
      return parseLease(localStorage.getItem(leaseKey))?.tabId === tabId;
    } catch {
      return true;
    }
  }

  function releaseLease(): void {
    try {
      if (parseLease(localStorage.getItem(leaseKey))?.tabId === tabId) {
        localStorage.removeItem(leaseKey);
      }
    } catch {
      return;
    }
  }

  function subscribe(listener: () => void): () => void {
    if (typeof window === 'undefined') {
      return () => undefined;
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key?.startsWith(itemPrefix)) {
        listener();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  return { list, put, remove, clear, acquireLease, renewLease, releaseLease, subscribe };
}

export function createCompletionEventId(): string {
  return randomId();
}

function randomId(): string {
  try {
    const values = new Uint32Array(4);
    globalThis.crypto.getRandomValues(values);
    return Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('');
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function parseQueuedWrite(raw: string | null): QueuedWrite | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.id !== 'string' ||
      typeof value.body !== 'object' ||
      value.body === null ||
      typeof value.attempts !== 'number' ||
      typeof value.createdAt !== 'number' ||
      typeof value.nextAttemptAt !== 'number'
    ) {
      return null;
    }
    return value as unknown as QueuedWrite;
  } catch {
    return null;
  }
}

function parseLease(raw: string | null): StoredLease | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (typeof value.tabId !== 'string' || typeof value.expiresAt !== 'number') {
      return null;
    }
    return value as unknown as StoredLease;
  } catch {
    return null;
  }
}
