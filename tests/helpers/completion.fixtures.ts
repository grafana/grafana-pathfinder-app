/**
 * Deterministic guide and path fixtures for the completion-tracking suite,
 * served to the browser through `page.route` stubs.
 *
 * The suite asserts arithmetic (a percentage, a mean) and identity (a
 * `(guideSource, guideId)` pair), so the content behind each assertion has to
 * be fixed. Published content is not: the CDN index changes, block counts
 * change with it, and a milestone can be republished under a different
 * manifest. Every fixture here therefore declares its own manifest and its own
 * block list, and the expected denominators are derived from those blocks with
 * the canonical counter rather than written down.
 */

import { computeGuideBlockIndex, type CountableBlock } from '../../src/lib/guide-stats/block-index';

/**
 * Where the stubbed package index points. Must stay on an
 * `interactive-learning.grafana` host: `isTrustedFinalUrl` rejects anything
 * else before the content fetch, so a made-up hostname would fail the
 * security check rather than the assertion.
 */
export const CDN_BASE_URL = 'https://interactive-learning.grafana.net/packages/';

/**
 * `repository` on every fixture manifest. Neither `bundled` nor the
 * `interactive-tutorials` schema default, so an assertion on `guideSource`
 * fails loudly if identity resolution falls through to either.
 */
export const FIXTURE_REPOSITORY = 'e2e-completion-fixtures';

/** A target that exists on every Grafana page, with no requirement to satisfy first. */
const ALWAYS_PRESENT_TARGET = "[data-testid='data-testid Command palette trigger']";

/** A fixture block: a countable block plus whatever runtime fields its type carries. */
type FixtureBlock = CountableBlock & Record<string, unknown>;

export interface PackageFixture {
  id: string;
  type: 'guide' | 'path';
  title: string;
  description: string;
  /** Milestone package ids, for a `path`. */
  milestones?: string[];
  blocks: FixtureBlock[];
  /** `false` omits `repository` from the served manifest. Defaults to declaring it. */
  declaresRepository?: boolean;
}

function prose(label: string, ordinal: number): FixtureBlock {
  return { type: 'markdown', content: `${label} prose block ${ordinal}.` };
}

function highlightStep(label: string, ordinal: number): FixtureBlock {
  return {
    type: 'interactive',
    action: 'highlight',
    reftarget: ALWAYS_PRESENT_TARGET,
    content: `**${label} step ${ordinal}** — highlights the command palette trigger.`,
  };
}

/**
 * Five counted blocks, the second and third completable. Completing the first
 * step evidences position 2 of 5; the trailing prose is what keeps 100%
 * reachable only through Mark complete, which is the shape most of the real
 * library has (COMPLETION-MODEL.md, decision 2).
 */
function guideBlocks(label: string): FixtureBlock[] {
  return [prose(label, 1), highlightStep(label, 1), highlightStep(label, 2), prose(label, 2), prose(label, 3)];
}

/** The standalone guide cases 2, 6 and 7 complete. */
export const STANDALONE_GUIDE: PackageFixture = {
  id: 'e2e-completion-guide',
  type: 'guide',
  title: 'E2E completion guide',
  description: 'Standalone guide fixture for the completion-tracking suite.',
  blocks: guideBlocks('Guide'),
};

/** Members of the four-milestone path cases 1 and 3 walk. */
export const PATH_MILESTONE_COUNT = 4;

const PATH_MILESTONE_IDS = Array.from(
  { length: PATH_MILESTONE_COUNT },
  (_unused, index) => `e2e-completion-path-milestone-${index + 1}`
);

export const PATH_FIXTURE: PackageFixture = {
  id: 'e2e-completion-path',
  type: 'path',
  title: 'E2E completion path',
  description: 'Four-milestone path fixture for the completion-tracking suite.',
  milestones: PATH_MILESTONE_IDS,
  blocks: [prose('Path cover', 1)],
};

export const PATH_MILESTONES: PackageFixture[] = PATH_MILESTONE_IDS.map((id, index) => ({
  id,
  type: 'guide' as const,
  title: `Milestone ${index + 1}`,
  description: `Milestone ${index + 1} of the E2E completion path.`,
  blocks: guideBlocks(`Milestone ${index + 1}`),
}));

/**
 * A path whose manifest declares an id and NO repository — the shape the
 * whole-path record's identity derivation is sensitive to.
 */
const NO_REPOSITORY_MILESTONE_COUNT = 4;

const NO_REPOSITORY_MILESTONE_IDS = Array.from(
  { length: NO_REPOSITORY_MILESTONE_COUNT },
  (_unused, index) => `e2e-sourceless-path-milestone-${index + 1}`
);

export const NO_REPOSITORY_PATH: PackageFixture = {
  id: 'e2e-sourceless-path',
  type: 'path',
  title: 'E2E sourceless path',
  description: 'Path fixture whose manifest declares no repository.',
  milestones: NO_REPOSITORY_MILESTONE_IDS,
  blocks: [prose('Sourceless path cover', 1)],
  declaresRepository: false,
};

const NO_REPOSITORY_MILESTONES: PackageFixture[] = NO_REPOSITORY_MILESTONE_IDS.map((id, index) => ({
  id,
  type: 'guide' as const,
  title: `Sourceless milestone ${index + 1}`,
  description: `Milestone ${index + 1} of the E2E sourceless path.`,
  blocks: [prose(`Sourceless milestone ${index + 1}`, 1)],
  declaresRepository: false,
}));

/**
 * A private App Platform guide, reached through a `?doc=api:<id>` share link.
 * Its id deliberately stays out of {@link ALL_FIXTURES}: the composite package
 * resolver consults the CDN tier before the App Platform one, so an id present
 * in the stubbed catalogue would be answered by the CDN tier and the launch
 * would never exercise the App Platform loader at all.
 */
export const APP_PLATFORM_GUIDE: PackageFixture = {
  id: 'fe-e2e-completion-guide',
  type: 'guide',
  title: 'Private E2E completion guide',
  description: 'App Platform guide fixture for the completion-tracking suite.',
  blocks: guideBlocks('Private guide'),
};

/** The repository an App Platform guide is always keyed on, forced by its loader. */
export const APP_PLATFORM_REPOSITORY = 'app-platform';

export const ALL_FIXTURES: PackageFixture[] = [
  STANDALONE_GUIDE,
  PATH_FIXTURE,
  ...PATH_MILESTONES,
  NO_REPOSITORY_PATH,
  ...NO_REPOSITORY_MILESTONES,
];

/**
 * A bundled guide with two live launch shapes for one guide: My Learning and
 * deep links open it bare, the package resolver and a restored tab open it by
 * package path. Both must record the same identity.
 */
export const BUNDLED_GUIDE_ID = 'welcome-to-grafana';
export const BUNDLED_GUIDE_TITLE = 'Welcome to Grafana';
export const BUNDLED_REPOSITORY = 'bundled';

/** The content URL a fixture is launched from, matching `buildPackageFileUrl`. */
export function fixtureContentUrl(fixture: PackageFixture): string {
  return `${CDN_BASE_URL}${fixture.id}/content.json`;
}

/**
 * The completion denominator for a fixture, from the canonical counter — the
 * same function that stamps `stats.blockCount` at publish. Derived, never
 * written down, so editing a fixture's blocks cannot leave a stale
 * expectation behind.
 */
export function fixtureBlockCount(fixture: PackageFixture): number {
  return computeGuideBlockIndex(fixture.blocks).totalBlockCount;
}

/** 1-based position of the fixture's nth completable block. */
export function fixtureCompletablePosition(fixture: PackageFixture, ordinal: number): number {
  const completable = computeGuideBlockIndex(fixture.blocks).blocks.filter((block) => block.completable);
  const target = completable[ordinal - 1];
  if (!target) {
    throw new Error(`Fixture ${fixture.id} has no completable block at ordinal ${ordinal}`);
  }
  return target.position;
}

/**
 * The percentage the completion model says a guide reads at an evidenced
 * position: `position / totalBlockCount`, with 100 reserved for a guide that
 * actually reached its last block (`guideProgressAtPosition`, decision 1).
 */
export function expectedPercentAtPosition(fixture: PackageFixture, position: number): number {
  const total = fixtureBlockCount(fixture);
  if (position >= total) {
    return 100;
  }
  return Math.min(99, Math.floor((position / total) * 100));
}

/** The manifest the stub serves, both inlined in the index and at `manifest.json`. */
export function fixtureManifest(fixture: PackageFixture): Record<string, unknown> {
  return {
    id: fixture.id,
    type: fixture.type,
    ...(fixture.declaresRepository === false ? {} : { repository: FIXTURE_REPOSITORY }),
    description: fixture.description,
    category: 'testing',
    startingLocation: '/',
    ...(fixture.milestones ? { milestones: fixture.milestones } : {}),
  };
}

/** The content.json the stub serves for a fixture. */
export function fixtureContent(fixture: PackageFixture): Record<string, unknown> {
  return {
    schemaVersion: '1.0.0',
    id: fixture.id,
    title: fixture.title,
    blocks: fixture.blocks,
  };
}

/** The `GET /package-recommendations` body the stub serves. */
export function fixtureCatalogue(fixtures: PackageFixture[] = ALL_FIXTURES): Record<string, unknown> {
  return {
    baseUrl: CDN_BASE_URL,
    packages: fixtures.map((fixture) => ({
      id: fixture.id,
      path: `${fixture.id}/`,
      title: fixture.title,
      description: fixture.description,
      type: fixture.type,
      manifest: fixtureManifest(fixture),
    })),
  };
}
