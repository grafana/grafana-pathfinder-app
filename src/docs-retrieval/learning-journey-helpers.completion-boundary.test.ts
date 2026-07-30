/**
 * Completion-recorder boundary wiring tests for `learning-journey-helpers`.
 *
 * These prove the two emitting functions route every terminal completion
 * through the single recorder with manifest-keyed identity, emit exactly once
 * under the double-fire hazards enumerated in the research brief (§4, incl. the
 * PR #689 partial-progress regression), and preserve existing local-cache
 * behavior (markGuideCompleted / milestone storage / path-badge award) exactly.
 *
 * The recorder itself is the REAL module (subscribed via onCompletionRecorded);
 * only storage and the badge coordinator are mocked.
 */
const journeySetMock = jest.fn();
const milestoneMarkCompletedMock = jest.fn();
const milestoneGetCompletedMock = jest.fn();
const awardBadgeMock = jest.fn();
const markGuideCompletedMock = jest.fn();
const getPathsDataMock = jest.fn();

jest.mock('../lib/user-storage', () => ({
  __esModule: true,
  journeyCompletionStorage: { set: (...a: unknown[]) => journeySetMock(...a) },
  milestoneCompletionStorage: {
    markCompleted: (...a: unknown[]) => milestoneMarkCompletedMock(...a),
    getCompleted: (...a: unknown[]) => milestoneGetCompletedMock(...a),
  },
  learningProgressStorage: { awardBadge: (...a: unknown[]) => awardBadgeMock(...a) },
}));

jest.mock('../learning-paths', () => ({
  __esModule: true,
  markGuideCompleted: (...a: unknown[]) => markGuideCompletedMock(...a),
  getPathsData: () => getPathsDataMock(),
}));

import {
  recordStandaloneGuideCompletion,
  setJourneyCompletionPercentage,
  setJourneyCompletionPercentageAsync,
  setMilestoneCompletionPercentage,
  markMilestoneDone,
  resolveExpectedMilestoneIds,
  recordGuideCompletionForSurface,
} from './learning-journey-helpers';
import type { LearningJourneyMetadata, Milestone } from '../types/content.types';
import { onCompletionRecorded, __resetRecorderForTests, type CompletionFact } from '../completion-records';

let emitted: CompletionFact[];
let unsubscribe: () => void;

beforeEach(() => {
  jest.clearAllMocks();
  __resetRecorderForTests();
  emitted = [];
  unsubscribe = onCompletionRecorded((fact) => emitted.push(fact));
  milestoneGetCompletedMock.mockResolvedValue(new Set());
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
});

describe('learning-journey milestone completion (trigger class B / milestone-as-guide)', () => {
  it('routes through the recorder as a learning-journey guide', async () => {
    await markMilestoneDone('https://grafana.com/docs/lp/linux/', 'select-platform');

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      kind: 'guide',
      guideId: 'select-platform',
      guideCategory: 'learning-journey',
    });
  });

  it('preserves local-cache behavior: milestone storage + markGuideCompleted', async () => {
    await markMilestoneDone('base', 'm1');
    expect(milestoneMarkCompletedMock).toHaveBeenCalledWith('base', 'm1');
    expect(markGuideCompletedMock).toHaveBeenCalledWith('m1');
  });

  it('the same milestone marked done from multiple surfaces emits one guide completion', async () => {
    await markMilestoneDone('base', 'm1');
    await markMilestoneDone('base', 'm1');
    expect(emitted.filter((f) => f.kind === 'guide')).toHaveLength(1);
  });

  it('keys the milestone-as-guide fact on the milestone slug and manifest source', async () => {
    await markMilestoneDone('base', 'm1', undefined, {
      packageManifest: { id: 'fe-alerting-01', repository: 'app-platform' },
    });
    expect(emitted[0]).toMatchObject({ guideSource: 'app-platform', guideId: 'm1' });
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
    await markMilestoneDone('base', 'm1', undefined, {
      packageManifest: { id: 'linux-journey', type: 'journey' },
      repository: 'app-platform',
    });

    expect(emitted[0]).toMatchObject({ guideSource: 'app-platform', guideId: 'm1' });
  });

  it('keys the journey fact on the sibling repository from a real V1 shape', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3']));
    getPathsDataMock.mockReturnValue({ paths: [] });

    await markMilestoneDone('base', 'm3', ['m1', 'm2', 'm3'], {
      packageManifest: { id: 'linux-journey', type: 'journey' },
      repository: 'app-platform',
    });

    const journeyEmit = emitted.find((f) => f.kind === 'journey');
    expect(journeyEmit).toMatchObject({ guideSource: 'app-platform', guideId: 'linux-journey' });
  });
});

describe('whole-journey completion (trigger class D — the new journey_completed)', () => {
  it('fires journey_completed once when the final milestone crosses the threshold, and awards the badge', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3']));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3', ['m1', 'm2', 'm3']);

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
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3']));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3', ['m1', 'm2', 'm3'], {
      packageManifest: { id: 'linux-journey', repository: 'app-platform' },
    });

    const guideEmit = emitted.find((f) => f.kind === 'guide');
    const journeyEmit = emitted.find((f) => f.kind === 'journey');
    expect(guideEmit).toMatchObject({ guideSource: 'app-platform', guideId: 'm3' });
    expect(journeyEmit).toMatchObject({ guideSource: 'app-platform', guideId: 'linux-journey' });
  });

  it('fails closed when neither a manifest id nor a curated path id resolves (never keys on the loader URL)', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3']));
    getPathsDataMock.mockReturnValue({ paths: [] });

    await markMilestoneDone('https://grafana.com/docs/learning-journeys/unregistered/', 'm3', ['m1', 'm2', 'm3']);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
    // The milestone-as-guide fact still emits; only the journey fact is skipped.
    expect(emitted.filter((f) => f.kind === 'guide')).toHaveLength(1);
  });

  it('does not fire journey_completed before all milestones are complete', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1']));
    await markMilestoneDone('base', 'm1', ['m1', 'm2', 'm3']);
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });

  it('re-crossing the threshold does not re-emit journey_completed', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3']));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3', ['m1', 'm2', 'm3']);
    await markMilestoneDone('base', 'm2', ['m1', 'm2', 'm3']);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
  });
});

describe('whole-journey membership, not count (journey-threshold-membership)', () => {
  it('does NOT fire when stale slugs inflate the stored set to the milestone COUNT', async () => {
    // The bug this replaces: `completed.size >= totalMilestones` would emit here
    // (size 3 ≥ 3) even though only one CURRENT milestone (m1) is complete.
    milestoneGetCompletedMock.mockResolvedValue(new Set(['old-a', 'old-b', 'm1']));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm1', ['m1', 'm2', 'm3']);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
    expect(awardBadgeMock).not.toHaveBeenCalled();
  });

  it('does NOT fire when a milestone was renamed and its new slug is not yet complete', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3-old']));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm3-old', ['m1', 'm2', 'm3-new']);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });

  it('fires when a milestone was removed and every remaining expected slug is complete', async () => {
    // Stored progress still holds the removed slug; the current expected set no
    // longer includes it, so membership is satisfied by the survivors.
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'removed-c']));
    getPathsDataMock.mockReturnValue({
      paths: [{ id: 'linux-path', title: 'Linux', url: 'base', badgeId: 'linux-badge' }],
    });

    await markMilestoneDone('base', 'm2', ['m1', 'm2']);

    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(1);
    expect(awardBadgeMock).toHaveBeenCalledWith('linux-badge');
  });

  it('does NOT fire when no expected set is provided (fails closed)', async () => {
    milestoneGetCompletedMock.mockResolvedValue(new Set(['m1', 'm2', 'm3']));
    await markMilestoneDone('base', 'm3');
    expect(emitted.filter((f) => f.kind === 'journey')).toHaveLength(0);
  });
});

describe('surface emitter routing matrix (bundled/remote × milestone/standalone)', () => {
  const lj = (slug: string) =>
    ({ milestones: [{ number: 1, title: slug, duration: '5m', url: `https://ex/${slug}/`, isActive: false }] }) as any;
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
        ...lj('select-platform'),
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

  it('remote + milestone → milestone-as-guide fact, no bundled progress write', async () => {
    recordGuideCompletionForSurface({
      baseUrl: 'https://ex/lj',
      contentUrl: 'https://ex/lj',
      currentUrl: 'https://ex/m1/content.json',
      contentType: 'learning-journey',
      metadata: { title: '', packageManifest: { id: 'lj', repository: 'app-platform' }, ...lj('m1') },
      guideTitle: 'LJ',
    });
    await flush();

    const guide = emitted.filter((f) => f.kind === 'guide');
    expect(guide).toHaveLength(1);
    expect(guide[0]).toMatchObject({ guideId: 'm1', guideCategory: 'learning-journey' });
    expect(journeySetMock).not.toHaveBeenCalled();
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

describe('resolveExpectedMilestoneIds', () => {
  function milestone(url: string, number: number): Milestone {
    return { number, title: url, duration: '5 min', url, isActive: false };
  }

  it('maps each milestone URL to its slug, de-duplicated', () => {
    const lj = {
      milestones: [
        milestone('https://grafana.com/docs/lp/linux/select-platform/content.json', 1),
        milestone('https://grafana.com/docs/lp/linux/install-alloy/', 2),
      ],
    } as unknown as LearningJourneyMetadata;
    expect(resolveExpectedMilestoneIds(lj)).toEqual(['select-platform', 'install-alloy']);
  });

  it('returns an empty set when milestones are absent', () => {
    expect(resolveExpectedMilestoneIds(undefined)).toEqual([]);
    expect(resolveExpectedMilestoneIds({ milestones: [] } as unknown as LearningJourneyMetadata)).toEqual([]);
  });
});
