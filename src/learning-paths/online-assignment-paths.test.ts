/** Resolution rules for the online-catalogue assignment card, run against a mocked package index. */
import type { AssignmentEntry } from '../lib/assignments-client';
import type { OnlinePackageEntry } from '../lib/package-recommendations-client';
import type { ResolvedNavLink } from '../types/context.types';

const mockFetchOnlinePackageRecommendations = jest.fn();
jest.mock('../lib/package-recommendations-client', () => ({
  fetchOnlinePackageRecommendations: () => mockFetchOnlinePackageRecommendations(),
  buildPackageFileUrl: (baseUrl: string, entryPath: string, fileName: string) =>
    `${baseUrl}${entryPath.replace(/^\/|\/$/g, '')}/${fileName}`,
}));

import { resolveOnlineAssignmentCard } from './online-assignment-paths';

function assignment(overrides: Partial<AssignmentEntry> & { targetId: string }): AssignmentEntry {
  return { targetType: 'path', satisfied: false, lifecycle: 'active', ...overrides };
}

function pkg(overrides: Partial<OnlinePackageEntry> & { id: string; path: string }): OnlinePackageEntry {
  return { type: 'guide', ...overrides };
}

const BASE_URL = 'https://interactive-learning.grafana.net/packages/';

// The manifest's milestones use canonical ids ("postgresql-data-source-prepare")
// while the CDN serves each under a differently-named, shared-template URL
// slug ("prepare-configuration") — the drift resolveOnlineAssignmentCard
// exists to translate, mirroring resolveMilestoneGuideID in
// pkg/plugin/package_recommendations.go.
const PACKAGES: OnlinePackageEntry[] = [
  pkg({
    id: 'postgresql-data-source-lj',
    path: 'postgresql-data-source-lj/',
    type: 'path',
    title: 'Connect to PostgreSQL',
  }),
  pkg({
    id: 'postgresql-data-source-prepare',
    path: 'postgresql-data-source-lj/prepare-configuration/',
    title: 'Prepare configuration',
  }),
  pkg({
    id: 'postgresql-data-source-end',
    path: 'postgresql-data-source-lj/end-journey/',
    title: 'Wrap up',
  }),
];

function navLinkFor(manifest: Record<string, unknown>): ResolvedNavLink {
  return { packageId: 'postgresql-data-source-lj', title: 'Connect to PostgreSQL', contentUrl: '', manifest };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchOnlinePackageRecommendations.mockResolvedValue({ baseUrl: BASE_URL, packages: PACKAGES });
});

describe('resolveOnlineAssignmentCard', () => {
  it("translates each milestone id to its sibling entry's URL slug", async () => {
    const manifest = { milestones: ['postgresql-data-source-prepare', 'postgresql-data-source-end'] };
    const resolveNavLinks = jest.fn().mockResolvedValue([navLinkFor(manifest)]);
    const entry = assignment({ targetId: 'postgresql-data-source-lj' });

    const card = await resolveOnlineAssignmentCard(entry, resolveNavLinks);

    expect(card).toBeDefined();
    expect(card!.guides.map((g) => g.guideId)).toEqual(['prepare-configuration', 'end-journey']);
    expect(card!.guides.every((g) => !g.completed && !g.isCurrent)).toBe(true);
    expect(card!.path.guides).toEqual(['prepare-configuration', 'end-journey']);
  });

  it('falls back to the canonical id when a milestone has no sibling index entry', async () => {
    const manifest = { milestones: ['postgresql-data-source-prepare', 'ghost-milestone'] };
    const resolveNavLinks = jest.fn().mockResolvedValue([navLinkFor(manifest)]);
    const entry = assignment({ targetId: 'postgresql-data-source-lj' });

    const card = await resolveOnlineAssignmentCard(entry, resolveNavLinks);

    // "ghost-milestone" isn't itself an indexed package, so it's dropped —
    // mirrors app-platform-paths.ts's published-only gate.
    expect(card!.guides.map((g) => g.guideId)).toEqual(['prepare-configuration']);
  });

  it('returns undefined when the target is not a path-typed package', async () => {
    const resolveNavLinks = jest.fn();
    const entry = assignment({ targetId: 'postgresql-data-source-prepare' }); // a guide, not a path

    const card = await resolveOnlineAssignmentCard(entry, resolveNavLinks);

    expect(card).toBeUndefined();
    expect(resolveNavLinks).not.toHaveBeenCalled();
  });

  it('returns undefined when the target has no manifest to resolve', async () => {
    const resolveNavLinks = jest
      .fn()
      .mockResolvedValue([{ packageId: 'postgresql-data-source-lj', title: 'x', contentUrl: '' }]);
    const entry = assignment({ targetId: 'postgresql-data-source-lj' });

    const card = await resolveOnlineAssignmentCard(entry, resolveNavLinks);

    expect(card).toBeUndefined();
  });
});
