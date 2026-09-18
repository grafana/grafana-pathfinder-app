/**
 * Real-storage regression tests for two review findings on the milestone
 * progress consolidation (PR #1925, round 2):
 *
 * - pf-1925-backfill-lost-updates: `journeyMilestonePercentages`'s legacy
 *   backfill fired one unawaited `interactiveCompletionStorage.set` per
 *   legacy-complete milestone. `set()` does its own read-modify-write of the
 *   single shared JSON record (`bounded-record-storage.test.ts` characterizes
 *   the hazard directly), so two in flight at once lost one of them, and the
 *   whole-journey membership check could then never see it. A mocked storage
 *   that mutates a Map synchronously (`learning-journey-helpers.completion-boundary.test.ts`)
 *   can't reproduce that timing — this file uses the real, localStorage-backed
 *   store instead.
 * - pf-1925-milestone-url-roundtrip: `markMilestoneDone` wrote under the
 *   launch URL's own content key while the whole-journey check and the cover
 *   page read the manifest's own milestone URL. A `.../content.json` launch
 *   and the manifest's trailing-slash URL for the same milestone sanitize to
 *   different keys, so a completion recorded under one was invisible to a
 *   reader keyed on the other.
 */
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'stacks-123' },
  usePluginUserStorage: jest.fn(),
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  reportInteraction: jest.fn(),
}));

const getPathsDataMock = jest.fn();

jest.mock('../lib/guide-completion-bridge', () => {
  // Delegates to the shipped matching rule so the badge assertion below
  // exercises it rather than a second copy; only the path list is faked.
  const { matchesPathUrl }: typeof import('../learning-paths/paths-data') =
    jest.requireActual('../learning-paths/paths-data');
  return {
    __esModule: true,
    markGuideCompleted: jest.fn().mockResolvedValue(undefined),
    findPathByUrl: (url: string) =>
      (getPathsDataMock().paths as Array<{ url?: string; badgeId?: string; id?: string }>).find((path) =>
        matchesPathUrl(path, url)
      ),
  };
});

jest.mock('../global-state/completion-store', () => ({
  __esModule: true,
  evictContentCache: jest.fn(),
}));

import { interactiveCompletionStorage, milestoneCompletionStorage, learningProgressStorage } from '../lib/user-storage';
import {
  markMilestoneDone,
  journeyMilestonePercentages,
  resetMilestoneBackfillGuardForTests,
} from './learning-journey-helpers';
import { onCompletionRecorded, __resetRecorderForTests, type CompletionFact } from '../completion-records';
import type { Milestone } from '../types/content.types';

function milestone(number: number, url: string): Milestone {
  return { number, title: `Milestone ${number}`, url, isActive: false };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

let emitted: CompletionFact[];
let unsubscribe: () => void;

beforeEach(() => {
  localStorage.clear();
  __resetRecorderForTests();
  resetMilestoneBackfillGuardForTests();
  getPathsDataMock.mockReturnValue({ paths: [] });
  emitted = [];
  unsubscribe = onCompletionRecorded((fact) => {
    emitted.push(fact);
    return true;
  });
});

afterEach(() => {
  unsubscribe();
});

describe('legacy milestone backfill against real storage (pf-1925-backfill-lost-updates)', () => {
  it('persists every legacy-complete milestone, and the whole-journey completion still fires once the last one completes', async () => {
    const base = 'https://grafana.com/docs/learning-journeys/linux/';
    const urls = [`${base}m1/`, `${base}m2/`, `${base}m3/`];
    const milestones = [milestone(1, urls[0]!), milestone(2, urls[1]!), milestone(3, urls[2]!)];

    // Two milestones already complete in the LEGACY store only — the shape a
    // learner who used the product before this PR shipped is in.
    await milestoneCompletionStorage.markCompleted(base, 'm1');
    await milestoneCompletionStorage.markCompleted(base, 'm2');

    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', url: base, badgeId: 'linux-badge' }],
    });

    // The cover page / toolbar read that triggers the backfill — fires two
    // queued writes (m1, m2) without either being awaited by the caller.
    journeyMilestonePercentages(base, milestones);

    // A repeated read a moment later, before the last milestone completes —
    // must not re-race or duplicate the still-in-flight backfill.
    journeyMilestonePercentages(base, milestones);

    // Complete the final milestone through the real write path. Its own
    // write is serialized behind the backfill, so by the time it checks
    // whole-journey membership, both backfilled milestones are visible.
    await markMilestoneDone(base, 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-path', type: 'journey' },
    });

    await flush();

    const stored = await interactiveCompletionStorage.getAll();
    expect(stored[urls[0]!]).toBe(100);
    expect(stored[urls[1]!]).toBe(100);
    expect(stored[urls[2]!]).toBe(100);

    // Badge and durable journey record both fire — the membership check
    // saw every milestone, not just the last write to survive.
    const progress = await learningProgressStorage.get();
    expect(progress.earnedBadges.some((b) => b.id === 'linux-badge')).toBe(true);
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });
});

describe('milestone content-key round trip across launch URL variants (pf-1925-milestone-url-roundtrip)', () => {
  it('reconciles a content.json launch to the manifest URL for both the whole-journey check and the cover page read', async () => {
    const base = 'https://grafana.com/docs/learning-journeys/linux/';
    // The manifest's own (canonical) milestone URLs — what the cover page and
    // the whole-journey membership check both use.
    const canonicalUrls = [`${base}m1/`, `${base}m2/`, `${base}m3/`];
    const milestones = [
      milestone(1, canonicalUrls[0]!),
      milestone(2, canonicalUrls[1]!),
      milestone(3, canonicalUrls[2]!),
    ];

    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', url: base, badgeId: 'linux-badge' }],
    });

    const context = { packageManifest: { id: 'linux-path', type: 'journey' } };

    // m1 launched via the package-content-json variant — a different string
    // (and, pre-fix, a different content key) than the manifest's own URL.
    await markMilestoneDone(base, 'm1', `${base}m1/content.json`, canonicalUrls, context);
    await markMilestoneDone(base, 'm2', canonicalUrls[1]!, canonicalUrls, context);

    // Before the fix, m1's completion is invisible under the manifest key:
    // the cover page would still show it incomplete and lock m3.
    const beforeLast = journeyMilestonePercentages(base, milestones);
    expect(beforeLast.find((p) => p.milestone.number === 1)?.percent).toBe(100);

    await markMilestoneDone(base, 'm3', canonicalUrls[2]!, canonicalUrls, context);
    await flush();

    // Only ONE key was ever written for m1 — under the canonical URL, not a
    // second one under the content.json launch variant.
    const stored = await interactiveCompletionStorage.getAll();
    expect(stored[canonicalUrls[0]!]).toBe(100);
    expect(stored[`${base}m1/content.json`]).toBeUndefined();

    const progress = await learningProgressStorage.get();
    expect(progress.earnedBadges.some((b) => b.id === 'linux-badge')).toBe(true);
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });
});

describe('whole-journey completion without a prior backfill read (Cursor Bugbot round-3 finding 2)', () => {
  it('sees earlier legacy-only milestones even when journeyMilestonePercentages never ran first', async () => {
    // GuideReaderOverlay renders no LearningJourneyMilestoneToolbar and calls
    // no cover-page read, so journeyMilestonePercentages — the only other
    // place a legacy completion backfills into interactiveCompletionStorage —
    // never runs for a journey read exclusively through that surface. m1 and
    // m2 are legacy-complete but this test never calls journeyMilestonePercentages
    // at all before completing m3, unlike the earlier "legacy milestone
    // backfill" case above.
    const base = 'https://grafana.com/docs/learning-journeys/linux/';
    const urls = [`${base}m1/`, `${base}m2/`, `${base}m3/`];

    await milestoneCompletionStorage.markCompleted(base, 'm1');
    await milestoneCompletionStorage.markCompleted(base, 'm2');

    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', url: base, badgeId: 'linux-badge' }],
    });

    await markMilestoneDone(base, 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-path', type: 'journey' },
    });
    await flush();

    const progress = await learningProgressStorage.get();
    expect(progress.earnedBadges.some((b) => b.id === 'linux-badge')).toBe(true);
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });
});

describe('markMilestoneDone racing an unqueued direct write (Cursor Bugbot round-3 finding 1)', () => {
  it('keeps both keys when a Mark-complete-style direct set() fires concurrently with markMilestoneDone', async () => {
    // Simulates MarkCompleteFooter.tsx / completion-store.ts: a caller
    // outside this module writing straight to interactiveCompletionStorage,
    // fire-and-forget, at the same moment this module completes a different
    // milestone. Neither goes through this module's own queue — the
    // guarantee has to come from interactiveCompletionStorage itself.
    const base = 'https://grafana.com/docs/learning-journeys/linux/';
    const urls = [`${base}m1/`, `${base}m2/`];
    const otherGuideKey = 'https://ex.com/some-other-guide/';

    // One microtask of slack so this genuinely overlaps markMilestoneDone's
    // own write below (which goes through this module's own queue — see
    // queueMilestoneCompletionWrite — adding a hop before it even starts);
    // without it, this direct write's whole read-modify-write cycle can
    // finish before the module's write starts, masking the race this test
    // exists to catch.
    const directWrite = Promise.resolve().then(() => interactiveCompletionStorage.set(otherGuideKey, 100));
    const milestoneWrite = markMilestoneDone(base, 'm1', urls[0]!, urls, {
      packageManifest: { id: 'linux-path', type: 'journey' },
    });
    await Promise.all([directWrite, milestoneWrite]);
    await flush();

    const stored = await interactiveCompletionStorage.getAll();
    expect(stored[otherGuideKey]).toBe(100);
    expect(stored[urls[0]!]).toBe(100);
  });
});
