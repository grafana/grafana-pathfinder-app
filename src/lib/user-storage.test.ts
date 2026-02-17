import { wrapEnvelope, unwrapEnvelope, interactiveStepStorage, interactiveCompletionStorage } from './user-storage';
import { StorageKeys } from './storage-keys';

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
