import { getAppEvents } from '@grafana/runtime';

import {
  __resetQuotaWarningForTests,
  completionEmittedStorage,
  createHybridStorage,
  createLocalStorage,
  guideResponseStorage,
  interactiveCompletionStorage,
  interactiveStepStorage,
  journeyCompletionStorage,
  milestoneCompletionStorage,
  sectionAcknowledgementStorage,
  sectionCollapseStorage,
  sectionDoneStorage,
  setGlobalStorage,
  tabStorage,
  unwrapEnvelope,
  wrapEnvelope,
} from './user-storage';
import { StorageKeys, buildVersionedContentStorageKey, buildVersionedSectionStorageKey } from './storage-keys';

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

describe('milestoneCompletionStorage', () => {
  const journeyUrl = 'https://grafana.com/docs/learning-paths/linux-server-integration';

  beforeEach(() => {
    localStorage.clear();
  });

  it('reads completions written with launch URL variants under the journey base URL', async () => {
    await milestoneCompletionStorage.markCompleted(`${journeyUrl}/`, 'install-alloy');
    await milestoneCompletionStorage.markCompleted(`${journeyUrl}/view-data/content.json`, 'view-data');

    await expect(milestoneCompletionStorage.getCompleted(journeyUrl)).resolves.toEqual(
      new Set(['install-alloy', 'view-data'])
    );

    const stored = JSON.parse(localStorage.getItem(StorageKeys.MILESTONE_COMPLETION) ?? '{}');
    expect(stored[journeyUrl]).toEqual(['install-alloy', 'view-data']);
    expect(stored[`${journeyUrl}/`]).toEqual(['install-alloy', 'view-data']);
    expect(stored[`${journeyUrl}/view-data/content.json`]).toEqual(['install-alloy', 'view-data']);
  });

  it('reads non-HTTP milestone aliases supplied by journey metadata', async () => {
    localStorage.setItem(
      StorageKeys.MILESTONE_COMPLETION,
      JSON.stringify({ 'bundled:demo-milestone/content.json': ['demo-milestone'] })
    );

    await expect(
      milestoneCompletionStorage.getCompleted('bundled:demo-cover/content.json', [
        'bundled:demo-milestone/content.json',
      ])
    ).resolves.toEqual(new Set(['demo-milestone']));
  });

  it('clears canonical and legacy URL variants together', async () => {
    await milestoneCompletionStorage.markCompleted(`${journeyUrl}/`, 'install-alloy');
    await milestoneCompletionStorage.markCompleted(`${journeyUrl}/view-data/content.json`, 'view-data');

    await milestoneCompletionStorage.clear(journeyUrl);

    await expect(milestoneCompletionStorage.getCompleted(journeyUrl)).resolves.toEqual(new Set());
    expect(JSON.parse(localStorage.getItem(StorageKeys.MILESTONE_COMPLETION) ?? '{}')).toEqual({});
  });

  it('clearAll drops every journey', async () => {
    await milestoneCompletionStorage.markCompleted(journeyUrl, 'install-alloy');
    await milestoneCompletionStorage.markCompleted('backend-guide:fe-alerting-path', 'fe-alerting-01');

    await milestoneCompletionStorage.clearAll();

    await expect(milestoneCompletionStorage.getCompleted(journeyUrl)).resolves.toEqual(new Set());
    await expect(milestoneCompletionStorage.getCompleted('backend-guide:fe-alerting-path')).resolves.toEqual(new Set());
    expect(localStorage.getItem(StorageKeys.MILESTONE_COMPLETION)).toBeNull();
  });

  describe('getCompletedSync', () => {
    it('returns an empty set before anything is written', () => {
      expect(milestoneCompletionStorage.getCompletedSync(journeyUrl)).toEqual(new Set());
    });

    it('reads back a completion written through markCompleted, synchronously', async () => {
      await milestoneCompletionStorage.markCompleted(`${journeyUrl}/`, 'install-alloy');

      expect(milestoneCompletionStorage.getCompletedSync(journeyUrl)).toEqual(new Set(['install-alloy']));
    });

    it('resolves milestone aliases the same way the async read does', () => {
      localStorage.setItem(
        StorageKeys.MILESTONE_COMPLETION,
        JSON.stringify({ 'bundled:demo-milestone/content.json': ['demo-milestone'] })
      );

      expect(
        milestoneCompletionStorage.getCompletedSync('bundled:demo-cover/content.json', [
          'bundled:demo-milestone/content.json',
        ])
      ).toEqual(new Set(['demo-milestone']));
    });

    it('returns an empty set for malformed JSON rather than throwing', () => {
      localStorage.setItem(StorageKeys.MILESTONE_COMPLETION, '{not json');

      expect(milestoneCompletionStorage.getCompletedSync(journeyUrl)).toEqual(new Set());
    });
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
    localStorage.setItem(
      buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, 'guide-a', 'section-1'),
      JSON.stringify(['s1', 's2'])
    );
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
      buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, 'guide-a', 'section-passive'),
      JSON.stringify(['section-passive::ack-marker'])
    );
    localStorage.setItem(
      buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, 'guide-a', 'section-real'),
      JSON.stringify(['real-step-1', 'real-step-2'])
    );

    expect(interactiveStepStorage.countAllCompleted('guide-a')).toBe(2);
  });

  it('returns 0 for a guide whose only completed entries are ack-markers', () => {
    // Use a distinct content key so the in-memory completedCountCache from a
    // sibling test cannot bleed into this assertion.
    localStorage.setItem(
      buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, 'guide-only-passive', 'section-passive'),
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
// interactiveCompletionStorage CAP TESTS
// ============================================================================

describe('interactiveCompletionStorage at its cap', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const storedCount = () =>
    Object.keys(JSON.parse(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION) || '{}')).length;

  it('keeps progress on a guide the reader is still using once the cap is exceeded', async () => {
    // Fill the record right up to the cap, oldest first.
    const seeded: Record<string, number> = {};
    for (let i = 0; i < 250; i++) {
      seeded[`guide-${i}`] = 10;
    }
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify(seeded));

    // The reader returns to the guide they opened first and earns more progress.
    await interactiveCompletionStorage.set('guide-0', 80);

    // Then they open a guide they have never seen, pushing the record over budget.
    await interactiveCompletionStorage.set('brand-new-guide', 5);

    expect(await interactiveCompletionStorage.get('guide-0')).toBe(80);
    expect(await interactiveCompletionStorage.get('brand-new-guide')).toBe(5);
    expect(storedCount()).toBe(250);
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

  it('writes under the collision-safe SECTION_ACKNOWLEDGED_PREFIX key shape', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    const key = buildVersionedSectionStorageKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, 'guide-a', 'section-1');
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(localStorage.getItem(`${StorageKeys.SECTION_ACKNOWLEDGED_PREFIX}guide-a-section-1`)).toBeNull();
  });
});

// ============================================================================
// Progress-scan caching — the completion percentage reads these on a render
// path (the Mark complete footer's useSyncExternalStore snapshot), so a
// repeated read must not re-sweep localStorage, and a write must still be
// seen immediately.
// ============================================================================

describe('progress scans are cached per content key and invalidated by writes', () => {
  const CONTENT_KEY = 'bundled:scan-cache';

  beforeEach(async () => {
    localStorage.clear();
    // Through the API, so the caches are invalidated along with storage.
    await interactiveStepStorage.clearAllForContent(CONTENT_KEY);
  });

  function countStorageKeyReads(read: () => void): number {
    const spy = jest.spyOn(Storage.prototype, 'key');
    try {
      read();
      return spy.mock.calls.length;
    } finally {
      spy.mockRestore();
    }
  }

  it('does not re-scan localStorage for a repeated step-evidence read', async () => {
    await interactiveStepStorage.setCompleted(CONTENT_KEY, 'section-1', new Set(['step-1', 'step-2']));

    const firstRead = countStorageKeyReads(() => {
      expect(interactiveStepStorage.listAllCompleted(CONTENT_KEY)).toEqual(['step-1', 'step-2']);
    });
    const repeatedReads = countStorageKeyReads(() => {
      interactiveStepStorage.listAllCompleted(CONTENT_KEY);
      interactiveStepStorage.countAllCompleted(CONTENT_KEY);
      interactiveStepStorage.listAllCompleted(CONTENT_KEY);
    });

    expect(firstRead).toBeGreaterThan(0);
    expect(repeatedReads).toBe(0);
  });

  it('sees a step written after a cached read', async () => {
    await interactiveStepStorage.setCompleted(CONTENT_KEY, 'section-1', new Set(['step-1']));
    expect(interactiveStepStorage.countAllCompleted(CONTENT_KEY)).toBe(1);

    await interactiveStepStorage.setCompleted(CONTENT_KEY, 'section-1', new Set(['step-1', 'step-2']));

    expect(interactiveStepStorage.listAllCompleted(CONTENT_KEY)).toEqual(['step-1', 'step-2']);
  });

  it('does not re-scan localStorage for a repeated acknowledgement read', async () => {
    await sectionAcknowledgementStorage.set(CONTENT_KEY, 'section-1', true);

    const firstRead = countStorageKeyReads(() => {
      expect(sectionAcknowledgementStorage.listAllAcknowledged(CONTENT_KEY)).toEqual(['section-1']);
    });
    const repeatedReads = countStorageKeyReads(() => {
      sectionAcknowledgementStorage.listAllAcknowledged(CONTENT_KEY);
      sectionAcknowledgementStorage.countAllAcknowledged(CONTENT_KEY);
    });

    expect(firstRead).toBeGreaterThan(0);
    expect(repeatedReads).toBe(0);
  });

  it('sees an acknowledgement cleared after a cached read', async () => {
    await sectionAcknowledgementStorage.set(CONTENT_KEY, 'section-1', true);
    expect(sectionAcknowledgementStorage.countAllAcknowledged(CONTENT_KEY)).toBe(1);

    await sectionAcknowledgementStorage.clear(CONTENT_KEY, 'section-1');

    expect(sectionAcknowledgementStorage.listAllAcknowledged(CONTENT_KEY)).toEqual([]);
  });

  it('re-scans after the cross-tab invalidation hooks', async () => {
    await interactiveStepStorage.setCompleted(CONTENT_KEY, 'section-1', new Set(['step-1']));
    await sectionAcknowledgementStorage.set(CONTENT_KEY, 'section-1', true);
    expect(interactiveStepStorage.countAllCompleted(CONTENT_KEY)).toBe(1);
    expect(sectionAcknowledgementStorage.countAllAcknowledged(CONTENT_KEY)).toBe(1);

    // Another tab's write lands in localStorage without passing through this
    // tab's storage API, which is exactly what these hooks exist for.
    localStorage.setItem(
      buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, CONTENT_KEY, 'section-2'),
      JSON.stringify(['step-9'])
    );
    localStorage.removeItem(
      buildVersionedSectionStorageKey(StorageKeys.SECTION_ACKNOWLEDGED_PREFIX, CONTENT_KEY, 'section-1')
    );
    interactiveStepStorage.invalidateCountCache(CONTENT_KEY);
    sectionAcknowledgementStorage.invalidateAcknowledgementCache(CONTENT_KEY);

    expect(interactiveStepStorage.countAllCompleted(CONTENT_KEY)).toBe(2);
    expect(sectionAcknowledgementStorage.countAllAcknowledged(CONTENT_KEY)).toBe(0);
  });
});

// ============================================================================
// sectionAcknowledgementStorage.countAllAcknowledged (F-1 follow-up to #909)
// ============================================================================

describe('sectionAcknowledgementStorage.countAllAcknowledged', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns 0 when no acknowledgement entries exist', () => {
    expect(sectionAcknowledgementStorage.countAllAcknowledged('guide-a')).toBe(0);
  });

  it('counts each acknowledged section for the given content key', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.set('guide-a', 'section-2', true);
    expect(sectionAcknowledgementStorage.countAllAcknowledged('guide-a')).toBe(2);
  });

  it('ignores acknowledgement entries belonging to other content keys', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.set('guide-b', 'section-1', true);
    expect(sectionAcknowledgementStorage.countAllAcknowledged('guide-a')).toBe(1);
    expect(sectionAcknowledgementStorage.countAllAcknowledged('guide-b')).toBe(1);
  });

  it('drops cleared entries from the count', async () => {
    await sectionAcknowledgementStorage.set('guide-a', 'section-1', true);
    await sectionAcknowledgementStorage.set('guide-a', 'section-2', true);
    await sectionAcknowledgementStorage.clear('guide-a', 'section-1');
    expect(sectionAcknowledgementStorage.countAllAcknowledged('guide-a')).toBe(1);
  });
});

// ============================================================================
// interactiveStepStorage.clearAllForContent — content-key isolation tests
// ============================================================================

describe('interactiveStepStorage.clearAllForContent — content-key isolation (#1846)', () => {
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

  it('does not remove progress when another content key shares its prefix', async () => {
    const target = 'bundled:welcome-to-grafana';
    const sibling = 'bundled:welcome-to-grafana-cloud';
    const sectionId = 'section-1';

    await interactiveStepStorage.setCompleted(target, sectionId, new Set(['step-1']));
    await sectionCollapseStorage.set(target, sectionId, true);
    await sectionAcknowledgementStorage.set(target, sectionId, true);
    await sectionDoneStorage.set(target, sectionId, true);

    await interactiveStepStorage.setCompleted(sibling, sectionId, new Set(['step-1']));
    await sectionCollapseStorage.set(sibling, sectionId, true);
    await sectionAcknowledgementStorage.set(sibling, sectionId, true);
    await sectionDoneStorage.set(sibling, sectionId, true);

    await interactiveStepStorage.clearAllForContent(target);

    expect(await interactiveStepStorage.getCompleted(target, sectionId)).toEqual(new Set());
    expect(await sectionCollapseStorage.get(target, sectionId)).toBe(false);
    expect(await sectionAcknowledgementStorage.get(target, sectionId)).toBeNull();
    expect(await sectionDoneStorage.get(target, sectionId)).toBeNull();

    expect(await interactiveStepStorage.getCompleted(sibling, sectionId)).toEqual(new Set(['step-1']));
    expect(await sectionCollapseStorage.get(sibling, sectionId)).toBe(true);
    expect(await sectionAcknowledgementStorage.get(sibling, sectionId)).toBe(true);
    expect(await sectionDoneStorage.get(sibling, sectionId)).toBe(true);
  });

  it('clears versioned progress on subsequent resets without affecting a prefix-sharing sibling', async () => {
    const target = 'bundled:welcome-to-grafana';
    const sibling = 'bundled:welcome-to-grafana-cloud';
    const sectionId = 'section-1';

    await interactiveStepStorage.setCompleted(target, sectionId, new Set(['legacy-step']));
    await interactiveStepStorage.setCompleted(sibling, sectionId, new Set(['sibling-step']));

    await interactiveStepStorage.clearAllForContent(target);

    await interactiveStepStorage.setCompleted(target, sectionId, new Set(['versioned-step']));
    await sectionCollapseStorage.set(target, sectionId, true);
    await sectionAcknowledgementStorage.set(target, sectionId, true);
    await sectionDoneStorage.set(target, sectionId, true);

    await interactiveStepStorage.clearAllForContent(target);

    expect(await interactiveStepStorage.getCompleted(target, sectionId)).toEqual(new Set());
    expect(await sectionCollapseStorage.get(target, sectionId)).toBe(false);
    expect(await sectionAcknowledgementStorage.get(target, sectionId)).toBeNull();
    expect(await sectionDoneStorage.get(target, sectionId)).toBeNull();

    expect(await interactiveStepStorage.getCompleted(sibling, sectionId)).toEqual(new Set(['sibling-step']));
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

// ============================================================================
// GUIDE RESPONSE STORAGE — OWN-KEY LOOKUPS
// ============================================================================

describe('guideResponseStorage — own-key lookups', () => {
  beforeEach(() => {
    localStorage.clear();
    // Seeded so getAll() parses a fresh container instead of returning the module default.
    localStorage.setItem(StorageKeys.GUIDE_RESPONSES, JSON.stringify({}));
  });

  it('round-trips responses for an ordinary guide id', async () => {
    await guideResponseStorage.setResponse('docs-grafana-alerting', 'region', 'us-east-1');

    await expect(guideResponseStorage.getForGuide('docs-grafana-alerting')).resolves.toEqual({ region: 'us-east-1' });
    await expect(guideResponseStorage.getResponse('docs-grafana-alerting', 'region')).resolves.toBe('us-east-1');
    await expect(guideResponseStorage.hasResponse('docs-grafana-alerting', 'region')).resolves.toBe(true);

    await guideResponseStorage.deleteResponse('docs-grafana-alerting', 'region');

    await expect(guideResponseStorage.getForGuide('docs-grafana-alerting')).resolves.toEqual({});
    await expect(guideResponseStorage.hasResponse('docs-grafana-alerting', 'region')).resolves.toBe(false);
  });

  it('misses a guide id naming an inherited member instead of resolving through the prototype chain', async () => {
    const responses = await guideResponseStorage.getForGuide('__proto__');

    expect(responses).not.toBe(Object.prototype);
    expect(responses).toEqual({});
    await expect(guideResponseStorage.getResponse('__proto__', 'toString')).resolves.toBeUndefined();
    await expect(guideResponseStorage.hasResponse('__proto__', 'toString')).resolves.toBe(false);
  });

  it('leaves Object.prototype unmodified when writing under a guide id naming an inherited member', async () => {
    try {
      await guideResponseStorage.setResponse('__proto__', 'ownKeyProbe', 'written');

      expect(({} as Record<string, unknown>).ownKeyProbe).toBeUndefined();
      expect(Object.hasOwn(Object.prototype, 'ownKeyProbe')).toBe(false);
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).ownKeyProbe;
    }
  });

  it('leaves Object.prototype unmodified when deleting under a guide id naming an inherited member', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toLocaleString');

    try {
      await guideResponseStorage.deleteResponse('__proto__', 'toLocaleString');

      expect(Object.hasOwn(Object.prototype, 'toLocaleString')).toBe(true);
    } finally {
      if (descriptor && !Object.hasOwn(Object.prototype, 'toLocaleString')) {
        Object.defineProperty(Object.prototype, 'toLocaleString', descriptor);
      }
    }
  });

  it('misses a variable name naming an inherited member', async () => {
    await guideResponseStorage.setResponse('docs-grafana-alerting', 'region', 'us-east-1');

    await expect(guideResponseStorage.getResponse('docs-grafana-alerting', 'toString')).resolves.toBeUndefined();
    await expect(guideResponseStorage.hasResponse('docs-grafana-alerting', 'toString')).resolves.toBe(false);
  });
});

// ============================================================================
// Prefix-sharing content keys (#1846)
//
// `bundled:welcome-to-grafana` and `bundled:welcome-to-grafana-cloud` both
// ship. The superseded key shape joined the content key and the section id
// with a hyphen and marked neither boundary, so a scan for the first also
// matched every record belonging to the second.
// ============================================================================

const SHORT_GUIDE = 'bundled:welcome-to-grafana';
const LONG_GUIDE = 'bundled:welcome-to-grafana-cloud';

describe('progress counters — prefix-sharing content keys', () => {
  beforeEach(() => {
    localStorage.clear();
    interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);
    interactiveStepStorage.invalidateCountCache(LONG_GUIDE);
  });

  it('counts no steps for a guide whose only records belong to a longer-named neighbour', async () => {
    await interactiveStepStorage.setCompleted(LONG_GUIDE, 'section-1', new Set(['cloud-step-1', 'cloud-step-2']));

    expect(interactiveStepStorage.countAllCompleted(SHORT_GUIDE)).toBe(0);
    expect(interactiveStepStorage.countAllCompleted(LONG_GUIDE)).toBe(2);
  });

  it('counts only its own steps when both guides have records', async () => {
    await interactiveStepStorage.setCompleted(SHORT_GUIDE, 'section-1', new Set(['step-1']));
    await interactiveStepStorage.setCompleted(LONG_GUIDE, 'section-1', new Set(['cloud-step-1', 'cloud-step-2']));

    expect(interactiveStepStorage.countAllCompleted(SHORT_GUIDE)).toBe(1);
    expect(interactiveStepStorage.countAllCompleted(LONG_GUIDE)).toBe(2);
  });

  it('counts no acknowledgements for a guide whose only records belong to a longer-named neighbour', async () => {
    await sectionAcknowledgementStorage.set(LONG_GUIDE, 'section-1', true);

    expect(sectionAcknowledgementStorage.countAllAcknowledged(SHORT_GUIDE)).toBe(0);
    expect(sectionAcknowledgementStorage.countAllAcknowledged(LONG_GUIDE)).toBe(1);
  });

  it('reports no progress for a guide whose neighbour holds the only records', async () => {
    await interactiveStepStorage.setCompleted(LONG_GUIDE, 'section-1', new Set(['cloud-step-1']));

    expect(await interactiveStepStorage.hasProgress(SHORT_GUIDE)).toBe(false);
    expect(await interactiveStepStorage.hasProgress(LONG_GUIDE)).toBe(true);
  });

  it('reads back only its own section state, section by section', async () => {
    await interactiveStepStorage.setCompleted(LONG_GUIDE, 'section-1', new Set(['cloud-step-1']));
    await sectionCollapseStorage.set(LONG_GUIDE, 'section-1', true);
    await sectionDoneStorage.set(LONG_GUIDE, 'section-1', true);

    expect(await interactiveStepStorage.getCompleted(SHORT_GUIDE, 'section-1')).toEqual(new Set());
    expect(await sectionCollapseStorage.get(SHORT_GUIDE, 'section-1')).toBe(false);
    expect(await sectionDoneStorage.get(SHORT_GUIDE, 'section-1')).toBeNull();
  });

  it('keeps the two guides isolated after only one of them has been reset', async () => {
    await interactiveStepStorage.setCompleted(SHORT_GUIDE, 'section-1', new Set(['step-1']));
    await interactiveStepStorage.setCompleted(LONG_GUIDE, 'section-1', new Set(['cloud-step-1', 'cloud-step-2']));

    await interactiveStepStorage.clearAllForContent(LONG_GUIDE);
    interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);

    expect(interactiveStepStorage.countAllCompleted(LONG_GUIDE)).toBe(0);
    expect(interactiveStepStorage.countAllCompleted(SHORT_GUIDE)).toBe(1);
  });
});

describe('interactiveStepStorage.clearAllForContent — a reset that cannot complete says so', () => {
  beforeEach(() => {
    localStorage.clear();
    interactiveStepStorage.invalidateCountCache(SHORT_GUIDE);
  });

  it('rejects when a record survives the reset', async () => {
    await interactiveStepStorage.setCompleted(SHORT_GUIDE, 'section-1', new Set(['step-1']));
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);

    try {
      await expect(interactiveStepStorage.clearAllForContent(SHORT_GUIDE)).rejects.toThrow(/left 1 record/);
    } finally {
      removeItem.mockRestore();
    }

    expect(await interactiveStepStorage.getCompleted(SHORT_GUIDE, 'section-1')).toEqual(new Set(['step-1']));
  });

  it('resolves once every record for the guide is gone', async () => {
    await interactiveStepStorage.setCompleted(SHORT_GUIDE, 'section-1', new Set(['step-1']));
    await sectionCollapseStorage.set(SHORT_GUIDE, 'section-1', true);
    await sectionAcknowledgementStorage.set(SHORT_GUIDE, 'section-1', true);
    await sectionDoneStorage.set(SHORT_GUIDE, 'section-1', true);

    await expect(interactiveStepStorage.clearAllForContent(SHORT_GUIDE)).resolves.toBeUndefined();

    expect(await interactiveStepStorage.getCompleted(SHORT_GUIDE, 'section-1')).toEqual(new Set());
    expect(await sectionCollapseStorage.get(SHORT_GUIDE, 'section-1')).toBe(false);
    expect(await sectionAcknowledgementStorage.get(SHORT_GUIDE, 'section-1')).toBeNull();
    expect(await sectionDoneStorage.get(SHORT_GUIDE, 'section-1')).toBeNull();
  });

  it('clears every completion dedupe guard without breeding timestamp companions', async () => {
    // `removeItem` writes a deletion companion beside whatever it removes, so
    // a reset that hands it the previous reset's companions deepens the tail
    // by one level each time and doubles the backend writes.
    jest.useFakeTimers();
    const grafanaStorage = {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
    };
    setGlobalStorage(createHybridStorage(grafanaStorage));

    try {
      await completionEmittedStorage.markEmitted('guide:bundled:one');
      await completionEmittedStorage.markEmitted('guide:bundled:two');

      const setItem = jest.spyOn(Storage.prototype, 'setItem');
      await completionEmittedStorage.clearAll();
      const writtenKeys = setItem.mock.calls
        .map(([key]) => key)
        .filter((key): key is string => typeof key === 'string');
      setItem.mockRestore();
      await completionEmittedStorage.clearAll();

      expect(completionEmittedStorage.isEmitted('guide:bundled:one')).toBe(false);
      expect(completionEmittedStorage.isEmitted('guide:bundled:two')).toBe(false);
      // One deletion companion per guard — a companion handed back through
      // `removeItem` would write another one beside itself.
      expect(new Set(writtenKeys)).toEqual(
        new Set(
          ['guide:bundled:one', 'guide:bundled:two'].map(
            (dedupeKey) =>
              `${buildVersionedContentStorageKey(StorageKeys.COMPLETION_EMITTED_PREFIX, dedupeKey)}__timestamp`
          )
        )
      );
      expect(writtenKeys).toHaveLength(2);
      // Nothing left under the namespace — not the guards, not the deletion
      // companions the removals wrote, and no companion of a companion.
      expect(Object.keys(localStorage).filter((key) => key.startsWith(StorageKeys.COMPLETION_EMITTED_PREFIX))).toEqual(
        []
      );
    } finally {
      setGlobalStorage(createLocalStorage());
      jest.useRealTimers();
    }
  });

  it('writes no record of its own — only the backend timestamp companions of records it removed', async () => {
    // The interim scheme completed a reset by writing a per-content marker, so
    // a refused write left the old progress live and still read. Nothing is
    // written on the reset's own behalf now — the only writes are the backend's
    // own deletion companions, one beside each record it removed.
    jest.useFakeTimers();
    const grafanaStorage = {
      getItem: jest.fn(async () => null),
      setItem: jest.fn(async () => undefined),
    };
    setGlobalStorage(createHybridStorage(grafanaStorage));

    try {
      await interactiveStepStorage.setCompleted(SHORT_GUIDE, 'section-1', new Set(['step-1']));
      await sectionDoneStorage.set(SHORT_GUIDE, 'section-1', true);
      const removedKeys = [
        buildVersionedSectionStorageKey(StorageKeys.INTERACTIVE_STEPS_PREFIX, SHORT_GUIDE, 'section-1'),
        buildVersionedSectionStorageKey(StorageKeys.SECTION_DONE_PREFIX, SHORT_GUIDE, 'section-1'),
      ];
      const setItem = jest.spyOn(Storage.prototype, 'setItem');

      await expect(interactiveStepStorage.clearAllForContent(SHORT_GUIDE)).resolves.toBeUndefined();

      const writtenKeys = setItem.mock.calls
        .map(([key]) => key)
        .filter((key): key is string => typeof key === 'string' && key.startsWith('grafana-pathfinder-app-'));
      setItem.mockRestore();

      // Every write is a deletion companion the backend put beside a record
      // this reset had just removed — no marker, no key of the reset's own.
      expect(writtenKeys).toEqual(removedKeys.map((key) => `${key}__timestamp`));
      expect(Object.keys(localStorage).filter((key) => key.startsWith(StorageKeys.CONTENT_PROGRESS_V2_PREFIX))).toEqual(
        []
      );
    } finally {
      setGlobalStorage(createLocalStorage());
      jest.useRealTimers();
    }
  });
});
