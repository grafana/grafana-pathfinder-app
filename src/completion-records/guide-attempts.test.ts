import { StorageKeys } from '../lib/storage-keys';

import {
  clearAllAttempts,
  clearAttempt,
  closeAttempt,
  getOrMintAttempt,
  raiseHighWater,
  readAttempt,
  reopenAttempt,
  resolveAttemptMode,
  __resetAttemptsForTests,
  type GuideAttempt,
} from './guide-attempts';

const KEY = { guideSource: 'bundled', guideId: 'intro' };
const STORAGE_KEY = `${StorageKeys.GUIDE_ATTEMPT_PREFIX}13:bundled:intro`;
const ID_A = 'a'.repeat(32);
const ID_B = 'b'.repeat(32);

function ids(...values: string[]): () => string {
  return () => values.shift()!;
}

function stored(attempt: Partial<GuideAttempt> = {}): GuideAttempt {
  return { v: 1, attemptId: ID_A, startedAt: 1, closed: false, highWater: 0, mode: 'analytics', ...attempt };
}

beforeEach(() => {
  jest.restoreAllMocks();
  localStorage.clear();
  __resetAttemptsForTests();
});

describe('guide attempts', () => {
  it('stores an attempt under {prefix}{len}:{guideSource}:{guideId}', () => {
    getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A), now: () => 5 });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(stored({ startedAt: 5 }));
  });

  it('mints once and returns the same attempt on later calls', () => {
    const first = getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A, ID_B) });
    const second = getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_B) });

    expect(first).toEqual({ attempt: expect.objectContaining({ attemptId: ID_A }), minted: true });
    expect(second).toEqual({ attempt: expect.objectContaining({ attemptId: ID_A }), minted: false });
  });

  it('keys a bundled id and its /content.json spelling on one attempt', () => {
    getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A) });

    expect(readAttempt({ guideSource: 'bundled', guideId: 'intro/content.json' })?.attemptId).toBe(ID_A);
  });

  it('adopts a competing tab whose attempt landed between the write and the re-read', () => {
    const realSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      realSetItem.call(this, key, value);
      if (key === STORAGE_KEY) {
        realSetItem.call(this, key, JSON.stringify(stored({ attemptId: ID_B })));
      }
    });

    const result = getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A) });

    expect(result.minted).toBe(false);
    expect(result.attempt.attemptId).toBe(ID_B);
  });

  it('returns a closed attempt as closed and never re-mints it', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored({ closed: true })));

    const result = getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_B) });

    expect(result).toEqual({ attempt: expect.objectContaining({ attemptId: ID_A, closed: true }), minted: false });
  });

  it('raises the high-water mark only on a strict increase', () => {
    getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A) });

    expect(raiseHighWater(KEY, 30)).toEqual({ raised: true, previous: 0 });
    expect(raiseHighWater(KEY, 30)).toEqual({ raised: false, previous: 30 });
    expect(raiseHighWater(KEY, 20)).toEqual({ raised: false, previous: 30 });
    expect(raiseHighWater(KEY, 55)).toEqual({ raised: true, previous: 30 });
    expect(readAttempt(KEY)?.highWater).toBe(55);
  });

  it('does not raise a guide with no attempt', () => {
    expect(raiseHighWater(KEY, 30)).toEqual({ raised: false, previous: 0 });
    expect(readAttempt(KEY)).toBeNull();
  });

  it('closes and reopens only the attempt it names', () => {
    getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A) });

    closeAttempt(KEY, ID_B);
    expect(readAttempt(KEY)?.closed).toBe(false);
    closeAttempt(KEY, ID_A);
    expect(readAttempt(KEY)?.closed).toBe(true);
    reopenAttempt(KEY, ID_B);
    expect(readAttempt(KEY)?.closed).toBe(true);
    reopenAttempt(KEY, ID_A);
    expect(readAttempt(KEY)?.closed).toBe(false);
  });

  it('clears the attempt under the legacy /content.json spelling too', () => {
    const legacyKey = `${StorageKeys.GUIDE_ATTEMPT_PREFIX}26:bundled:intro/content.json`;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored()));
    localStorage.setItem(legacyKey, JSON.stringify(stored()));

    clearAttempt(KEY);

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(legacyKey)).toBeNull();
  });

  it('clears every attempt and nothing under another prefix', () => {
    getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_A) });
    getOrMintAttempt({ guideSource: 'app-platform', guideId: 'other' }, () => 'analytics', { nextId: ids(ID_B) });
    localStorage.setItem(`${StorageKeys.COMPLETION_EMITTED_PREFIX}x`, 'true');

    clearAllAttempts();

    expect(Object.keys(localStorage)).toEqual([`${StorageKeys.COMPLETION_EMITTED_PREFIX}x`]);
  });

  it.each([
    ['unparseable JSON', '{nope'],
    ['a wrong version', JSON.stringify({ ...stored(), v: 2 })],
    ['a non-hex id', JSON.stringify({ ...stored(), attemptId: 'not-an-id' })],
    ['an upper-case id', JSON.stringify({ ...stored(), attemptId: 'A'.repeat(32) })],
    ['an out-of-range high-water mark', JSON.stringify({ ...stored(), highWater: 101 })],
    ['an unknown mode', JSON.stringify({ ...stored(), mode: 'other' })],
  ])('treats %s as no attempt', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);

    expect(readAttempt(KEY)).toBeNull();
    const result = getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_B) });
    expect(result).toEqual({ attempt: expect.objectContaining({ attemptId: ID_B }), minted: true });
  });

  it('falls back to memory, in analytics mode, when localStorage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const first = getOrMintAttempt(KEY, () => 'records', { nextId: ids(ID_A) });
    const second = getOrMintAttempt(KEY, () => 'records', { nextId: ids(ID_B) });

    expect(first).toEqual({ attempt: expect.objectContaining({ attemptId: ID_A, mode: 'analytics' }), minted: true });
    expect(second).toEqual({ attempt: expect.objectContaining({ attemptId: ID_A }), minted: false });
    expect(raiseHighWater(KEY, 40)).toEqual({ raised: true, previous: 0 });
  });

  it('keeps a failed write over the stale stored value when only setItem throws', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    const minted = getOrMintAttempt(KEY, () => 'records', { nextId: ids(ID_A) });
    expect(minted).toEqual({ attempt: expect.objectContaining({ attemptId: ID_A, mode: 'analytics' }), minted: true });

    expect(raiseHighWater(KEY, 30)).toEqual({ raised: true, previous: 0 });
    expect(readAttempt(KEY)).toMatchObject({ attemptId: ID_A, highWater: 30, mode: 'analytics' });
    expect(raiseHighWater(KEY, 30)).toEqual({ raised: false, previous: 30 });

    closeAttempt(KEY, ID_A);
    expect(readAttempt(KEY)).toMatchObject({ attemptId: ID_A, closed: true, mode: 'analytics' });
    expect(getOrMintAttempt(KEY, () => 'analytics', { nextId: ids(ID_B) })).toEqual({
      attempt: expect.objectContaining({ attemptId: ID_A, closed: true }),
      minted: false,
    });
  });

  it('prefers a failed update over the stored attempt until a write succeeds', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored({ highWater: 10 })));
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });

    expect(raiseHighWater(KEY, 40)).toEqual({ raised: true, previous: 10 });
    closeAttempt(KEY, ID_A);

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject({ highWater: 10, closed: false });
    expect(readAttempt(KEY)).toMatchObject({ attemptId: ID_A, highWater: 40, closed: true, mode: 'analytics' });

    setItem.mockRestore();
    reopenAttempt(KEY, ID_A);
    __resetAttemptsForTests();

    expect(readAttempt(KEY)).toMatchObject({ attemptId: ID_A, highWater: 40, closed: false });
  });

  it('drops a failed write when the attempt is cleared', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored()));
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    raiseHighWater(KEY, 40);

    clearAttempt(KEY);

    expect(readAttempt(KEY)).toBeNull();
  });

  it('mints with a 32-hex id by default', () => {
    expect(getOrMintAttempt(KEY, () => 'analytics').attempt.attemptId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mints analytics attempts only, for now', () => {
    expect(resolveAttemptMode()).toBe('analytics');
  });
});
