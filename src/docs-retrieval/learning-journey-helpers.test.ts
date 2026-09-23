/**
 * Milestone traversal tests focused on locked-milestone skip behavior
 * (RFC CUSTOM-GUIDE-PACKAGES.md §6.5) — a path whose next/previous member
 * hasn't published yet must not dead-end the toolbar.
 */
import {
  countUnlockedMilestones,
  generateJourneyContentWithExtras,
  getJourneyProgress,
  getMilestoneSlug,
  getNextMilestoneId,
  getNextMilestoneUrl,
  getPreviousMilestoneId,
  journeyMilestonePercentages,
  getPreviousMilestoneUrl,
  isLastMilestone,
} from './learning-journey-helpers';
import { StorageKeys } from '../lib/storage-keys';
import type { RawContent, Milestone, LearningJourneyMetadata, CoverPageTrack } from '../types/content.types';

function milestone(number: number, overrides: Partial<Milestone> = {}): Milestone {
  return {
    number,
    title: `Milestone ${number}`,
    url: `backend-guide:milestone-${number}`,
    isActive: false,
    ...overrides,
  };
}

function journeyContent(
  currentMilestone: number,
  milestones: Milestone[],
  baseUrl = 'backend-guide:path',
  tracks?: CoverPageTrack[]
): RawContent {
  return {
    content: '',
    type: 'learning-journey',
    url: 'backend-guide:path',
    lastFetched: new Date().toISOString(),
    metadata: {
      title: 'Test path',
      learningJourney: {
        currentMilestone,
        totalMilestones: milestones.length,
        milestones,
        baseUrl,
        ...(tracks && { tracks }),
      },
    },
  };
}

describe('getMilestoneSlug', () => {
  it('strips the backend-guide: scheme so private members key on the bare id (finding #1)', () => {
    expect(getMilestoneSlug('backend-guide:fe-alerting-01')).toBe('fe-alerting-01');
  });

  it('leaves path-style doc URLs untouched (last segment)', () => {
    expect(getMilestoneSlug('https://grafana.com/docs/learning-paths/linux/select-platform/')).toBe('select-platform');
    expect(getMilestoneSlug('https://grafana.com/docs/.../select-platform/content.json')).toBe('select-platform');
  });
});

function ljMetadata(currentMilestone: number, milestones: Milestone[]): LearningJourneyMetadata {
  return {
    title: 'Test path',
    currentMilestone,
    totalMilestones: milestones.length,
    milestones,
    baseUrl: 'backend-guide:path',
  } as LearningJourneyMetadata;
}

describe('countUnlockedMilestones', () => {
  it('counts only unlocked (navigable) milestones', () => {
    expect(countUnlockedMilestones([milestone(1), milestone(2, { isLocked: true, url: '' }), milestone(3)])).toBe(2);
  });
});

// Decision 4: a journey's percentage is the mean of its unlocked milestones'
// own percentages — a navigation position no longer. Storage is real
// (localStorage-backed) here; both stores getJourneyProgress reads
// (interactiveCompletionStorage, milestoneCompletionStorage) resolve
// synchronously straight from localStorage, with no @grafana/runtime needed.
describe('getJourneyProgress', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function setPersistedPercentages(record: Record<string, number>): void {
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify(record));
  }

  function setCompletedMilestoneSlugs(journeyBaseUrl: string, slugs: string[]): void {
    localStorage.setItem(StorageKeys.MILESTONE_COMPLETION, JSON.stringify({ [journeyBaseUrl]: slugs }));
  }

  it('is 0% for a journey with no unlocked milestones', () => {
    const content = journeyContent(0, [milestone(1, { isLocked: true, url: '' })]);
    expect(getJourneyProgress(content)).toBe(0);
  });

  it('is 0% for an unopened journey, before any milestone has a record', () => {
    const content = journeyContent(0, [milestone(1), milestone(2)]);
    expect(getJourneyProgress(content)).toBe(0);
  });

  it("reads the doc's worked example end to end — four milestones at 100/25/0/0 reads 31%", () => {
    const m1 = milestone(1, { url: 'backend-guide:m1' });
    const m2 = milestone(2, { url: 'backend-guide:m2' });
    const m3 = milestone(3, { url: 'backend-guide:m3' });
    const m4 = milestone(4, { url: 'backend-guide:m4' });
    const content = journeyContent(2, [m1, m2, m3, m4]);

    setCompletedMilestoneSlugs(content.metadata.learningJourney!.baseUrl, [getMilestoneSlug(m1.url)!]);
    setPersistedPercentages({ [m2.url]: 25 });

    expect(getJourneyProgress(content)).toBe(31);
  });

  it('does not advance just because the reader navigated to a later milestone', () => {
    // The old formula was `currentMilestone / totalMilestones`, which read
    // 100% on the last milestone of a ten-milestone journey with nothing
    // completed. The mean must not reproduce that.
    const milestones = Array.from({ length: 10 }, (_, i) => milestone(i + 1, { url: `backend-guide:m${i + 1}` }));
    const content = journeyContent(10, milestones);

    expect(getJourneyProgress(content)).toBe(0);
  });

  it('excludes a locked milestone from both halves of the mean', () => {
    const m1 = milestone(1, { url: 'backend-guide:m1' });
    const locked = milestone(2, { isLocked: true, url: '' });
    const content = journeyContent(1, [m1, locked]);

    setCompletedMilestoneSlugs(content.metadata.learningJourney!.baseUrl, [getMilestoneSlug(m1.url)!]);

    // If the locked milestone counted in the denominator this would be 50%.
    expect(getJourneyProgress(content)).toBe(100);
  });

  it('sees a milestone completion stored under a milestone-URL alias, as the cover page does', () => {
    // The cover page's own async read passes the milestone URLs, so without
    // them here the same milestone reads completed on one screen and 0% on
    // the percentage beside it.
    const m1 = milestone(1, { url: 'bundled:demo-milestone/content.json' });
    const content = journeyContent(1, [m1], 'bundled:demo-cover/content.json');

    localStorage.setItem(StorageKeys.MILESTONE_COMPLETION, JSON.stringify({ [m1.url]: [getMilestoneSlug(m1.url)] }));

    expect(getJourneyProgress(content)).toBe(100);
  });

  it('reads 100 for a member in the completed set even with no persisted percentage', () => {
    const m1 = milestone(1, { url: 'backend-guide:m1' });
    const content = journeyContent(1, [m1]);

    setCompletedMilestoneSlugs(content.metadata.learningJourney!.baseUrl, [getMilestoneSlug(m1.url)!]);

    expect(getJourneyProgress(content)).toBe(100);
  });
});

// The per-member half of the same calculation, which the toolbar's segmented
// bar paints one mark per milestone from — so a segment and the journey
// percentage can never disagree about a milestone.
describe('journeyMilestonePercentages', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reports each unlocked milestone in journey order, locked ones omitted', () => {
    const m1 = milestone(1, { url: 'backend-guide:m1' });
    const m2 = milestone(2, { url: 'backend-guide:m2' });
    const locked = milestone(3, { isLocked: true, url: '' });

    localStorage.setItem(StorageKeys.MILESTONE_COMPLETION, JSON.stringify({ 'backend-guide:path': ['m1'] }));
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ 'backend-guide:m2': 40 }));

    expect(journeyMilestonePercentages('backend-guide:path', [m1, m2, locked])).toEqual([
      { milestone: m1, percent: 100 },
      { milestone: m2, percent: 40 },
    ]);
  });

  it('reports zero for a milestone the reader has only navigated to', () => {
    const m1 = milestone(1, { url: 'backend-guide:m1' });
    const m2 = milestone(2, { url: 'backend-guide:m2' });

    expect(journeyMilestonePercentages('backend-guide:path', [m1, m2]).map((entry) => entry.percent)).toEqual([0, 0]);
  });

  it('is the set the journey percentage is the mean of', () => {
    const m1 = milestone(1, { url: 'backend-guide:m1' });
    const m2 = milestone(2, { url: 'backend-guide:m2' });
    localStorage.setItem(StorageKeys.INTERACTIVE_COMPLETION, JSON.stringify({ 'backend-guide:m1': 50 }));

    const percentages = journeyMilestonePercentages('backend-guide:path', [m1, m2]);

    expect(percentages.map((entry) => entry.percent)).toEqual([50, 0]);
    expect(getJourneyProgress(journeyContent(1, [m1, m2]))).toBe(25);
  });
});

describe('isLastMilestone (locked-aware)', () => {
  it('is true on the last UNLOCKED milestone even when locked entries follow', () => {
    const content = journeyContent(2, [milestone(1), milestone(2), milestone(3, { isLocked: true, url: '' })]);
    expect(isLastMilestone(content)).toBe(true);
  });

  it('is false on a milestone that still has an unlocked successor', () => {
    const content = journeyContent(1, [milestone(1), milestone(2), milestone(3)]);
    expect(isLastMilestone(content)).toBe(false);
  });
});

describe('generateJourneyContentWithExtras — locked-milestone handling', () => {
  it('cover CTA targets the first UNLOCKED milestone, not a locked milestone 1', () => {
    const html = generateJourneyContentWithExtras(
      '',
      ljMetadata(0, [milestone(1, { isLocked: true, url: '' }), milestone(2, { url: 'backend-guide:m2' })])
    );
    expect(html).toContain('data-milestone-url="backend-guide:m2"');
    expect(html).not.toContain('data-milestone-url=""');
  });

  it('omits the cover CTA entirely when nothing is published yet', () => {
    const html = generateJourneyContentWithExtras(
      '',
      ljMetadata(0, [milestone(1, { isLocked: true, url: '' }), milestone(2, { isLocked: true, url: '' })])
    );
    expect(html).not.toContain('data-journey-start');
  });

  it('hides the bottom "Next →" when every remaining milestone is locked', () => {
    const html = generateJourneyContentWithExtras(
      '',
      ljMetadata(2, [milestone(1), milestone(2), milestone(3, { isLocked: true, url: '' })])
    );
    expect(html).not.toContain('Next →');
  });

  it('still renders "Next →" when an unlocked successor exists', () => {
    const html = generateJourneyContentWithExtras('', ljMetadata(1, [milestone(1), milestone(2), milestone(3)]));
    expect(html).toContain('Next →');
  });

  // The React cover-page hero (LearningPathTableOfContents) already renders
  // its own Resume/Start CTA and, once a tab is selected, the sticky
  // toolbar's own Next/Previous cover the same job — this legacy block
  // duplicated both, and its own Next/Previous ignored Path Tracks tab
  // selection entirely (captain-reported bug; see cover-page.ts).
  it('omits the bottom nav entirely on the cover page, regardless of skipReadyToBegin', () => {
    const metadata = ljMetadata(0, [milestone(1), milestone(2)]);
    expect(generateJourneyContentWithExtras('', metadata, false)).not.toContain('journey-bottom-navigation');
    expect(generateJourneyContentWithExtras('', metadata, true)).not.toContain('journey-bottom-navigation');
  });

  it('still renders the bottom nav on a real milestone', () => {
    const html = generateJourneyContentWithExtras('', ljMetadata(1, [milestone(1), milestone(2), milestone(3)]));
    expect(html).toContain('journey-bottom-navigation');
  });
});

describe('getNextMilestoneUrl', () => {
  it('returns the immediate next milestone when it is resolved', () => {
    const content = journeyContent(1, [milestone(1), milestone(2), milestone(3)]);
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-2');
  });

  it('skips a locked next milestone and returns the next resolved one', () => {
    const content = journeyContent(1, [milestone(1), milestone(2, { isLocked: true, url: '' }), milestone(3)]);
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-3');
  });

  it('skips a run of consecutive locked milestones', () => {
    const content = journeyContent(1, [
      milestone(1),
      milestone(2, { isLocked: true, url: '' }),
      milestone(3, { isLocked: true, url: '' }),
      milestone(4),
    ]);
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-4');
  });

  it('returns null when every remaining milestone is locked', () => {
    const content = journeyContent(1, [milestone(1), milestone(2, { isLocked: true, url: '' })]);
    expect(getNextMilestoneUrl(content)).toBeNull();
  });

  it('returns null when already on the last milestone', () => {
    const content = journeyContent(2, [milestone(1), milestone(2)]);
    expect(getNextMilestoneUrl(content)).toBeNull();
  });

  it('returns null for non-journey content', () => {
    const content: RawContent = {
      content: '',
      type: 'single-doc',
      url: 'x',
      lastFetched: new Date().toISOString(),
      metadata: { title: 'x' },
    };
    expect(getNextMilestoneUrl(content)).toBeNull();
  });
});

describe('getPreviousMilestoneUrl', () => {
  it('returns the immediate previous milestone when it is resolved', () => {
    const content = journeyContent(2, [milestone(1), milestone(2), milestone(3)]);
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:milestone-1');
  });

  it('skips a locked previous milestone and returns the nearest resolved one', () => {
    const content = journeyContent(3, [milestone(1), milestone(2, { isLocked: true, url: '' }), milestone(3)]);
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:milestone-1');
  });

  it('falls back to the cover page (baseUrl) when every prior milestone is locked', () => {
    const content = journeyContent(2, [milestone(1, { isLocked: true, url: '' }), milestone(2)], 'backend-guide:cover');
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:cover');
  });

  it('returns the cover page (baseUrl) from milestone 1', () => {
    const content = journeyContent(1, [milestone(1), milestone(2)], 'backend-guide:cover');
    expect(getPreviousMilestoneUrl(content)).toBe('backend-guide:cover');
  });

  it('returns null when already on the cover page (milestone 0)', () => {
    const content = journeyContent(0, [milestone(1), milestone(2)]);
    expect(getPreviousMilestoneUrl(content)).toBeNull();
  });
});

// Path Tracks: a selected track tab on the cover page should redirect
// Next/Previous into that track's own guides instead of always falling
// through to the Foundations `milestones` sequence — the bug the captain
// flagged live (Builder tab selected and 100% complete, but the toolbar's
// Next arrow still landed on Foundations "Introduction").
describe('getNextMilestoneUrl / getNextMilestoneId — active track selection', () => {
  const builderTrack = (): CoverPageTrack => ({
    trackId: 'builder',
    label: 'Builder',
    milestones: [
      { number: 1, title: 'Builder one', url: 'backend-guide:builder-one', isActive: false, id: 'builder-one' },
      { number: 2, title: 'Builder two', url: 'backend-guide:builder-two', isActive: false, id: 'builder-two' },
    ],
  });

  it('resolves next within the active track on the cover page, not Foundations', () => {
    const content = journeyContent(0, [milestone(1), milestone(2)], 'backend-guide:cover', [builderTrack()]);
    expect(getNextMilestoneUrl(content, 'builder')).toBe('backend-guide:builder-one');
    expect(getNextMilestoneId(content, 'builder')).toBe('builder-one');
  });

  it('falls back to Foundations when no track is active', () => {
    const content = journeyContent(0, [milestone(1), milestone(2)], 'backend-guide:cover', [builderTrack()]);
    expect(getNextMilestoneUrl(content, null)).toBe('backend-guide:milestone-1');
    expect(getNextMilestoneUrl(content)).toBe('backend-guide:milestone-1');
  });

  it('falls back to Foundations for an unknown track id', () => {
    const content = journeyContent(0, [milestone(1), milestone(2)], 'backend-guide:cover', [builderTrack()]);
    expect(getNextMilestoneUrl(content, 'seller')).toBe('backend-guide:milestone-1');
  });

  it('falls back to Foundations past the cover when the loaded guide is not one of the active track\'s own guides', () => {
    // No `activeTrackMilestones` passed (the caller has nothing persisted for
    // this track), and the loaded guide's own URL isn't in the track — so
    // there is nothing to resolve the reader's position against, and this
    // stays on the in-progress Foundations traversal.
    const content = journeyContent(1, [milestone(1), milestone(2)], 'backend-guide:cover', [builderTrack()]);
    expect(getNextMilestoneUrl(content, 'builder')).toBe('backend-guide:milestone-2');
  });

  it('stays track-aware past the cover when the active track is threaded through as activeTrackMilestones', () => {
    // The captain's exact reported failure: a track guide that shares its
    // URL/position with a Foundations milestone must not silently fall back
    // to Foundations for Next/Previous once the reader is inside it —
    // `activeTrackMilestones` is what the caller persists across milestone
    // loads (content.metadata.learningJourney.tracks is cover-page-only).
    const foundations = [
      milestone(1),
      milestone(2, { url: 'backend-guide:shared' }),
      milestone(3),
    ];
    const track: CoverPageTrack = {
      trackId: 'builder',
      label: 'Builder',
      milestones: [
        { number: 1, title: 'Builder one', url: 'backend-guide:builder-one', isActive: false, id: 'builder-one' },
        { number: 2, title: 'Shared', url: 'backend-guide:shared', isActive: false, id: 'shared' },
        { number: 3, title: 'Builder three', url: 'backend-guide:builder-three', isActive: false, id: 'builder-three' },
      ],
    };
    const content: RawContent = {
      ...journeyContent(2, foundations, 'backend-guide:cover'),
      url: 'backend-guide:shared',
    };

    expect(getNextMilestoneUrl(content, 'builder', track.milestones)).toBe('backend-guide:builder-three');
    expect(getNextMilestoneId(content, 'builder', track.milestones)).toBe('builder-three');
  });

  it('skips a locked entry within the active track the same way Foundations does', () => {
    const track: CoverPageTrack = {
      trackId: 'builder',
      label: 'Builder',
      milestones: [
        { number: 1, title: 'Locked', url: '', isActive: false, isLocked: true },
        { number: 2, title: 'Builder two', url: 'backend-guide:builder-two', isActive: false, id: 'builder-two' },
      ],
    };
    const content = journeyContent(0, [milestone(1)], 'backend-guide:cover', [track]);
    expect(getNextMilestoneUrl(content, 'builder')).toBe('backend-guide:builder-two');
  });
});

describe('getPreviousMilestoneUrl — active track selection', () => {
  it('stays null on the cover page regardless of the active track (nothing before the cover)', () => {
    const track: CoverPageTrack = {
      trackId: 'builder',
      label: 'Builder',
      milestones: [{ number: 1, title: 'Builder one', url: 'backend-guide:builder-one', isActive: false }],
    };
    const content = journeyContent(0, [milestone(1), milestone(2)], 'backend-guide:cover', [track]);
    expect(getPreviousMilestoneUrl(content, 'builder')).toBeNull();
    expect(getPreviousMilestoneId(content, 'builder')).toBeUndefined();
  });

  it('stays track-aware past the cover when the active track is threaded through as activeTrackMilestones', () => {
    const foundations = [milestone(1), milestone(2, { url: 'backend-guide:shared' }), milestone(3)];
    const track: CoverPageTrack = {
      trackId: 'builder',
      label: 'Builder',
      milestones: [
        { number: 1, title: 'Builder one', url: 'backend-guide:builder-one', isActive: false, id: 'builder-one' },
        { number: 2, title: 'Shared', url: 'backend-guide:shared', isActive: false, id: 'shared' },
        { number: 3, title: 'Builder three', url: 'backend-guide:builder-three', isActive: false, id: 'builder-three' },
      ],
    };
    const content: RawContent = {
      ...journeyContent(2, foundations, 'backend-guide:cover'),
      url: 'backend-guide:shared',
    };

    expect(getPreviousMilestoneUrl(content, 'builder', track.milestones)).toBe('backend-guide:builder-one');
    expect(getPreviousMilestoneId(content, 'builder', track.milestones)).toBe('builder-one');
  });
});
