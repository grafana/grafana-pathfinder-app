/**
 * Completion-recorder boundary wiring tests for `learning-journey-helpers`.
 *
 * These prove the two emitting functions route every terminal completion
 * through the single recorder with manifest-keyed identity, emit exactly once
 * under the double-fire hazards enumerated in the research brief (§4, incl. the
 * PR #689 partial-progress regression), and preserve existing local-cache
 * behavior (markGuideCompleted / progress storage / path-badge award) exactly.
 *
 * The recorder itself is the REAL module (subscribed via onCompletionRecorded);
 * only storage and the badge coordinator are mocked.
 */
const journeySetMock = jest.fn();
const milestoneGetCompletedSyncMock: (...a: unknown[]) => Set<string> = jest.fn(() => new Set<string>());
const awardBadgeMock = jest.fn();
const markGuideCompletedMock = jest.fn();
const getPathsDataMock = jest.fn();

const persistedEmitted = new Set<string>();

// Stateful fake for the single consolidated progress store: `set`/`getAll`/
// `peekAll` all read and write the same map, so a milestone a call just
// recorded is visible to that same call's own whole-journey completeness
// check — exactly how the real storage's sync/async read pair behaves.
const interactiveCompletionData = new Map<string, number>();
const interactiveCompletionSetMock = jest.fn((key: string, value: number) => {
  interactiveCompletionData.set(key, value);
  return Promise.resolve();
});
const interactiveCompletionGetAllMock = jest.fn(() => Object.fromEntries(interactiveCompletionData));
const interactiveCompletionPeekAllMock = jest.fn(() => Object.fromEntries(interactiveCompletionData));

jest.mock('../lib/user-storage', () => ({
  __esModule: true,
  journeyCompletionStorage: { set: (...a: unknown[]) => journeySetMock(...a) },
  milestoneCompletionStorage: {
    // Legacy read only — nothing in production writes here anymore
    // (interactiveCompletionStorage is the single store `markMilestoneDone`
    // writes into). Empty by default; a test that wants the legacy-backfill
    // path exercised sets this explicitly.
    getCompletedSync: (...a: unknown[]) => milestoneGetCompletedSyncMock(...a),
  },
  learningProgressStorage: { awardBadge: (...a: unknown[]) => awardBadgeMock(...a) },
  // The recorder's durable dedupe guard. A plain in-memory fake here (rather
  // than the real storage) matches this file's existing "real recorder,
  // mocked storage" split — the recorder's own tests cover the guard itself.
  completionEmittedStorage: {
    isEmitted: (key: string) => persistedEmitted.has(key),
    markEmitted: async (key: string) => {
      persistedEmitted.add(key);
    },
    clear: async (key: string) => {
      persistedEmitted.delete(key);
    },
    clearAll: async () => {
      persistedEmitted.clear();
    },
  },
  // Reset-path plumbing resetGuideProgress also touches, irrelevant to this
  // file's identity-boundary focus — no-op stand-ins so importing it doesn't
  // require re-deriving its whole dependency graph here.
  guideCompletionMarkStorage: { clear: jest.fn().mockResolvedValue(undefined) },
  interactiveCompletionStorage: {
    clear: jest.fn().mockResolvedValue(undefined),
    set: (...a: [string, number]) => interactiveCompletionSetMock(...a),
    getAll: () => Promise.resolve(interactiveCompletionGetAllMock()),
    peekAll: () => interactiveCompletionPeekAllMock(),
  },
  interactiveStepStorage: { clearAllForContent: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../lib/guide-completion-bridge', () => {
  // Delegates to the shipped matching rule so these badge-award assertions
  // exercise it rather than a second copy; only the data source is faked.
  const { matchesPathUrl }: typeof import('../learning-paths/paths-data') =
    jest.requireActual('../learning-paths/paths-data');
  return {
    __esModule: true,
    markGuideCompleted: (...a: unknown[]) => markGuideCompletedMock(...a),
    findPathByUrl: (url: string) =>
      (getPathsDataMock().paths as Array<{ url?: string }>).find((path) => matchesPathUrl(path, url)),
  };
});

jest.mock('../global-state/completion-store', () => ({
  __esModule: true,
  evictContentCache: jest.fn(),
}));

import { of } from 'rxjs';
import { config, setBackendSrv, type BackendSrv } from '@grafana/runtime';
import { fetchBackendInteractive } from './content-fetcher/backend-guide';
import {
  recordStandaloneGuideCompletion,
  setJourneyCompletionPercentage,
  setJourneyCompletionPercentageAsync,
  setMilestoneCompletionPercentage,
  markMilestoneDone,
  recordGuideCompletionForSurface,
  resolveActiveMilestoneSlug,
  getMilestoneSlug,
} from './learning-journey-helpers';
import { resetGuideProgress } from '../components/docs-panel/hooks/resetGuideProgress';
import { onCompletionRecorded, __resetRecorderForTests, type CompletionFact } from '../completion-records';
import {
  fetchCustomGuideRepository,
  invalidateCustomGuideRepositoryCache,
} from '../lib/custom-guide-repository-client';

let emitted: CompletionFact[];
let unsubscribe: () => void;

/** A deterministic per-test milestone URL — the content key `markMilestoneDone`
 *  writes progress under and the whole-journey check reads back. Any unique
 *  string works; this just keeps call sites readable. */
function milestoneUrl(base: string, slug: string): string {
  return `${base}::${slug}`;
}

/** `milestoneUrl` for every slug, in order — the `expectedMilestoneUrls`
 *  argument a real caller derives from `metadata.learningJourney.milestones`. */
function journeyUrls(base: string, slugs: readonly string[]): string[] {
  return slugs.map((slug) => milestoneUrl(base, slug));
}

/** Seeds a milestone as already complete, directly in the shared store —
 *  the SAME namespace `markMilestoneDone` itself writes into, so a milestone
 *  seeded here and one a later call records are indistinguishable. */
function seedMilestoneComplete(url: string): void {
  interactiveCompletionData.set(url, 100);
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetRecorderForTests();
  persistedEmitted.clear();
  interactiveCompletionData.clear();
  emitted = [];
  unsubscribe = onCompletionRecorded((fact) => {
    emitted.push(fact);
    // Stands in for the write queue's durable acceptance, which is what arms
    // the recorder's exactly-once guard.
    return true;
  });
  getPathsDataMock.mockReturnValue({ paths: [] });
});

afterEach(() => {
  unsubscribe();
});

describe('bundled guide reaching 100% (trigger class A)', () => {
  it('routes through the recorder as an interactive guide keyed on the bundled slug', () => {
    setJourneyCompletionPercentage('bundled:first-dashboard', 100);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      kind: 'guide',
      guideSource: 'bundled',
      guideId: 'first-dashboard',
      guideCategory: 'interactive',
      completionPercent: 100,
      source: 'objectives',
    });
    expect(typeof emitted[0]!.completedAt).toBe('string');
  });

  it('keys on the resolved manifest identity when a package manifest is supplied', () => {
    setJourneyCompletionPercentage('bundled:fe-alerting-01', 100, {
      packageManifest: { id: 'fe-alerting-01', repository: 'app-platform' },
      guideTitle: 'Alerting 101',
    });

    expect(emitted[0]).toMatchObject({
      guideSource: 'app-platform',
      guideId: 'fe-alerting-01',
      guideTitle: 'Alerting 101',
    });
  });

  it('preserves local-cache behavior: markGuideCompleted still called', () => {
    setJourneyCompletionPercentage('bundled:foo', 100);
    expect(markGuideCompletedMock).toHaveBeenCalledWith('foo');
    expect(journeySetMock).toHaveBeenCalledWith('bundled:foo', 100);
  });

  it('does NOT emit on partial progress — only terminal (PR #689 regression)', () => {
    setJourneyCompletionPercentage('bundled:foo', 25);
    setJourneyCompletionPercentage('bundled:foo', 50);
    setJourneyCompletionPercentage('bundled:foo', 90);

    expect(emitted).toHaveLength(0);
    expect(markGuideCompletedMock).not.toHaveBeenCalled();
    // Progress storage is still written on every partial update (parity).
    expect(journeySetMock).toHaveBeenCalledTimes(3);
  });

  it('continues to persist ordinal percentages for URL-based journeys', () => {
    setJourneyCompletionPercentage('https://example.com/learning-path/', 50);

    expect(journeySetMock).toHaveBeenCalledWith('https://example.com/learning-path/', 50);
    expect(emitted).toHaveLength(0);
  });

  it('emits exactly once across the whole progress→100 sequence', () => {
    setJourneyCompletionPercentage('bundled:foo', 50);
    setJourneyCompletionPercentage('bundled:foo', 100);
    setJourneyCompletionPercentage('bundled:foo', 100);

    expect(emitted).toHaveLength(1);
  });

  it('does not emit a guide fact for a journey-shaped bundled package (journey trigger owns it)', () => {
    setJourneyCompletionPercentage('bundled:linux-journey', 100, {
      packageManifest: { id: 'linux-journey', repository: 'app-platform', type: 'journey' },
    });

    expect(emitted).toHaveLength(0);
    // Local-cache/UX duty is unchanged — only emission is gated.
    expect(markGuideCompletedMock).toHaveBeenCalledWith('linux-journey');
  });

  it('keeps milestone progress duties separate from milestone emission', () => {
    setMilestoneCompletionPercentage('bundled:select-platform', 100);

    expect(emitted).toHaveLength(0);
    expect(markGuideCompletedMock).toHaveBeenCalledWith('select-platform');
    expect(journeySetMock).toHaveBeenCalledWith('bundled:select-platform', 100);
  });

  it('records a remote standalone guide from its manifest identity', () => {
    recordStandaloneGuideCompletion({
      packageManifest: { id: 'remote-guide', repository: 'app-platform' },
      guideTitle: 'Remote guide',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      guideSource: 'app-platform',
      guideId: 'remote-guide',
      guideTitle: 'Remote guide',
      guideCategory: 'interactive',
    });
  });

  it('does not key a remote standalone guide on its loader URL when no manifest identity resolves', () => {
    recordStandaloneGuideCompletion({ guideTitle: 'Unknown guide' });
    expect(emitted).toHaveLength(0);
  });

  // Reviewer's finding (identity-divergence, guideSource axis, round 3):
  // recordStandaloneGuideCompletion never passed a fallbackSource, so a
  // manifest with an id but NO repository fell through to
  // DEFAULT_GUIDE_SOURCE ('interactive-tutorials'); resetGuideProgress's
  // non-milestone branch hard-coded 'bundled'. The two diverge on guideSource
  // for exactly this shape - a manifest with an id and no repository - which
  // is the mainstream shape for a standalone remote guide, not an edge case.
  it('re-marking after a reset still emits a second record for a standalone guide whose manifest has an id but no repository', async () => {
    const manifest = { id: 'remote-guide-no-repo' };

    recordStandaloneGuideCompletion({ packageManifest: manifest, guideTitle: 'Remote guide' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ guideSource: 'interactive-tutorials', guideId: 'remote-guide-no-repo' });

    // Mirrors useContentReset: no milestoneSlug (this is not a journey
    // milestone), and a non-`bundled:` content key, matching how this guide
    // was actually opened.
    await resetGuideProgress('https://ex/remote-guide-no-repo/content.json', {
      packageManifest: manifest,
    });

    recordStandaloneGuideCompletion({ packageManifest: manifest, guideTitle: 'Remote guide' });

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ guideSource: 'interactive-tutorials', guideId: 'remote-guide-no-repo' });
  });

  // Companion to the omitted-repository case above — an explicit repository
  // must keep agreeing too, not just the default.
  it('re-marking after a reset still emits a second record for a standalone guide whose manifest has an explicit repository', async () => {
    const manifest = { id: 'remote-guide-with-repo', repository: 'app-platform' };

    recordStandaloneGuideCompletion({ packageManifest: manifest, guideTitle: 'Remote guide' });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ guideSource: 'app-platform', guideId: 'remote-guide-with-repo' });

    await resetGuideProgress('https://ex/remote-guide-with-repo/content.json', {
      packageManifest: manifest,
    });

    recordStandaloneGuideCompletion({ packageManifest: manifest, guideTitle: 'Remote guide' });

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ guideSource: 'app-platform', guideId: 'remote-guide-with-repo' });
  });

  it('does not emit a guide fact for a journey-shaped remote package (journey trigger owns it)', () => {
    recordStandaloneGuideCompletion({
      packageManifest: { id: 'remote-journey', repository: 'app-platform', type: 'journey' },
      guideTitle: 'Remote journey',
    });
    expect(emitted).toHaveLength(0);
  });

  it('async twin emits once and preserves local-cache behavior', async () => {
    await setJourneyCompletionPercentageAsync('bundled:foo', 100);
    expect(emitted).toHaveLength(1);
    expect(markGuideCompletedMock).toHaveBeenCalledWith('foo');
  });

  it('async twin also ignores ordinal percentages for backend-guide journeys', async () => {
    await setJourneyCompletionPercentageAsync('backend-guide:linux-path', 50);
    expect(journeySetMock).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });
});

describe('learning-journey milestone completion (trigger class B / milestone-as-guide)', () => {
  it('routes through the recorder as a learning-journey guide', async () => {
    const base = 'https://grafana.com/docs/lp/linux/';
    await markMilestoneDone(base, 'select-platform', milestoneUrl(base, 'select-platform'));

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      kind: 'guide',
      guideId: 'select-platform',
      guideCategory: 'learning-journey',
    });
  });

  it('preserves local-cache behavior: progress storage + markGuideCompleted', async () => {
    const url = milestoneUrl('base', 'm1');
    await markMilestoneDone('base', 'm1', url);
    expect(interactiveCompletionSetMock).toHaveBeenCalledWith(url, 100);
    expect(markGuideCompletedMock).toHaveBeenCalledWith('m1');
  });

  it('records a private App Platform member under its bare id, not the backend-guide: scheme (finding #1)', async () => {
    // The member launch URL is `backend-guide:<id>`; getMilestoneSlug must strip
    // the scheme so completion is keyed the way LearningPath.guides reads it back
    // — otherwise My Learning path progress is stuck at 0%.
    const slug = getMilestoneSlug('backend-guide:fe-alerting-01');
    await markMilestoneDone('base', slug, milestoneUrl('base', slug));
    expect(markGuideCompletedMock).toHaveBeenCalledWith('fe-alerting-01');
  });

  it('the same milestone marked done from multiple surfaces emits one guide completion', async () => {
    const url = milestoneUrl('base', 'm1');
    await markMilestoneDone('base', 'm1', url);
    await markMilestoneDone('base', 'm1', url);
    expect(emitted.filter((f) => f.kind === 'guide')).toHaveLength(1);
  });

  it('keys the milestone-as-guide fact on the milestone slug and manifest source', async () => {
    await markMilestoneDone('base', 'm1', milestoneUrl('base', 'm1'), undefined, {
      packageManifest: { id: 'fe-alerting-01', repository: 'app-platform' },
    });
    expect(emitted[0]).toMatchObject({ guideSource: 'app-platform', guideId: 'm1' });
  });

  // Mainstream shape both earlier fix rounds missed: a manifest is present,
  // and its id ('fe-alerting-01') differs from the milestone slug ('m1'). The
  // reset path must lift the guard under the SAME identity markMilestoneDone
  // wrote it under (app-platform:m1) — not under the manifest id, which is
  // what resolveCompletionIdentity would resolve to if the reset path called
  // it directly with this manifest. Reddens without the reset path deriving
  // milestone identity through resolveMilestoneCompletionIdentity.
  it('re-marking after a reset still emits a second durable record when a manifest is present (pf-cutover-milestone-reset-identity-manifest)', async () => {
    const context = { packageManifest: { id: 'fe-alerting-01', repository: 'app-platform' } };
    const url = milestoneUrl('base', 'm1');
    await markMilestoneDone('base', 'm1', url, undefined, context);
    expect(emitted).toHaveLength(1);

    // The exact predicate recordGuideCompletionForSurface uses to decide a
    // reset target is a milestone — the reset path must derive the same
    // slug this way, not guess at it independently.
    const milestoneSlug = resolveActiveMilestoneSlug({
      currentUrl: 'https://example.com/journey/m1',
      journeyBaseUrl: 'base',
    });
    expect(milestoneSlug).toBe('m1');

    await resetGuideProgress('base', {
      packageManifest: context.packageManifest,
      milestoneSlug,
    });

    await markMilestoneDone('base', 'm1', url, undefined, context);

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ guideSource: 'app-platform', guideId: 'm1' });
  });

  // Reviewer's finding (reset-guard-identity-divergence, round 2): the reset
  // path must not depend on the CALLER correctly classifying the tab as a
  // learning-journey. MyLearningTab.tsx:301-303 launches a path member with
  // its PARENT PATH's manifest ({...parentPath.manifest, id: parentPath.id})
  // and prepareGuideLaunch's own routing classification (isLearningJourneyUrl)
  // returns false for a `backend-guide:` scheme URL — so a caller deriving
  // "is this a milestone" from contentType can disagree with the writer,
  // which never consulted contentType at all. This asserts the agreement
  // holds even when the reset site's contentType is wrong/absent — the fix
  // must key off `journeyBaseUrl` alone, which is always populated once the
  // content resolves, regardless of how the launch route classified the tab.
  it('re-marking after a reset still emits a second record when the reset site cannot classify the tab as a learning-journey (reset-guard-identity-divergence)', async () => {
    // Mirrors MyLearningTab.tsx:301-303 exactly.
    const parentPathManifest = { id: 'my-path', repository: 'app-platform', type: 'path' };
    const context = { packageManifest: parentPathManifest };
    const url = milestoneUrl('backend-guide:my-path', 'milestone-one');

    await markMilestoneDone('backend-guide:my-path', 'milestone-one', url, undefined, context);
    expect(emitted).toHaveLength(1);

    // No contentType passed at all — the reset site must not need it.
    const milestoneSlug = resolveActiveMilestoneSlug({
      currentUrl: 'backend-guide:milestone-one',
      journeyBaseUrl: 'backend-guide:my-path',
    });
    expect(milestoneSlug).toBe('milestone-one');

    await resetGuideProgress('backend-guide:my-path', {
      packageManifest: parentPathManifest,
      milestoneSlug,
    });

    await markMilestoneDone('backend-guide:my-path', 'milestone-one', url, undefined, context);

    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ guideSource: 'app-platform', guideId: 'milestone-one' });
  });
});

describe('real V1 recommendation shape (repository is a manifest sibling)', () => {
  // V1PackageManifest carries `id`/`type` but NOT `repository`; the recommender
  // returns `repository` as a SIBLING of `manifest`. The completion context must
  // thread that sibling separately, or non-default guides corrupt the durable key.
  it('keys a bundled guide on the sibling repository, not a manifest default', () => {
    setJourneyCompletionPercentage('bundled:linux-01', 100, {
      packageManifest: { id: 'linux-01', type: 'guide' },
      repository: 'online-cdn',
      guideTitle: 'Linux',
    });

    expect(emitted[0]).toMatchObject({ guideSource: 'online-cdn', guideId: 'linux-01' });
  });

  it('keys a remote standalone guide on the sibling repository', () => {
    recordStandaloneGuideCompletion({
      packageManifest: { id: 'fe-alerting-01', type: 'guide' },
      repository: 'app-platform',
      guideTitle: 'Alerting',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ guideSource: 'app-platform', guideId: 'fe-alerting-01' });
  });

  it('keys a milestone-as-guide fact on the sibling repository with no manifest repository', async () => {
    await markMilestoneDone('base', 'm1', milestoneUrl('base', 'm1'), undefined, {
      packageManifest: { id: 'linux-journey', type: 'journey' },
      repository: 'app-platform',
    });

    expect(emitted[0]).toMatchObject({ guideSource: 'app-platform', guideId: 'm1' });
  });

  it('keys the journey fact on the sibling repository from a real V1 shape', async () => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);

    await markMilestoneDone('base', 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-journey', type: 'journey' },
      repository: 'app-platform',
    });

    const journeyEmit = emitted.find((f) => f.kind === 'journey');
    expect(journeyEmit).toMatchObject({ guideSource: 'app-platform', guideId: 'linux-journey' });
  });
});

describe('whole-journey completion (trigger class D — the new journey_completed)', () => {
  it('fires journey_completed once when the final milestone crosses the threshold, and awards the badge', async () => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3', urls[2]!, urls);

    const journeyEmits = emitted.filter((f) => f.kind === 'journey');
    expect(journeyEmits).toHaveLength(1);
    expect(journeyEmits[0]).toMatchObject({
      guideCategory: 'learning-journey',
      pathId: 'linux-path',
      completionPercent: 100,
    });
    // Local-cache parity: the path badge is still awarded.
    expect(awardBadgeMock).toHaveBeenCalledWith('linux-badge');
  });

  it('keys the journey fact on the manifest while the milestone fact keys on its slug (no collision)', async () => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-journey', repository: 'app-platform' },
    });

    const guideEmit = emitted.find((f) => f.kind === 'guide');
    const journeyEmit = emitted.find((f) => f.kind === 'journey');
    expect(guideEmit).toMatchObject({ guideSource: 'app-platform', guideId: 'm3' });
    expect(journeyEmit).toMatchObject({ guideSource: 'app-platform', guideId: 'linux-journey' });
  });

  // Journey manifest with id but no repository: resolveJourneyCompletionIdentity
  // omits fallbackSource, so the schema default 'interactive-tutorials' wins
  // (matching standalone guides).
  it('keys a journey manifest with an id and no repository on the schema default', async () => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);
    getPathsDataMock.mockReturnValue({ paths: [] });

    await markMilestoneDone('base', 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-journey', type: 'journey' },
    });

    const journeyEmit = emitted.find((f) => f.kind === 'journey');
    expect(journeyEmit).toMatchObject({ guideSource: 'interactive-tutorials', guideId: 'linux-journey' });
  });

  it('fails closed when neither a manifest id nor a curated path id resolves (never keys on the loader URL)', async () => {
    const base = 'https://grafana.com/docs/learning-journeys/unregistered/';
    const urls = journeyUrls(base, ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);

    await markMilestoneDone(base, 'm3', urls[2]!, urls);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
    // The milestone-as-guide fact still emits; only the journey fact is skipped.
    expect(emitted.filter((f) => f.kind === 'guide')).toHaveLength(1);
  });

  it('does not fire journey_completed before all milestones are complete', async () => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    await markMilestoneDone('base', 'm1', urls[0]!, urls);
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });

  it('re-crossing the threshold does not re-emit journey_completed', async () => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3', urls[2]!, urls);
    await markMilestoneDone('base', 'm2', urls[1]!, urls);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });

  it('persists terminal completion for a backend-guide journey under its base key', async () => {
    const base = 'backend-guide:linux-path';
    const urls = journeyUrls(base, ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);

    await markMilestoneDone(base, 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-path', type: 'journey' },
      repository: 'app-platform',
    });

    expect(journeySetMock).toHaveBeenCalledTimes(1);
    expect(journeySetMock).toHaveBeenCalledWith(base, 100);
    expect(emitted.filter((f) => f.kind === 'guide')).toHaveLength(1);
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });

  it('does not persist terminal completion before every backend-guide milestone is complete', async () => {
    const base = 'backend-guide:linux-path';
    const urls = journeyUrls(base, ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);

    await markMilestoneDone(base, 'm2', urls[1]!, urls, {
      packageManifest: { id: 'linux-path', type: 'journey' },
      repository: 'app-platform',
    });

    expect(journeySetMock).not.toHaveBeenCalled();
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });

  it('does not replace terminal backend-guide completion with an ordinal percentage', async () => {
    const base = 'backend-guide:linux-path';
    const urls = journeyUrls(base, ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);

    await markMilestoneDone(base, 'm3', urls[2]!, urls, {
      packageManifest: { id: 'linux-path', type: 'journey' },
      repository: 'app-platform',
    });
    setJourneyCompletionPercentage(base, 33);

    expect(journeySetMock).toHaveBeenCalledTimes(1);
    expect(journeySetMock).toHaveBeenCalledWith(base, 100);
  });

  it('does not treat the final backend-guide ordinal as terminal completion', () => {
    setJourneyCompletionPercentage('backend-guide:linux-path', 100);

    expect(journeySetMock).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });
});

describe('whole-journey membership, not count (journey-threshold-membership)', () => {
  it('does NOT fire journey_completed merely because unrelated stored entries pad the count to the milestone total', async () => {
    // The bug this replaces: a size/count-based threshold would fire once
    // enough UNRELATED entries existed, even though only one CURRENT
    // milestone (m1) is complete. Membership over the exact expected URLs
    // is immune to this by construction, but the unrelated entries are kept
    // here to prove they're ignored, not merely absent.
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(milestoneUrl('base', 'old-a'));
    seedMilestoneComplete(milestoneUrl('base', 'old-b'));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm1', urls[0]!, urls);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
    expect(awardBadgeMock).not.toHaveBeenCalled();
  });

  it('does NOT fire when a milestone was renamed and its new slug is not yet complete', async () => {
    const oldUrl = milestoneUrl('base', 'm3-old');
    const newExpectedUrls = journeyUrls('base', ['m1', 'm2', 'm3-new']);
    seedMilestoneComplete(newExpectedUrls[0]!);
    seedMilestoneComplete(newExpectedUrls[1]!);
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3-old', oldUrl, newExpectedUrls);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });

  it('fires when a milestone was removed and every remaining expected URL is complete', async () => {
    // Stored progress still holds the removed milestone's URL; the current
    // expected set no longer includes it, so membership is satisfied by the
    // survivors.
    const urls = journeyUrls('base', ['m1', 'm2']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(milestoneUrl('base', 'removed-c'));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm2', urls[1]!, urls);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
    expect(awardBadgeMock).toHaveBeenCalledWith('linux-badge');
  });

  it('does NOT fire when no expected set is provided (fails closed)', async () => {
    seedMilestoneComplete(milestoneUrl('base', 'm1'));
    seedMilestoneComplete(milestoneUrl('base', 'm2'));
    await markMilestoneDone('base', 'm3', milestoneUrl('base', 'm3'));
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });
});

describe('surface emitter routing matrix (bundled/remote × milestone/standalone)', () => {
  const lj = (slug: string, baseUrl: string) =>
    ({
      learningJourney: {
        baseUrl,
        currentMilestone: 1,
        totalMilestones: 1,
        milestones: [{ number: 1, title: slug, duration: '5m', url: `https://ex/${slug}/`, isActive: false }],
      },
    }) as any;
  // markMilestoneDone is fire-and-forget with internal awaits; drain the queue.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('bundled + milestone → milestone-as-guide fact + bundled progress write, no standalone', async () => {
    recordGuideCompletionForSurface({
      baseUrl: 'bundled:linux',
      contentUrl: 'bundled:linux',
      currentUrl: 'https://ex/select-platform/content.json',
      contentType: 'learning-journey',
      metadata: {
        title: '',
        packageManifest: { id: 'linux-journey', repository: 'app-platform' },
        ...lj('select-platform', 'bundled:linux'),
      },
      guideTitle: 'LJ',
    });
    await flush();

    const guide = emitted.filter((f) => f.kind === 'guide');
    expect(guide).toHaveLength(1);
    expect(guide[0]).toMatchObject({ guideId: 'select-platform', guideCategory: 'learning-journey' });
    expect(journeySetMock).toHaveBeenCalledWith('bundled:linux', 100);
  });

  it('bundled + non-milestone → bundled guide fact, not standalone', () => {
    recordGuideCompletionForSurface({
      baseUrl: 'bundled:foo',
      contentUrl: 'bundled:foo',
      contentType: 'docs',
      metadata: { title: '' },
      guideTitle: 'Foo',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ guideSource: 'bundled', guideId: 'foo', guideCategory: 'interactive' });
    expect(journeySetMock).toHaveBeenCalledWith('bundled:foo', 100);
  });

  it('remote + non-milestone → standalone guide fact keyed on the manifest, no bundled write', () => {
    recordGuideCompletionForSurface({
      baseUrl: 'https://ex/g',
      contentUrl: 'https://ex/g/content.json',
      currentUrl: 'https://ex/g/content.json',
      contentType: 'docs',
      metadata: { title: '', packageManifest: { id: 'remote-1', repository: 'app-platform' } },
      guideTitle: 'R',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ guideId: 'remote-1', guideCategory: 'interactive' });
    expect(journeySetMock).not.toHaveBeenCalled();
  });

  it('remote + milestone → milestone-as-guide fact, and refreshes journeyCompletionStorage for the recommendation card (journey-percentage-diverges-on-recommendation-card)', async () => {
    recordGuideCompletionForSurface({
      baseUrl: 'https://ex/lj',
      contentUrl: 'https://ex/lj',
      currentUrl: 'https://ex/m1/content.json',
      contentType: 'learning-journey',
      metadata: { title: '', packageManifest: { id: 'lj', repository: 'app-platform' }, ...lj('m1', 'https://ex/lj') },
      guideTitle: 'LJ',
    });
    await flush();

    const guide = emitted.filter((f) => f.kind === 'guide');
    expect(guide).toHaveLength(1);
    expect(guide[0]).toMatchObject({ guideId: 'm1', guideCategory: 'learning-journey' });
    // This journey is not `bundled:`, so the OLD bundled-progress write never
    // fires here — but the recommendation card's completionPercentage
    // (context.service.ts) reads this same journeyCompletionStorage key
    // directly, never the shared calculation, so it must be refreshed on
    // every milestone completion rather than only on the journey's next load.
    expect(journeySetMock).toHaveBeenCalledWith('https://ex/lj', expect.any(Number));
  });
});

describe('milestone opened directly (surface base is the milestone, not the journey cover)', () => {
  const COVER = 'https://ex/lp/linux/';
  const MILESTONE = 'https://ex/lp/linux/install-alloy/content.json';
  const FIRST = 'https://ex/lp/linux/select-platform/content.json';
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  function completeLastMilestoneFromRecommendationsTab() {
    recordGuideCompletionForSurface({
      // Opening a milestone from the recommendations panel pins the tab's
      // baseUrl to the MILESTONE url, not the journey cover.
      baseUrl: MILESTONE,
      contentUrl: MILESTONE,
      currentUrl: MILESTONE,
      contentType: 'learning-journey',
      metadata: {
        title: 'Install Alloy',
        packageManifest: { id: 'linux-journey', repository: 'app-platform', type: 'journey' },
        learningJourney: {
          currentMilestone: 2,
          totalMilestones: 2,
          baseUrl: COVER,
          milestones: [
            { number: 1, title: 'Select platform', url: FIRST, isActive: false },
            { number: 2, title: 'Install Alloy', url: MILESTONE, isActive: true },
          ],
        },
      },
      guideTitle: 'Install Alloy',
    });
  }

  it("stores milestone progress under the milestone's own URL, its guide-ID-keyed content key", async () => {
    completeLastMilestoneFromRecommendationsTab();
    await flush();

    expect(interactiveCompletionSetMock).toHaveBeenCalledWith(MILESTONE, 100);
  });

  it('satisfies the expected-set check, awards the path badge, and fires the journey record', async () => {
    seedMilestoneComplete(FIRST);
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: COVER, badgeId: 'linux-badge' }],
    });

    completeLastMilestoneFromRecommendationsTab();
    await flush();

    expect(awardBadgeMock).toHaveBeenCalledWith('linux-badge');
    const journey = emitted.filter((f) => f.kind === 'journey');
    expect(journey).toHaveLength(1);
    expect(journey[0]).toMatchObject({
      guideSource: 'app-platform',
      guideId: 'linux-journey',
      pathId: 'linux-path',
      completionPercent: 100,
    });
  });

  it('still fires the journey record when a locked/unresolvable member (empty url) is among the milestones', async () => {
    seedMilestoneComplete(FIRST);
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: COVER, badgeId: 'linux-badge' }],
    });

    recordGuideCompletionForSurface({
      baseUrl: MILESTONE,
      contentUrl: MILESTONE,
      currentUrl: MILESTONE,
      contentType: 'learning-journey',
      metadata: {
        title: 'Install Alloy',
        packageManifest: { id: 'linux-journey', repository: 'app-platform', type: 'journey' },
        learningJourney: {
          currentMilestone: 2,
          totalMilestones: 3,
          baseUrl: COVER,
          milestones: [
            { number: 1, title: 'Select platform', url: FIRST, isActive: false },
            { number: 2, title: 'Install Alloy', url: MILESTONE, isActive: true },
            { number: 3, title: 'Unpublished member', url: '', isActive: false, isLocked: true },
          ],
        },
      },
      guideTitle: 'Install Alloy',
    });
    await flush();

    expect(awardBadgeMock).toHaveBeenCalledWith('linux-badge');
    const journey = emitted.filter((f) => f.kind === 'journey');
    expect(journey).toHaveLength(1);
  });
});

describe('surface emitter carries the resolved repository end-to-end (repository-identity-authority)', () => {
  it('keys the emitted fact on the resolved repository, not the manifest schema default', () => {
    // As it arrives at the surface: content.metadata carries the manifest (whose
    // repository is the schema default) AND the resolved top-level repository.
    recordGuideCompletionForSurface({
      baseUrl: 'https://cdn.example.com/g',
      contentUrl: 'https://cdn.example.com/g/content.json',
      currentUrl: 'https://cdn.example.com/g/content.json',
      contentType: 'docs',
      metadata: {
        title: 'Linux',
        packageManifest: { id: 'linux-01', repository: 'interactive-tutorials', type: 'guide' },
        repository: 'online-cdn',
      },
      guideTitle: 'Linux',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ guideSource: 'online-cdn', guideId: 'linux-01' });
  });
});

// Durable completion identity for the launch surfaces that thread the raw
// catalogue manifest. Un-normalized, these two shapes split the durable key
// against resolver-path launches of the same guide: an omitted `repository`
// lands on fallbackSource 'bundled', and the CLI's stamped default lands on
// 'interactive-tutorials'.
describe('catalogue-launched path (App Platform provenance)', () => {
  const GAP_TOGGLE = 'aggregation.pathfinderbackend-ext-grafana-app.enabled';
  const featureToggles = config.featureToggles as Record<string, boolean>;

  async function launchManifestFromCatalogue(manifest: Record<string, unknown>): Promise<Record<string, unknown>> {
    featureToggles[GAP_TOGGLE] = true;
    invalidateCustomGuideRepositoryCache();
    setBackendSrv({
      get: async () => ({ capability: { available: true }, guides: [{ id: 'fe-alerting-path', manifest }] }),
    } as unknown as BackendSrv);

    const [entry] = await fetchCustomGuideRepository('stacks-123');
    return { ...entry!.manifest, id: entry!.id };
  }

  afterEach(() => {
    delete featureToggles[GAP_TOGGLE];
    invalidateCustomGuideRepositoryCache();
  });

  it.each([
    ['omits repository entirely', undefined],
    ["carries the CLI's interactive-tutorials default", 'interactive-tutorials'],
  ])("records journey completion as 'app-platform' when the catalogue manifest %s", async (_label, repository) => {
    const urls = journeyUrls('base', ['m1', 'm2', 'm3']);
    seedMilestoneComplete(urls[0]!);
    seedMilestoneComplete(urls[1]!);
    const packageManifest = await launchManifestFromCatalogue({
      type: 'path',
      milestones: ['m1', 'm2', 'm3'],
      ...(repository != null && { repository }),
    });

    await markMilestoneDone('base', 'm3', urls[2]!, urls, { packageManifest });

    expect(emitted.find((f) => f.kind === 'journey')).toMatchObject({
      guideSource: 'app-platform',
      guideId: 'fe-alerting-path',
    });
  });
});

// A private guide started from the "other guides" list, a `?doc=api:<id>` share
// link, or auto-dock tab restore carries no packageInfo, so the loader is the
// only thing that can supply an identity. Drives the real loader rather than a
// hand-written manifest so the two halves cannot drift apart silently.
describe('standalone private guide opened straight off the backend-guide: scheme', () => {
  async function loadStandalonePrivateGuide(id: string, spec: Record<string, unknown> = {}) {
    (config as { namespace?: string }).namespace = 'stacks-123';
    setBackendSrv({
      fetch: () =>
        of({
          data: { spec: { id, title: 'Solo guide', blocks: [{ type: 'markdown', content: '# hi' }], ...spec } },
        }),
    } as unknown as BackendSrv);

    const result = await fetchBackendInteractive(`backend-guide:${id}`);
    return result.content!;
  }

  it('records the completion keyed on the App Platform guide id', async () => {
    const content = await loadStandalonePrivateGuide('fe-solo-01');

    recordGuideCompletionForSurface({
      baseUrl: `backend-guide:fe-solo-01`,
      contentUrl: content.url,
      currentUrl: content.url,
      contentType: content.type,
      metadata: content.metadata,
      guideTitle: 'Solo guide',
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      kind: 'guide',
      guideSource: 'app-platform',
      guideId: 'fe-solo-01',
      guideCategory: 'interactive',
      completionPercent: 100,
    });
    expect(journeySetMock).not.toHaveBeenCalled();
  });

  it('emits no guide fact for a path cover, so a path is never recorded as a standalone guide', async () => {
    const content = await loadStandalonePrivateGuide('fe-alerting-path', {
      manifest: { type: 'path', milestones: ['m1', 'm2'] },
    });

    recordGuideCompletionForSurface({
      baseUrl: `backend-guide:fe-alerting-path`,
      contentUrl: content.url,
      currentUrl: content.url,
      contentType: content.type,
      metadata: content.metadata,
      guideTitle: 'Alerting path',
    });

    expect(emitted).toHaveLength(0);
  });
});

describe('malformed journey metadata (defensive boundary)', () => {
  // A present `learningJourney` with no `milestones` array is malformed —
  // the type claims `Milestone[]` is always there, but nothing validates
  // that at this boundary, and `.filter` on `undefined` throws. A throw here
  // means markMilestoneDone never runs at all: no progress write, no badge,
  // no journey_completed, for a reader who otherwise did everything right.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('does not throw when learningJourney is present but milestones is missing', async () => {
    expect(() =>
      recordGuideCompletionForSurface({
        baseUrl: 'bundled:linux',
        contentUrl: 'bundled:linux',
        currentUrl: 'https://ex/select-platform/content.json',
        contentType: 'learning-journey',
        metadata: {
          title: '',
          packageManifest: { id: 'linux-journey', repository: 'app-platform' },
          learningJourney: {
            baseUrl: 'bundled:linux',
            currentMilestone: 1,
            totalMilestones: 1,
            milestones: undefined,
          },
        } as any,
        guideTitle: 'LJ',
      })
    ).not.toThrow();
    await flush();

    // The milestone-as-guide fact still emits — only the (absent) whole-journey
    // membership check is skipped, since there is nothing to check membership
    // of a locked-milestone filter this input can't provide.
    const guide = emitted.filter((f) => f.kind === 'guide');
    expect(guide).toHaveLength(1);
    expect(guide[0]).toMatchObject({ guideId: 'select-platform' });
  });
});
