import { config } from '@grafana/runtime';

import { StorageKeys } from '../lib/storage-keys';

import type { QueuedWrite } from './completion-write-queue';

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
  releaseLease(): void;
  subscribe(listener: () => void): () => void;
}

interface StoredLease {
  tabId: string;
  expiresAt: number;
}

const LEASE_TTL_MS = 30_000;

export function currentCompletionQueueOwnerKey(): string | null {
  const userId = config.bootData.user?.id;
  const orgId = config.bootData.user?.orgId;
  if (!Number.isInteger(userId) || Number(userId) <= 0 || !Number.isInteger(orgId) || Number(orgId) <= 0) {
    return null;
  }
  return `user-${userId}:org-${orgId}`;
}

export function createCompletionWriteStorage(ownerKey: string, tabId = randomId()): CompletionWriteStorage {
  const ownerPrefix = `${StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX}${ownerKey}:`;
  const itemPrefix = `${ownerPrefix}item:`;
  const leaseKey = `${ownerPrefix}lease`;

  function list(): QueuedWrite[] {
    try {
      const result: QueuedWrite[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(itemPrefix)) {
          continue;
        }
        const item = parseQueuedWrite(localStorage.getItem(key));
        if (item) {
          result.push(item);
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  function put(item: QueuedWrite): void {
    try {
      localStorage.setItem(`${itemPrefix}${item.id}`, JSON.stringify(item));
    } catch {
      // Storage failure must not reach the completion path.
    }
  }

  function remove(id: string): void {
    try {
      localStorage.removeItem(`${itemPrefix}${id}`);
    } catch {
      // Storage failure must not reach the completion path.
    }
  }

  function clear(): void {
    try {
      const keys: string[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith(ownerPrefix)) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Storage failure must not reach the completion path.
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

  function releaseLease(): void {
    try {
      if (parseLease(localStorage.getItem(leaseKey))?.tabId === tabId) {
        localStorage.removeItem(leaseKey);
      }
    } catch {
      // A stale lease expires and is recoverable by another tab.
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

  return { list, put, remove, clear, acquireLease, releaseLease, subscribe };
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
