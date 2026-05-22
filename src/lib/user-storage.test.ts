import { getAppEvents } from '@grafana/runtime';

import {
  __resetQuotaWarningForTests,
  interactiveCompletionStorage,
  interactiveStepStorage,
  journeyCompletionStorage,
  sectionAcknowledgementStorage,
  tabStorage,
  unwrapEnvelope,
  wrapEnvelope,
} from './user-storage';
import { StorageKeys } from './storage-keys';

// Mock `@grafana/runtime` so the quota-toast helper can publish through a
// jest spy. The mock is also necessary because user-storage.ts statically
// imports `usePluginUserStorage` and `getAppEvents` from this module, and
// the helper calls `getAppEvents()` at runtime.
jest.mock('@grafana/runtime', () => ({
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(),
}));

// ============================================================================
// ENVELOPE FORMAT TESTS
// ============================================================================

describe('wrapEnvelope', () => {
  it('should wrap a value and timestamp into a JSON envelope', () => {
    const result = wrapEnvelope('{"foo":"bar"}', 1700000000000);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ v: '{"foo":"bar"}', t: 1700000000000 });
  });

  it('should handle empty string values (deletions)', () => {
    const result = wrapEnvelope('', 1700000000000);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual({ v: '', t: 1700000000000 });
  });

  it('should produce valid JSON', () => {
    const result = wrapEnvelope('"hello"', 12345);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('should handle values with special characters', () => {
    const value = '{"url":"https://example.com/path?q=1&b=2"}';
    const result = wrapEnvelope(value, 999);
    const parsed = JSON.parse(result);
    expect(parsed.v).toBe(value);
    expect(parsed.t).toBe(999);
  });
});

describe('unwrapEnvelope', () => {
  it('should unwrap a valid envelope', () => {
    const envelope = JSON.stringify({ v: '{"foo":"bar"}', t: 1700000000000 });
    const result = unwrapEnvelope(envelope);
    expect(result).toEqual({ v: '{"foo":"bar"}', t: 1700000000000 });
  });

  it('should unwrap an envelope with empty value (deletion)', () => {
    const envelope = JSON.stringify({ v: '', t: 1700000000000 });
    const result = unwrapEnvelope(envelope);
    expect(result).toEqual({ v: '', t: 1700000000000 });
  });

  it('should return null for null input', () => {
    expect(unwrapEnvelope(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(unwrapEnvelope(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(unwrapEnvelope('')).toBeNull();
  });

  it('should return null for non-JSON strings (old-format raw data)', () => {
    // Old format: raw serialized value without envelope
    expect(unwrapEnvelope('{"foo":"bar"}')).toBeNull();
    expect(unwrapEnvelope('"just a string"')).toBeNull();
    expect(unwrapEnvelope('12345')).toBeNull();
  });

  it('should return null for objects missing the "v" field', () => {
    const noV = JSON.stringify({ t: 1700000000000 });
    expect(unwrapEnvelope(noV)).toBeNull();
  });

  it('should return null for objects missing the "t" field', () => {
    const noT = JSON.stringify({ v: '{"foo":"bar"}' });
    expect(unwrapEnvelope(noT)).toBeNull();
  });

  it('should return null for objects where "t" is not a number', () => {
    const stringT = JSON.stringify({ v: 'data', t: '1700000000000' });
    expect(unwrapEnvelope(stringT)).toBeNull();
  });

  it('should return null for arrays', () => {
    expect(unwrapEnvelope('[1,2,3]')).toBeNull();
  });

  it('should return null for invalid JSON', () => {
    expect(unwrapEnvelope('{broken json')).toBeNull();
  });

  it('should roundtrip with wrapEnvelope', () => {
    const original = '{"tabs":[{"id":"tab-1","title":"Test"}]}';
    const timestamp = Date.now();
    const wrapped = wrapEnvelope(original, timestamp);
    const unwrapped = unwrapEnvelope(wrapped);

    expect(unwrapped).not.toBeNull();
    expect(unwrapped!.v).toBe(original);
    expect(unwrapped!.t).toBe(timestamp);
  });

  it('should distinguish envelope from old-format JSON objects', () => {
    // Old format: a raw JSON object stored without envelope
    // This has "v" and "t" but "t" is a string, not a number
    const oldFormat = JSON.stringify({ v: 'data', t: 'not-a-number' });
    expect(unwrapEnvelope(oldFormat)).toBeNull();

    // A real envelope has a numeric timestamp
    const newFormat = JSON.stringify({ v: 'data', t: 42 });
    expect(unwrapEnvelope(newFormat)).toEqual({ v: 'data', t: 42 });
  });
});

// ============================================================================
// interactiveStepStorage.clearAll TESTS
// ============================================================================

describe('interactiveStepStorage.clearAll', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should remove all INTERACTIVE_STEPS_PREFIX keys from localStorage', async () => {
    // Seed step completion data for two different guides
    localStorage.setItem(`${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-a-section-1`, JSON.stringify(['step-1']));
    localStorage.setItem(`${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-b-section-1`, JSON.stringify(['step-2']));

    await interactiveStepStorage.clearAll();

    expect(localStorage.getItem(`${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-a-section-1`)).toBeNull();
    expect(localStorage.getItem(`${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-b-section-1`)).toBeNull();
  });

  it('should remove all SECTION_COLLAPSE_PREFIX keys from localStorage', async () => {
    localStorage.setItem(`${StorageKeys.SECTION_COLLAPSE_PREFIX}guide-a-section-1`, JSON.stringify(true));
    localStorage.setItem(`${StorageKeys.SECTION_COLLAPSE_PREFIX}guide-b-section-2`, JSON.stringify(false));

    await interactiveStepStorage.clearAll();

    expect(localStorage.getItem(`${StorageKeys.SECTION_COLLAPSE_PREFIX}guide-a-section-1`)).toBeNull();
    expect(localStorage.getItem(`${StorageKeys.SECTION_COLLAPSE_PREFIX}guide-b-section-2`)).toBeNull();
  });

  it('should not remove unrelated localStorage keys', async () => {
    localStorage.setItem('some-other-key', 'keep-me');
    localStorage.setItem(StorageKeys.LEARNING_PROGRESS, JSON.stringify({ completedGuides: [] }));
    localStorage.setItem(`${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-a-section-1`, JSON.stringify(['step-1']));

    await interactiveStepStorage.clearAll();

    expect(localStorage.getItem('some-other-key')).toBe('keep-me');
    expect(localStorage.getItem(StorageKeys.LEARNING_PROGRESS)).not.toBeNull();
  });

  it('should invalidate completedCountCache so countAllCompleted returns 0', async () => {
    // Seed data and prime the cache
    localStorage.setItem(`${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-a-section-1`, JSON.stringify(['s1', 's2']));
    const beforeClear = interactiveStepStorage.countAllCompleted('guide-a');
    expect(beforeClear).toBe(2);

    await interactiveStepStorage.clearAll();

    // Cache should be invalidated and localStorage should be empty
    const afterClear = interactiveStepStorage.countAllCompleted('guide-a');
    expect(afterClear).toBe(0);
  });

  it('should not throw on empty localStorage', async () => {
    await expect(interactiveStepStorage.clearAll()).resolves.toBeUndefined();
  });
});

// ============================================================================
// countAllCompleted ack-marker filter (#842)
// ============================================================================

describe('interactiveStepStorage.countAllCompleted — #842 ack-marker filter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not count "::ack-marker" entries toward the document total', () => {
    // All-passive section stores only a synthetic marker so the reducer's
    // ACKNOWLEDGE invariant ("ack requires at least one completed step") is
    // satisfied. The marker is not a real step and must not inflate the
    // document completion numerator — getTotalDocumentSteps() excludes it
    // from the denominator.
    localStorage.setItem(
      `${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-a-section-passive`,
      JSON.stringify(['section-passive::ack-marker'])
    );
    localStorage.setItem(
      `${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-a-section-real`,
      JSON.stringify(['real-step-1', 'real-step-2'])
    );

    expect(interactiveStepStorage.countAllCompleted('guide-a')).toBe(2);
  });

  it('returns 0 for a guide whose only completed entries are ack-markers', () => {
    // Use a distinct content key so the in-memory completedCountCache from a
    // sibling test cannot bleed into this assertion.
    localStorage.setItem(
      `${StorageKeys.INTERACTIVE_STEPS_PREFIX}guide-only-passive-section-passive`,
      JSON.stringify(['section-passive::ack-marker'])
    );

    expect(interactiveStepStorage.countAllCompleted('guide-only-passive')).toBe(0);
  });
});

// ============================================================================
// interactiveCompletionStorage.clearAll TESTS
// ============================================================================

describe('interactiveCompletionStorage.clearAll', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should remove the INTERACTIVE_COMPLETION key from localStorage', async () => {
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ 'guide-a': 100, 'guide-b': 50 }));

    await interactiveCompletionStorage.clearAll();

    expect(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION)).toBeNull();
  });

  it('should not throw on empty localStorage', async () => {
    await expect(interactiveCompletionStorage.clearAll()).resolves.toBeUndefined();
  });

  it('should not affect other storage keys', async () => {
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ 'guide-a': 100 }));
    localStorage.setItem(StorageKeys.LEARNING_PROGRESS, JSON.stringify({ completedGuides: ['g1'] }));

    await interactiveCompletionStorage.clearAll();

    expect(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION)).toBeNull();
    expect(localStorage.getItem(StorageKeys.LEARNING_PROGRESS)).not.toBeNull();
  });
});

// ============================================================================
// sectionAcknowledgementStorage TESTS (issue #842 gate)
// ============================================================================

describe('sectionAcknowledgementStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no acknowledgement entry exists', async () => {
    const value = await sectionAcknowledgementStorage.get('guide-a', 'section-1');
    expect(value).toBeNull();
  });

  it('round-trips an explicit true', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    const value = await sectionAcknowledgementStorage.get('guide-a', 'section-1');
    expect(value).toBe(true);
  });

  it('clear() removes the entry — subsequent get returns null again', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.clear('guide-a', 'section-1');
    const value = await sectionAcknowledgementStorage.get('guide-a', 'section-1');
    expect(value).toBeNull();
  });

  it('isolates state by content key', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    expect(await sectionAcknowledgementStorage.get('guide-b', 'section-1')).toBeNull();
  });

  it('isolates state by section id', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    expect(await sectionAcknowledgementStorage.get('guide-a', 'section-2')).toBeNull();
  });

  it('uses the SECTION_ACKNOWLEDGED_PREFIX storage key shape', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    const key = `${StorageKeys.SECTION_ACKNOWLEDGED_PREFIX}guide-a-section-1`;
    expect(localStorage.getItem(key)).not.toBeNull();
  });
});

// ============================================================================
// interactiveStepStorage.clearAllForContent — ack-prefix sweep TESTS
// ============================================================================

describe('interactiveStepStorage.clearAllForContent — ack prefix sweep (#842)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes acknowledgement entries for the matched content key', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.set('guide-a', 'section-2', true);

    await interactiveStepStorage.clearAllForContent('guide-a');

    expect(await sectionAcknowledgementStorage.get('guide-a', 'section-1')).toBeNull();
    expect(await sectionAcknowledgementStorage.get('guide-a', 'section-2')).toBeNull();
  });

  it('does NOT remove acknowledgement entries for other content keys', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.set('guide-b', 'section-1', true);

    await interactiveStepStorage.clearAllForContent('guide-a');

    expect(await sectionAcknowledgementStorage.get('guide-a', 'section-1')).toBeNull();
    expect(await sectionAcknowledgementStorage.get('guide-b', 'section-1')).toBe(true);
  });
});

// ============================================================================
// interactiveStepStorage.clearAll — ack-prefix sweep TESTS
// ============================================================================

describe('interactiveStepStorage.clearAll — ack prefix sweep (#842)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes all SECTION_ACKNOWLEDGED_PREFIX keys from localStorage', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.set('guide-b', 'section-2', true);

    await interactiveStepStorage.clearAll();

    expect(await sectionAcknowledgementStorage.get('guide-a', 'section-1')).toBeNull();
    expect(await sectionAcknowledgementStorage.get('guide-b', 'section-2')).toBeNull();
  });
});

// ============================================================================
// QUOTA-EXCEEDED TOAST (N-3 follow-up from PR #909)
// ============================================================================

describe('warnQuotaExceededOnce — surfaces a single toast across writes', () => {
  const publishMock = jest.fn();
  const originalSetItem = Storage.prototype.setItem;
  let setItemSpy: jest.SpyInstance;
  // When true, the next `setItem` call throws a QuotaExceededError and then
  // the flag flips back to false so the storage helper's fallback / retry
  // write can complete normally. This mirrors the real browser shape where a
  // single write trips the quota but a smaller / cleaned-up write succeeds.
  let throwQuotaOnNextWrite = false;

  beforeEach(() => {
    localStorage.clear();
    publishMock.mockClear();
    __resetQuotaWarningForTests();
    (getAppEvents as jest.Mock).mockReturnValue({ publish: publishMock });
    throwQuotaOnNextWrite = false;

    setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (throwQuotaOnNextWrite) {
        throwQuotaOnNextWrite = false;
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(this, key, value);
    });
  });

  afterEach(() => {
    setItemSpy.mockRestore();
  });

  it('publishes exactly one alert-warning toast across many quota-exceeded writes', async () => {
    // tabStorage.setTabs: first write throws → catch reduces & retries.
    throwQuotaOnNextWrite = true;
    await tabStorage.setTabs(['tab-1']);

    throwQuotaOnNextWrite = true;
    await tabStorage.setTabs(['tab-2']);

    // journeyCompletionStorage.set: first write throws → catch runs
    // cleanup() (no-op here, since entries < MAX) then retries via recursive
    // set(), which writes successfully because the flag has already flipped.
    throwQuotaOnNextWrite = true;
    await journeyCompletionStorage.set('journey-a', 50);

    throwQuotaOnNextWrite = true;
    await journeyCompletionStorage.set('journey-b', 75);

    // interactiveCompletionStorage.set: identical shape to the journey path.
    throwQuotaOnNextWrite = true;
    await interactiveCompletionStorage.set('guide-a', 25);

    throwQuotaOnNextWrite = true;
    await interactiveCompletionStorage.set('guide-b', 90);

    expect(publishMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith({
      type: 'alert-warning',
      payload: [
        'Browser storage full',
        'Your progress may not be saved. Try resetting old guide progress via My Learning to free up space.',
      ],
    });
  });

  it('publishes the toast again after the module flag is reset', async () => {
    throwQuotaOnNextWrite = true;
    await tabStorage.setTabs(['tab-1']);
    expect(publishMock).toHaveBeenCalledTimes(1);

    // Simulate a fresh page lifecycle.
    __resetQuotaWarningForTests();

    throwQuotaOnNextWrite = true;
    await tabStorage.setTabs(['tab-2']);
    expect(publishMock).toHaveBeenCalledTimes(2);
  });

  it('does not throw when getAppEvents() itself throws (e.g. uninitialized runtime)', async () => {
    (getAppEvents as jest.Mock).mockImplementation(() => {
      throw new Error('grafana/runtime not initialized');
    });

    throwQuotaOnNextWrite = true;
    await expect(tabStorage.setTabs(['tab-1'])).resolves.toBeUndefined();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('retries the toast on a later write when getAppEvents() threw on the first attempt', async () => {
    // First write: runtime not initialized → publish never runs, flag
    // must remain false so a later write can still surface the toast.
    (getAppEvents as jest.Mock).mockImplementation(() => {
      throw new Error('grafana/runtime not initialized');
    });

    throwQuotaOnNextWrite = true;
    await tabStorage.setTabs(['tab-1']);
    expect(publishMock).not.toHaveBeenCalled();

    // Runtime initialized between writes — the helper must surface the
    // toast now instead of staying permanently silent.
    (getAppEvents as jest.Mock).mockImplementation(() => ({ publish: publishMock }));

    throwQuotaOnNextWrite = true;
    await tabStorage.setTabs(['tab-2']);
    expect(publishMock).toHaveBeenCalledTimes(1);
  });
});
