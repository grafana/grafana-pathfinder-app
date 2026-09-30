import { resolveActiveMilestoneToolbarContext } from './active-milestone-sequence';
import type { RawContent, Milestone } from '../types/content.types';

const baseUrl = 'https://grafana.com/docs/learning-paths/demo/';
const canonicalBaseUrl = 'https://grafana.com/docs/learning-paths/demo-canonical/';
const trackMemberBaseUrl = 'https://grafana.com/docs/learning-paths/demo-track-member/';

const baseMilestones: Milestone[] = [
  { number: 1, title: 'One', url: `${baseUrl}one/`, isActive: false },
  { number: 2, title: 'Two', url: `${baseUrl}two/`, isActive: false },
];

function journeyContent(overrides: Partial<RawContent> = {}): RawContent {
  return {
    content: '{}',
    url: `${baseUrl}one/`,
    type: 'learning-journey',
    metadata: {
      title: 'Demo',
      learningJourney: {
        currentMilestone: 1,
        totalMilestones: baseMilestones.length,
        milestones: baseMilestones,
        baseUrl: canonicalBaseUrl,
      },
    },
    ...overrides,
  } as RawContent;
}

function trackOnlyContent(url: string, overrides: Partial<RawContent> = {}): RawContent {
  return {
    content: '{}',
    url,
    type: 'learning-journey',
    metadata: {
      title: 'Demo',
      trackMemberBaseUrl,
    },
    ...overrides,
  } as RawContent;
}

describe('resolveActiveMilestoneToolbarContext', () => {
  describe('baseUrl precedence', () => {
    it('prefers learningJourney.baseUrl over trackMemberBaseUrl when both are present', () => {
      const content = journeyContent({
        metadata: {
          title: 'Demo',
          learningJourney: {
            currentMilestone: 1,
            totalMilestones: baseMilestones.length,
            milestones: baseMilestones,
            baseUrl: canonicalBaseUrl,
          },
          trackMemberBaseUrl,
        },
      });

      const result = resolveActiveMilestoneToolbarContext(content);

      expect(result?.baseUrl).toBe(canonicalBaseUrl);
    });

    it('falls back to trackMemberBaseUrl when there is no learningJourney at all (a track-only guide)', () => {
      const trackMilestoneUrl = 'https://grafana.com/docs/learning-paths/demo/builder/t1/';
      const trackMilestones: Milestone[] = [
        { number: 1, title: 't1', url: trackMilestoneUrl, isActive: true },
        { number: 2, title: 't2', url: 'https://grafana.com/docs/learning-paths/demo/builder/t2/', isActive: false },
      ];
      const content = trackOnlyContent(trackMilestoneUrl);

      const result = resolveActiveMilestoneToolbarContext(content, 'builder', trackMilestones);

      expect(result).toEqual({
        currentMilestone: 1,
        totalMilestones: 2,
        milestones: trackMilestones,
        baseUrl: trackMemberBaseUrl,
        websiteUrl: undefined,
      });
    });

    it('returns null when there is neither a learningJourney.baseUrl nor a trackMemberBaseUrl to key progress against', () => {
      const content = trackOnlyContent(`${baseUrl}orphan/`, { metadata: { title: 'Demo' } });

      expect(resolveActiveMilestoneToolbarContext(content)).toBeNull();
    });
  });

  describe('active-track-set-but-non-matching fall-through', () => {
    it('falls back to the base sequence when activeTrackId is set but the current URL is not in activeTrackMilestones', () => {
      const unrelatedTrackMilestones: Milestone[] = [
        { number: 1, title: 'Other', url: `${baseUrl}other-track-guide/`, isActive: false },
      ];
      const content = journeyContent();

      const result = resolveActiveMilestoneToolbarContext(content, 'builder', unrelatedTrackMilestones);

      // The base learningJourney fixture says this guide is milestone 1 of 2.
      expect(result).toEqual({
        currentMilestone: 1,
        totalMilestones: 2,
        milestones: baseMilestones,
        baseUrl: canonicalBaseUrl,
        websiteUrl: undefined,
      });
    });

    it('returns null when activeTrackId is set, the URL does not match the track, and there is no learningJourney to fall back to', () => {
      const unrelatedTrackMilestones: Milestone[] = [
        { number: 1, title: 'Other', url: `${baseUrl}other-track-guide/`, isActive: false },
      ];
      const content = trackOnlyContent(`${baseUrl}not-in-the-track/`);

      expect(resolveActiveMilestoneToolbarContext(content, 'builder', unrelatedTrackMilestones)).toBeNull();
    });
  });

  it("resolves the cover-page-with-active-track case from the content's own fresh tracks field", () => {
    const coverTrackMilestones: Milestone[] = [
      { number: 1, title: 't1', url: `${baseUrl}builder/t1/`, isActive: true },
      { number: 2, title: 't2', url: `${baseUrl}builder/t2/`, isActive: false },
    ];
    const content = journeyContent({
      url: baseUrl,
      metadata: {
        title: 'Demo',
        learningJourney: {
          currentMilestone: 0,
          totalMilestones: baseMilestones.length,
          milestones: baseMilestones,
          baseUrl: canonicalBaseUrl,
          tracks: [{ trackId: 'builder', label: 'Builder', milestones: coverTrackMilestones }],
        },
      },
    });

    // A STALE persisted activeTrackMilestones snapshot from a previous cover
    // visit — the cover page must prefer its own fresh `tracks` field instead.
    const staleActiveTrackMilestones: Milestone[] = [
      { number: 1, title: 'Stale', url: `${baseUrl}stale/`, isActive: true },
    ];

    const result = resolveActiveMilestoneToolbarContext(content, 'builder', staleActiveTrackMilestones);

    expect(result).toEqual({
      currentMilestone: 0,
      totalMilestones: 2,
      milestones: coverTrackMilestones,
      baseUrl: canonicalBaseUrl,
      websiteUrl: undefined,
    });
  });

  it('resolves a dual-membership guide to the active track sequence, not the base one', () => {
    const dualTrackMilestones: Milestone[] = [
      { number: 1, title: 'b1', url: `${baseUrl}other/`, isActive: false },
      { number: 2, title: 'b2', url: `${baseUrl}one/`, isActive: true },
    ];
    const content = journeyContent();

    const result = resolveActiveMilestoneToolbarContext(content, 'builder', dualTrackMilestones);

    expect(result).toEqual({
      currentMilestone: 2,
      totalMilestones: 2,
      milestones: dualTrackMilestones,
      baseUrl: canonicalBaseUrl,
      websiteUrl: undefined,
    });
  });

  it('carries learningJourney.websiteUrl through for the base sequence', () => {
    const content = journeyContent({
      metadata: {
        title: 'Demo',
        learningJourney: {
          currentMilestone: 1,
          totalMilestones: baseMilestones.length,
          milestones: baseMilestones,
          baseUrl: canonicalBaseUrl,
          websiteUrl: 'https://grafana.com/docs/learning-paths/demo/',
        },
      },
    });

    expect(resolveActiveMilestoneToolbarContext(content)?.websiteUrl).toBe(
      'https://grafana.com/docs/learning-paths/demo/'
    );
  });
});
