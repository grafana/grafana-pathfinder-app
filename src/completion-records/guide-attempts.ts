// Attempts are device-local and owner-scoped; never synchronize them through user storage.
// Legacy unscoped entries have unknown ownership and must never be adopted.

import { logger } from '../lib/logging';
import { collectKeysByPrefix } from '../lib/storage/key-utils';
import { StorageKeys, buildVersionedContentStorageKey } from '../lib/storage-keys';
import { getFeatureFlagValue } from '../utils/openfeature';

import { bundledGuideIdReadVariants, normalizeGuideId } from './completion-identity';
import { createCompletionEventId, currentCompletionQueueOwnerKey } from './completion-write-storage';
import { progressRecordsCapability } from './progress-records-capability';
import type { AttemptMode, CompletionKey } from './types';

export type { AttemptMode } from './types';

export type AttemptKey = CompletionKey;

export interface GuideAttempt {
  v: 1;
  /** 32 lowercase hex characters. */
  attemptId: string;
  /** ms since epoch. */
  startedAt: number;
  closed: boolean;
  /** Highest percentage observed within this attempt, 0..100. */
  highWater: number;
  mode: AttemptMode;
}

export interface AttemptDeps {
  now: () => number;
  nextId: () => string;
}

const defaultDeps: AttemptDeps = {
  now: () => Date.now(),
  nextId: createCompletionEventId,
};

const ATTEMPT_ID_RE = /^[0-9a-f]{32}$/;
let coordinationFailed = false;
const resetListeners = new Set<(key: AttemptKey | null) => void>();

export function onAttemptReset(listener: (key: AttemptKey | null) => void): () => void {
  const owner = currentCompletionQueueOwnerKey();
  const scopedListener = (key: AttemptKey | null) => {
    if (owner && owner === currentCompletionQueueOwnerKey()) {
      listener(key);
    }
  };
  resetListeners.add(scopedListener);
  return () => {
    resetListeners.delete(scopedListener);
  };
}

/** All production mint/reset operations share an origin-wide Web Lock. Callbacks stay synchronous. */
export function withAttemptLock(callback: () => void): void {
  const owner = currentCompletionQueueOwnerKey();
  const work = () => {
    if (owner === currentCompletionQueueOwnerKey()) {
      callback();
    }
  };
  if (coordinationFailed || typeof navigator === 'undefined' || !navigator.locks?.request) {
    work();
    return;
  }
  let started = false;
  const failed = (error: unknown) => {
    logger.warn('guide attempt: coordination failed', { error: String(error) });
    if (!started) {
      coordinationFailed = true;
      work();
    }
  };
  try {
    void navigator.locks
      .request('pathfinder-guide-attempts', () => {
        started = true;
        work();
      })
      .catch(failed);
  } catch (error) {
    failed(error);
  }
}

// Failed writes shadow stale storage without changing an existing attempt's identity.
const memory = new Map<string, GuideAttempt>();

function ownerPrefix(): string | null {
  const owner = currentCompletionQueueOwnerKey();
  return owner ? `${StorageKeys.GUIDE_ATTEMPT_PREFIX}owner:${owner}:` : null;
}

function storageKeyFor(guideSource: string, guideId: string): string | null {
  const prefix = ownerPrefix();
  return prefix ? buildVersionedContentStorageKey(prefix, `${guideSource}:${guideId}`) : null;
}

function canonicalKey(key: AttemptKey): string | null {
  return storageKeyFor(key.guideSource, normalizeGuideId(key.guideId));
}

function parseAttempt(raw: string | null): GuideAttempt | null {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value === null ||
      typeof value !== 'object' ||
      value.v !== 1 ||
      typeof value.attemptId !== 'string' ||
      !ATTEMPT_ID_RE.test(value.attemptId) ||
      typeof value.startedAt !== 'number' ||
      !Number.isFinite(value.startedAt) ||
      typeof value.closed !== 'boolean' ||
      typeof value.highWater !== 'number' ||
      !Number.isFinite(value.highWater) ||
      value.highWater < 0 ||
      value.highWater > 100 ||
      (value.mode !== 'records' && value.mode !== 'analytics')
    ) {
      return null;
    }
    return {
      v: 1,
      attemptId: value.attemptId,
      startedAt: value.startedAt,
      closed: value.closed,
      highWater: value.highWater,
      mode: value.mode,
    };
  } catch {
    return null;
  }
}

function readAt(storageKey: string | null): GuideAttempt | null {
  if (!storageKey) {
    return null;
  }
  const shadow = memory.get(storageKey);
  if (shadow) {
    return shadow;
  }
  try {
    return parseAttempt(localStorage.getItem(storageKey));
  } catch {
    return null;
  }
}

/** False means the attempt is not durable (unowned or memory-only). */
function writeAt(storageKey: string | null, attempt: GuideAttempt): boolean {
  if (!storageKey) {
    return false;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(attempt));
    memory.delete(storageKey);
    return true;
  } catch {
    memory.set(storageKey, attempt);
    return false;
  }
}

/** The stored attempt for a guide, or `null` when none exists or the stored value is corrupt. */
export function readAttempt(key: AttemptKey): GuideAttempt | null {
  return readAt(canonicalKey(key));
}

/** Callers must hold withAttemptLock; closed attempts remain until reset. */
export function getOrMintAttempt(
  key: AttemptKey,
  resolveMode: () => AttemptMode,
  deps: Partial<AttemptDeps> = {}
): { attempt: GuideAttempt; minted: boolean } {
  const storageKey = canonicalKey(key);
  const existing = readAt(storageKey);
  if (existing) {
    return { attempt: existing, minted: false };
  }
  const { now, nextId } = { ...defaultDeps, ...deps };
  const candidate: GuideAttempt = {
    v: 1,
    attemptId: nextId(),
    startedAt: now(),
    closed: false,
    highWater: 0,
    mode: resolveMode(),
  };
  if (!writeAt(storageKey, candidate)) {
    const fallback: GuideAttempt = { ...candidate, mode: 'analytics' };
    if (storageKey) {
      memory.set(storageKey, fallback);
    }
    return { attempt: fallback, minted: true };
  }
  const stored = readAt(storageKey);
  if (!stored) {
    return { attempt: candidate, minted: true };
  }
  return { attempt: stored, minted: stored.attemptId === candidate.attemptId };
}

/** Raise the attempt's high-water mark. `raised` is `true` only on a strict increase. */
export function raiseHighWater(key: AttemptKey, percent: number): { raised: boolean; previous: number } {
  const storageKey = canonicalKey(key);
  const attempt = readAt(storageKey);
  if (!attempt) {
    return { raised: false, previous: 0 };
  }
  const previous = attempt.highWater;
  const next = Math.min(100, Math.max(0, percent));
  if (!Number.isFinite(next) || next <= previous) {
    return { raised: false, previous };
  }
  writeAt(storageKey, { ...attempt, highWater: next });
  return { raised: true, previous };
}

function setClosed(key: AttemptKey, attemptId: string, closed: boolean): void {
  const storageKey = canonicalKey(key);
  const attempt = readAt(storageKey);
  if (!attempt || attempt.attemptId !== attemptId || attempt.closed === closed) {
    return;
  }
  writeAt(storageKey, { ...attempt, closed });
}

/** Close the attempt, but only if it is still the one named `attemptId`. */
export function closeAttempt(key: AttemptKey, attemptId: string): void {
  setClosed(key, attemptId, true);
}

/** Reopen the attempt, but only if it is still the one named `attemptId`. */
export function reopenAttempt(key: AttemptKey, attemptId: string): void {
  setClosed(key, attemptId, false);
}

/** Forget the guide's attempt under every spelling of its id, so the next progress mints a new one. */
export function clearAttempt(key: AttemptKey): void {
  for (const listener of resetListeners) {
    listener({ ...key, guideId: normalizeGuideId(key.guideId) });
  }
  for (const guideId of bundledGuideIdReadVariants(key.guideId)) {
    const storageKey = storageKeyFor(key.guideSource, guideId);
    if (!storageKey) {
      continue;
    }
    memory.delete(storageKey);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Storage unavailable: the memory half above is all there is to clear.
    }
  }
}

/** Forget the current owner's attempts only. Backs "Reset all learning progress". */
export function clearAllAttempts(): void {
  const prefix = ownerPrefix();
  if (!prefix) {
    return;
  }
  for (const listener of resetListeners) {
    listener(null);
  }
  for (const storageKey of memory.keys()) {
    if (storageKey.startsWith(prefix)) {
      memory.delete(storageKey);
    }
  }
  try {
    for (const storageKey of collectKeysByPrefix(localStorage, prefix)) {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage unavailable: nothing persisted to clear.
  }
}

const PROGRESS_RECORDS_FLAG = 'pathfinder.progress-records';

/** Mode is fixed at mint time; unknown capability must preserve the legacy completion path. */
export function resolveAttemptMode(): AttemptMode {
  if (
    !currentCompletionQueueOwnerKey() ||
    coordinationFailed ||
    typeof navigator === 'undefined' ||
    !navigator.locks?.request ||
    progressRecordsCapability() !== 'yes'
  ) {
    return 'analytics';
  }
  return getFeatureFlagValue(PROGRESS_RECORDS_FLAG, false) ? 'records' : 'analytics';
}

export function __resetAttemptsForTests(): void {
  coordinationFailed = false;
  memory.clear();
}
