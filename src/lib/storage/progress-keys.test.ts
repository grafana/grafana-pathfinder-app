/**
 * The pair used throughout is the real one — `bundled:welcome-to-grafana` and
 * `bundled:welcome-to-grafana-cloud` both ship, and every key belonging to the
 * second in the superseded shape begins with the first's identifier.
 */
import {
  StorageKeys,
  buildDiscardedSectionStorageKey,
  buildVersionedContentStorageKey,
  buildVersionedSectionStorageKey,
  parseVersionedStorageKey,
} from '../storage-keys';
import { listProgressEntries, progressSectionKey, sweepDiscardedProgressRecords } from './progress-keys';

const SHORT_GUIDE = 'bundled:welcome-to-grafana';
const LONG_GUIDE = 'bundled:welcome-to-grafana-cloud';
const STEPS = StorageKeys.INTERACTIVE_STEPS_PREFIX;

function discardedKey(contentKey: string, sectionId: string): string {
  return buildDiscardedSectionStorageKey(STEPS, contentKey, sectionId);
}

beforeEach(() => {
  localStorage.clear();
});

describe('parseVersionedStorageKey', () => {
  it('round-trips a section key whose content key contains both separators', () => {
    const key = buildVersionedSectionStorageKey(STEPS, 'https://example.com/a-b:c', 'section-1');
    expect(parseVersionedStorageKey(STEPS, key)).toEqual({
      contentKey: 'https://example.com/a-b:c',
      sectionId: 'section-1',
    });
  });

  it('round-trips a per-content key with no section', () => {
    const key = buildVersionedContentStorageKey(STEPS, LONG_GUIDE);
    expect(parseVersionedStorageKey(STEPS, key)).toEqual({ contentKey: LONG_GUIDE, sectionId: '' });
  });

  it('rejects the superseded shape, a foreign prefix, and a mis-declared length', () => {
    expect(parseVersionedStorageKey(STEPS, discardedKey(SHORT_GUIDE, 'section-1'))).toBeNull();
    expect(
      parseVersionedStorageKey(
        StorageKeys.SECTION_DONE_PREFIX,
        buildVersionedSectionStorageKey(STEPS, SHORT_GUIDE, 's')
      )
    ).toBeNull();
    expect(parseVersionedStorageKey(STEPS, `${STEPS}999:${SHORT_GUIDE}:section-1`)).toBeNull();
    expect(parseVersionedStorageKey(STEPS, `${STEPS}0::section-1`)).toBeNull();
  });

  it('does not read one content key as a longer one with the same opening', () => {
    const key = buildVersionedSectionStorageKey(STEPS, LONG_GUIDE, 'section-1');
    expect(parseVersionedStorageKey(STEPS, key)?.contentKey).toBe(LONG_GUIDE);
    expect(parseVersionedStorageKey(STEPS, key)?.contentKey).not.toBe(SHORT_GUIDE);
  });
});

describe('listProgressEntries', () => {
  it('returns only the named content key records, never a prefix-sharing guide', () => {
    localStorage.setItem(progressSectionKey(STEPS, SHORT_GUIDE, 'section-1'), JSON.stringify(['step-1']));
    localStorage.setItem(progressSectionKey(STEPS, LONG_GUIDE, 'section-1'), JSON.stringify(['cloud-1', 'cloud-2']));

    expect(listProgressEntries(STEPS, SHORT_GUIDE)).toEqual([{ sectionId: 'section-1', raw: '["step-1"]' }]);
    expect(listProgressEntries(STEPS, LONG_GUIDE)).toEqual([{ sectionId: 'section-1', raw: '["cloud-1","cloud-2"]' }]);
  });

  it('ignores the timestamp companions the storage backend writes', () => {
    const key = progressSectionKey(STEPS, SHORT_GUIDE, 'section-1');
    localStorage.setItem(key, JSON.stringify(['step-1']));
    localStorage.setItem(`${key}__timestamp`, '1700000000000');

    expect(listProgressEntries(STEPS, SHORT_GUIDE)).toHaveLength(1);
  });
});

describe('sweepDiscardedProgressRecords', () => {
  it('removes records in the superseded shape across all four namespaces', () => {
    for (const prefix of [
      StorageKeys.INTERACTIVE_STEPS_PREFIX,
      StorageKeys.SECTION_COLLAPSE_PREFIX,
      StorageKeys.SECTION_ACKNOWLEDGED_PREFIX,
      StorageKeys.SECTION_DONE_PREFIX,
    ]) {
      localStorage.setItem(buildDiscardedSectionStorageKey(prefix, SHORT_GUIDE, 'section-1'), JSON.stringify(true));
      localStorage.setItem(buildDiscardedSectionStorageKey(prefix, LONG_GUIDE, 'section-1'), JSON.stringify(true));
    }

    expect(sweepDiscardedProgressRecords()).toBe(8);
    expect(localStorage.length).toBe(0);
  });

  it('removes the superseded per-content marker', () => {
    localStorage.setItem(buildVersionedContentStorageKey(StorageKeys.CONTENT_PROGRESS_V2_PREFIX, SHORT_GUIDE), 'true');

    expect(sweepDiscardedProgressRecords()).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it('removes the timestamp companions written beside a discarded record', () => {
    const key = discardedKey(SHORT_GUIDE, 'section-1');
    localStorage.setItem(key, JSON.stringify(['step-1']));
    localStorage.setItem(`${key}__timestamp`, '1700000000000');

    expect(sweepDiscardedProgressRecords()).toBe(2);
    expect(localStorage.length).toBe(0);
  });

  it('keeps records in the current shape, and their companions', () => {
    const key = progressSectionKey(STEPS, SHORT_GUIDE, 'section-1');
    localStorage.setItem(key, JSON.stringify(['step-1']));
    localStorage.setItem(`${key}__timestamp`, '1700000000000');
    localStorage.setItem(discardedKey(LONG_GUIDE, 'section-1'), JSON.stringify(['cloud-1']));

    expect(sweepDiscardedProgressRecords()).toBe(1);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(['step-1']);
    expect(localStorage.getItem(`${key}__timestamp`)).toBe('1700000000000');
  });

  it('is safe to run twice', () => {
    localStorage.setItem(discardedKey(SHORT_GUIDE, 'section-1'), JSON.stringify(['step-1']));

    expect(sweepDiscardedProgressRecords()).toBe(1);
    expect(sweepDiscardedProgressRecords()).toBe(0);
  });

  it('leaves every other key this plugin stores untouched', () => {
    // The sweep's blast radius, pinned against the whole key registry rather
    // than a hand-picked sample: badges, the streak and completed guides live
    // under LEARNING_PROGRESS, durable completions under the write queue, and
    // finished milestones under MILESTONE_COMPLETION.
    const untouched = Object.entries(StorageKeys).filter(
      ([name]) =>
        ![
          'INTERACTIVE_STEPS_PREFIX',
          'SECTION_COLLAPSE_PREFIX',
          'SECTION_ACKNOWLEDGED_PREFIX',
          'SECTION_DONE_PREFIX',
          'CONTENT_PROGRESS_V2_PREFIX',
        ].includes(name)
    );
    // Prefix keys are stored with a suffix in production; a bare value stands
    // in for the whole family and is the strictest thing to assert survives.
    untouched.forEach(([name, value]) => localStorage.setItem(value, `keep-${name}`));
    localStorage.setItem(StorageKeys.LEARNING_PROGRESS, JSON.stringify({ earnedBadges: [{ id: 'b' }], streakDays: 7 }));
    localStorage.setItem(`${StorageKeys.COMPLETION_WRITE_QUEUE_PREFIX}pending`, JSON.stringify([{ guide: 'g' }]));
    localStorage.setItem(StorageKeys.MILESTONE_COMPLETION, JSON.stringify({ 'path-1': ['milestone-1'] }));
    const before = { ...localStorage };
    localStorage.setItem(discardedKey(SHORT_GUIDE, 'section-1'), JSON.stringify(['step-1']));

    expect(sweepDiscardedProgressRecords()).toBe(1);

    expect({ ...localStorage }).toEqual(before);
  });

  it('does not touch a key that merely starts like a progress prefix', () => {
    // `…-interactive-completion` opens the same way as
    // `…-interactive-steps-`; only the full prefix may match.
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ [SHORT_GUIDE]: 40 }));

    expect(sweepDiscardedProgressRecords()).toBe(0);
    expect(localStorage.getItem(StorageKeys.INTERACTIVE_COMPLETION)).not.toBeNull();
  });
});
