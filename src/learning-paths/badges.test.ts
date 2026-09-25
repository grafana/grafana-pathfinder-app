import { getBadgeForPath, shouldAwardBadge } from './badges';
import type { Badge, LearningPath, LearningProgress } from '../types/learning-paths.types';

describe('getBadgeForPath', () => {
  it('finds the badge whose path-completed trigger matches the given pathId', () => {
    const badge = getBadgeForPath('linux-server-integration');
    expect(badge?.id).toBe('penguin-wrangler');
  });

  it('returns undefined for a pathId with no matching badge', () => {
    expect(getBadgeForPath('core-grafana-concepts-lj')).toBeUndefined();
  });

  it("does not match a public/CDN package's -lj-suffixed id, since the award path can't earn it either", () => {
    expect(getBadgeForPath('infrastructure-alerting-lj')).toBeUndefined();
  });

  it('ignores badges with a non-path-completed trigger', () => {
    // 'first-steps' is a real badge id but its trigger is 'guide-completed',
    // not 'path-completed' — must not match by id, only by trigger.pathId.
    expect(getBadgeForPath('first-steps')).toBeUndefined();
  });
});

describe('path-completed badge trigger — best-of-sequence (decision 4/10)', () => {
  const FOUNDATIONS = ['found-1', 'found-2', 'found-3'];
  const BUILDER_GUIDES = ['builder-1', 'builder-2', 'builder-3'];

  function tracksPath(): LearningPath {
    return {
      id: 'tracks-demo',
      title: 'Tracks demo',
      description: '',
      guides: [...FOUNDATIONS, ...BUILDER_GUIDES],
      badgeId: '',
      manifest: {
        id: 'tracks-demo',
        type: 'path',
        milestones: FOUNDATIONS,
        tracks: [{ trackId: 'builder', label: 'Builder', guides: BUILDER_GUIDES }],
      },
    };
  }

  const trackDemoBadge: Badge = {
    id: 'tracks-demo-badge',
    title: 'Tracks demo badge',
    description: '',
    icon: 'rocket',
    trigger: { type: 'path-completed', pathId: 'tracks-demo' },
  };

  function progressWith(completedGuides: string[]): LearningProgress {
    return { completedGuides, earnedBadges: [], streakDays: 0, lastActivityDate: '', pendingCelebrations: [] };
  }

  // Previously required progress.completedGuides to cover every guide in
  // every track (the flat pre-decision-4-update union) — a track hitting
  // 100% now awards the badge on its own, matching My Learning's own
  // best-of-sequence completion.
  it('awards the badge once any one sequence is fully complete, even though Foundations is not', () => {
    const progress = progressWith([...BUILDER_GUIDES, 'found-1']);
    expect(shouldAwardBadge(trackDemoBadge, progress, [tracksPath()])).toBe(true);
  });

  it('does not award the badge while no single sequence is fully complete', () => {
    const progress = progressWith(['found-1', 'builder-1']);
    expect(shouldAwardBadge(trackDemoBadge, progress, [tracksPath()])).toBe(false);
  });

  // The existing guard: a URL-based path's static guides: [] must never
  // vacuously satisfy completion.
  it('never awards the badge for a URL-based path (guides: [])', () => {
    const urlPath: LearningPath = {
      id: 'tracks-demo',
      title: 'Tracks demo',
      description: '',
      guides: [],
      badgeId: '',
      url: 'https://grafana.com/docs/learning-paths/tracks-demo/',
    };
    const progress = progressWith([]);
    expect(shouldAwardBadge(trackDemoBadge, progress, [urlPath])).toBe(false);
  });
});
