/**
 * Device-local guide attempt lifecycle.
 *
 * An attempt is one pass through a guide, from the first real progress to the
 * terminal completion. It is keyed by guide identity `(guideSource, guideId)` —
 * the same pair the recorder guard, the reset path and the durable record use —
 * never by content key. Raw localStorage only: an attempt is per device by
 * design, so it must never route through the user-storage sync layer.
 */

import { collectKeysByPrefix } from '../lib/storage/key-utils';
import { StorageKeys, buildVersionedContentStorageKey } from '../lib/storage-keys';

import { bundledGuideIdReadVariants, normalizeGuideId } from './completion-identity';
import { createCompletionEventId } from './completion-write-storage';
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

// Fallback for a profile whose localStorage throws (private mode, quota). An
// attempt held here dies with the page, so it must never be named on the wire.
// An entry is a failed write and shadows the stale stored value until a write succeeds or a clear.
const memory = new Map<string, GuideAttempt>();

function storageKeyFor(guideSource: string, guideId: string): string {
  return buildVersionedContentStorageKey(StorageKeys.GUIDE_ATTEMPT_PREFIX, `${guideSource}:${guideId}`);
}

function canonicalKey(key: AttemptKey): string {
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

function readAt(storageKey: string): GuideAttempt | null {
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

/** `true` when the attempt reached localStorage; `false` when it fell back to memory. */
function writeAt(storageKey: string, attempt: GuideAttempt): boolean {
  try {
    localStorage.setItem(storageKey, JSON.stringify(attempt));
    memory.delete(storageKey);
    return true;
  } catch {
    memory.set(storageKey, { ...attempt, mode: 'analytics' });
    return false;
  }
}

/** The stored attempt for a guide, or `null` when none exists or the stored value is corrupt. */
export function readAttempt(key: AttemptKey): GuideAttempt | null {
  return readAt(canonicalKey(key));
}

/**
 * The guide's attempt, minting one only when none exists. A closed attempt is
 * returned as-is — closing is not the same as clearing.
 *
 * Write-then-re-read: a second tab minting at the same moment may win the
 * write, and adopting whatever is stored keeps both tabs on one id. `minted`
 * is `true` only when this call's own candidate is the one that stuck.
 */
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
    return { attempt: memory.get(storageKey) ?? { ...candidate, mode: 'analytics' }, minted: true };
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
  for (const guideId of bundledGuideIdReadVariants(key.guideId)) {
    const storageKey = storageKeyFor(key.guideSource, guideId);
    memory.delete(storageKey);
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Storage unavailable: the memory half above is all there is to clear.
    }
  }
}

/** Forget every guide's attempt. Backs "Reset all learning progress". */
export function clearAllAttempts(): void {
  memory.clear();
  try {
    for (const storageKey of collectKeysByPrefix(localStorage, StorageKeys.GUIDE_ATTEMPT_PREFIX)) {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Storage unavailable: nothing persisted to clear.
  }
}

/**
 * The mode a new attempt is minted in. Always `analytics` until the plugin can
 * accept attempt-keyed writes; the records mode is wired in a later change.
 */
export function resolveAttemptMode(): AttemptMode {
  return 'analytics';
}

export function __resetAttemptsForTests(): void {
  memory.clear();
}
