/**
 * Launch-path parity matrix.
 *
 * Grafana Pathfinder opens a guide from many places, and each place builds its
 * own launch request. The common package-context type is `PackageOpenInfo`
 * (src/types/content-panel.types.ts) — `PreparedGuideLaunch` is the only
 * request-shaped type and only My Learning uses it, so no production type spans
 * every launch path. Nothing, therefore, forces those requests to agree, and
 * they have drifted: the same guide opened from two places can key its durable
 * completion under two different repositories.
 *
 * This matrix feeds ONE parsed manifest through every day-one launch path and
 * asserts the normalized requests are identical TO EACH OTHER. It never asserts
 * against an expected value: whoever decides the right answer can change it and
 * this test stays green as long as every path moves together. It fires only on
 * disagreement.
 *
 * Every path calls production code. Where a path's own entry point is module-
 * private (`pendingGuideFrom` in HomePanel), the matrix builds that function's
 * INPUT and runs the real relay from the next exported boundary onward — the
 * package context it carries still comes from a real producer, never from a
 * payload assembled here.
 *
 * Run with `npm run test:parity`. It is deliberately outside the default suite
 * and outside CI: it is a standing diagnostic of a known contract gap, not a
 * merge gate.
 *
 * ---------------------------------------------------------------------------
 * Nine families are in scope across thirteen concrete paths. Two of those paths
 * — a recommendation's start button and its milestone rows — are separate UI
 * entry points that share one producer (`getRecommendationPackageInfo`), so
 * they sit in one family and can never disagree with each other; the matrix
 * covers nine independent producers, not thirteen.
 *
 * Three families are deliberately absent, because each needs a production
 * change before it can produce a comparable request at all:
 *
 *   1. Generic URL-backed journeys and raw guides. The My Learning URL branch
 *      calls `launch` with no package context, and `openLearningJourney`
 *      discards `options.packageInfo` for non-package URLs, so the plain loader
 *      never calls `resolveStartingLocation`. There is no manifest-backed
 *      request to compare — reading `RawContent.metadata.packageManifest` here
 *      would only duplicate the normalization production is missing.
 *
 *   2. Published orphan custom guides. `openCustomGuide` is called without
 *      `PackageOpenInfo`, and supplying one moves the guide from the plain
 *      loader to the package-aware loader — a loader-selection change that
 *      needs its own rendering regression coverage.
 *
 *   3. The controller guide-reader overlay. It calls `fetchUnifiedContent`
 *      directly and stores only `RawContent`, never constructing
 *      `PackageOpenInfo`, `PreparedGuideLaunch`, or `PendingGuide`. It bypasses
 *      the launch pipeline entirely, so there is nothing to normalize until it
 *      is routed through a shared package-aware adapter.
 * ---------------------------------------------------------------------------
 */

jest.mock('@grafana/scenes', () => ({
  SceneObjectBase: class {},
}));

jest.mock('@grafana/runtime', () => ({
  getAppEvents: jest.fn(() => ({ publish: jest.fn() })),
  locationService: { push: jest.fn() },
  // The full-screen handoff reports an interaction on its way through.
  reportInteraction: jest.fn(),
  config: { bootData: { user: { id: 1 } } },
}));

jest.mock('@grafana/i18n', () => ({
  t: jest.fn((_key: string, fallback: string) => fallback),
}));

import { act, renderHook } from '@testing-library/react';

import { packageInfoForNavLink, getRecommendationPackageInfo } from '../../src/components/docs-panel/context-panel';
import { packageInfoForPath } from '../../src/components/docs-panel/CustomGuidesSection';
import { consumePendingGuideOnMount } from '../../src/components/docs-panel/pendingGuideRouter';
import { useAutoOpenListener } from '../../src/components/docs-panel/hooks/useAutoOpenListener';
import { useFullScreenHandoff } from '../../src/components/docs-panel/hooks/useFullScreenHandoff';
import { buildPathPackageInfo } from '../../src/components/PrTester/pr-path-package';
import { fetchPackageInfoFromUrl } from '../../src/docs-retrieval/package-info-from-url';
import { guideLaunchStore } from '../../src/global-state/guide-launch';
import { linkInterceptionState } from '../../src/global-state/link-interception';
import { panelModeManager, type PendingGuide } from '../../src/global-state/panel-mode';
import {
  packageInfoForPathMember,
  packageInfoForDiscoverItem,
  parseDiscoverMoreManifest,
} from '../../src/learning-paths';
import { AUTO_OPEN_DOCS_EVENT } from '../../src/lib/event-names';
import { ManifestJsonObjectSchema } from '../../src/types/package.schema';
import type { PackageOpenInfo } from '../../src/types/content-panel.types';
import type { Milestone, RawContent } from '../../src/types/content.types';

import { assertSymmetric, type IntentionalDifference, type SymmetryEntry } from './symmetry';

// ---------------------------------------------------------------------------
// The one guide every path is handed
// ---------------------------------------------------------------------------

const PACKAGE_ID = 'grafana-fundamentals';
const TITLE = 'Grafana fundamentals';
const CONTENT_URL = `https://interactive-learning.grafana.net/packages/${PACKAGE_ID}/content.json`;
const MANIFEST_URL = `https://interactive-learning.grafana.net/packages/${PACKAGE_ID}/manifest.json`;
const CATALOG_BASE_URL = 'https://interactive-learning.grafana.net';
const MILESTONE_IDS = ['fundamentals-intro', 'fundamentals-dashboards'];

/**
 * The package's true source, carried OUTSIDE the manifest. This models a real
 * online-CDN package: `V1Recommendation.repository` is a sibling of `manifest`,
 * and online-CDN resolution assigns `online-cdn`. Paths that accept a
 * repository input get this value.
 */
const TRUE_REPOSITORY = 'online-cdn';

/**
 * Complete against `ManifestJsonObjectSchema` except for `repository`, which is
 * absent on purpose — a V1 manifest does not carry its own provenance, and the
 * schema defaults the missing field to `interactive-tutorials`. Every other
 * defaulted field is spelled out so a schema parse is otherwise a no-op and the
 * matrix cannot fail on incidental default-filling. `assertFixtureCompleteness`
 * below holds that property.
 */
const MANIFEST: Record<string, unknown> = {
  schemaVersion: '1.0.0',
  id: PACKAGE_ID,
  type: 'path',
  milestones: MILESTONE_IDS,
  description: 'Learn the fundamentals of Grafana.',
  language: 'en',
  startingLocation: '/connections',
  depends: [],
  recommends: [],
  suggests: [],
  provides: [],
  conflicts: [],
  replaces: [],
  testEnvironment: { tier: 'cloud' },
};

const MILESTONES: Milestone[] = MILESTONE_IDS.map((id, index) => ({
  number: index + 1,
  title: id,
  duration: '',
  url: `${CATALOG_BASE_URL}/packages/${id}/content.json`,
  isActive: false,
}));

const PREPARED_CONTENT: RawContent = {
  content: JSON.stringify({ id: PACKAGE_ID, title: TITLE, blocks: [] }),
  metadata: { title: TITLE },
  type: 'interactive',
  url: CONTENT_URL,
  lastFetched: '2026-08-25T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * The comparable core of a launch request: which package, whose manifest, under
 * which repository the guide's completion will be keyed, and which milestones
 * the launch arrives pre-resolved with.
 *
 * `resolvedMilestones` is compared rather than excluded. Whether a launch
 * carries pre-resolved milestones decides whether the milestone toolbar renders
 * populated on first paint, so a path that stops pre-resolving them has changed
 * the request — calling it a per-caller caching choice would let that change
 * land unreported.
 */
interface NormalizedLaunchRequest {
  packageId: string | undefined;
  repository: string | undefined;
  packageManifest: Record<string, unknown> | undefined;
  resolvedMilestones: Milestone[] | undefined;
}

function normalize(info: PackageOpenInfo | undefined): NormalizedLaunchRequest {
  return {
    packageId: info?.packageId,
    repository: info?.repository,
    packageManifest: info?.packageManifest,
    resolvedMilestones: info?.resolvedMilestones,
  };
}

/**
 * Fixture guard, not a parity assertion. Proves the only field the schema fills
 * in is `repository`; if the schema gains another default, this fails here with
 * a clear cause instead of showing up as unexplained noise in the matrix.
 */
function assertFixtureCompleteness(): void {
  const parsed = ManifestJsonObjectSchema.parse(MANIFEST) as Record<string, unknown>;
  const added = Object.keys(parsed).filter((key) => !(key in MANIFEST) && parsed[key] !== undefined);
  expect(added).toEqual(['repository']);
  const schemaDefault = ManifestJsonObjectSchema.parse({ id: PACKAGE_ID, type: 'guide' }) as Record<string, unknown>;
  expect(parsed.repository).toBe(schemaDefault.repository);
}

// ---------------------------------------------------------------------------
// Test doubles for the relay destinations (inputs only — never payloads)
// ---------------------------------------------------------------------------

interface CapturingPanel {
  state: { tabs: unknown[]; activeTabId: string | undefined };
  openDocsPage: jest.Mock;
  openLearningJourney: jest.Mock;
  openEditorTab: jest.Mock;
  setActiveTab: jest.Mock;
}

function capturingPanel(): CapturingPanel {
  return {
    state: { tabs: [], activeTabId: undefined },
    openDocsPage: jest.fn(),
    openLearningJourney: jest.fn(),
    openEditorTab: jest.fn(),
    setActiveTab: jest.fn(),
  };
}

/** The packageInfo the panel was actually asked to open with. */
function openedWith(panel: CapturingPanel): PackageOpenInfo | undefined {
  const call = panel.openDocsPage.mock.calls[0] ?? panel.openLearningJourney.mock.calls[0];
  if (!call) {
    throw new Error('relay did not open anything — the launch was dropped');
  }
  return (call[2] as { packageInfo?: PackageOpenInfo } | undefined)?.packageInfo;
}

function drainQueue(): void {
  while (linkInterceptionState.hasQueuedLinks()) {
    linkInterceptionState.shiftFromQueue();
  }
}

/** Mirrors HomePanel's module-private `pendingGuideFrom`, minus the payload. */
function pendingFrom(packageInfo: PackageOpenInfo | undefined): PendingGuide {
  return {
    url: CONTENT_URL,
    title: TITLE,
    type: 'docs',
    packageInfo,
    preparedContent: PREPARED_CONTENT,
    source: 'home_page',
  } as PendingGuide;
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/**
 * Divergences that are known, accepted, and tracked. Empty by design: every
 * disagreement this matrix currently reports is a real contract gap, not an
 * intentional difference. Adding an entry here to quiet a failure — rather than
 * because the divergence is genuinely correct — defeats the test.
 */
const INTENTIONAL_PATH_DIFFERENCES: readonly IntentionalDifference[] = [];

describe('launch-path parity: one guide, every day-one launch path', () => {
  let upstreamFromUrl: PackageOpenInfo | undefined;

  beforeAll(async () => {
    // The URL producer is the upstream for every prepared-launch relay path:
    // `prepareGuideLaunch` derives package context by calling exactly this.
    global.fetch = jest.fn(async (input: unknown) => {
      if (String(input) !== MANIFEST_URL) {
        throw new Error(`unexpected fetch: ${String(input)}`);
      }
      return { ok: true, json: async () => MANIFEST } as Response;
    }) as unknown as typeof fetch;

    upstreamFromUrl = await fetchPackageInfoFromUrl(CONTENT_URL);
    expect(upstreamFromUrl).toBeDefined();
  });

  beforeEach(() => {
    drainQueue();
    panelModeManager.setModeTransient('sidebar');
  });

  it('the fixture manifest is schema-complete except for repository', () => {
    assertFixtureCompleteness();
  });

  it('produces an identical normalized request on every path', async () => {
    const paths: Array<SymmetryEntry<NormalizedLaunchRequest>> = [
      // --- Family: prepared-launch relay (four destinations) -----------------
      {
        path: 'prepared launch → mounted sidebar',
        family: 'prepared-launch-relay',
        adapter: async () => {
          panelModeManager.setModeTransient('sidebar');
          const panel = capturingPanel();
          const listener = renderHook(() => useAutoOpenListener(panel as never, 'sidebar'));
          const launchKey = guideLaunchStore.stage({
            url: CONTENT_URL,
            preparedContent: PREPARED_CONTENT,
            packageInfo: upstreamFromUrl,
          });
          await act(async () => {
            document.dispatchEvent(
              new CustomEvent(AUTO_OPEN_DOCS_EVENT, {
                detail: { url: CONTENT_URL, title: TITLE, source: 'home_page', launchKey },
              })
            );
          });
          const opened = normalize(openedWith(panel));
          // Consume-once staging is broadcast to every mounted listener, so this
          // one must go before the next path stages its own key.
          listener.unmount();
          return opened;
        },
      },
      {
        path: 'prepared launch → cold sidebar (queue relay)',
        family: 'prepared-launch-relay',
        adapter: async () => {
          panelModeManager.setModeTransient('sidebar');
          const launchKey = guideLaunchStore.stage({
            url: CONTENT_URL,
            preparedContent: PREPARED_CONTENT,
            packageInfo: upstreamFromUrl,
          });
          linkInterceptionState.addToQueue({ url: CONTENT_URL, title: TITLE, timestamp: Date.now(), launchKey });
          const panel = capturingPanel();
          const listener = renderHook(() => useAutoOpenListener(panel as never, 'sidebar'));
          // The hook defers the queue drain to the end of the tick on purpose.
          await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 1));
          });
          const opened = normalize(openedWith(panel));
          listener.unmount();
          return opened;
        },
      },
      {
        path: 'prepared launch → floating panel',
        family: 'prepared-launch-relay',
        adapter: () => {
          panelModeManager.setModeTransient('floating');
          panelModeManager.setPendingGuide(pendingFrom(upstreamFromUrl));
          const panel = capturingPanel();
          consumePendingGuideOnMount(panel as never, 'home_page', () => undefined);
          return normalize(openedWith(panel));
        },
      },
      {
        path: 'prepared launch → full screen',
        family: 'prepared-launch-relay',
        adapter: () => {
          panelModeManager.setModeTransient('fullscreen');
          panelModeManager.setPendingGuide(pendingFrom(upstreamFromUrl));
          const panel = capturingPanel();
          consumePendingGuideOnMount(panel as never, 'home_page', () => undefined);
          return normalize(openedWith(panel));
        },
      },

      // --- Family: existing-tab surface handoff ------------------------------
      {
        path: 'existing tab → full screen handoff',
        family: 'surface-handoff',
        adapter: async () => {
          const model = {
            state: {
              tabs: [
                {
                  id: 'tab-1',
                  title: TITLE,
                  baseUrl: CONTENT_URL,
                  currentUrl: CONTENT_URL,
                  type: 'learning-journey',
                  packageInfo: upstreamFromUrl,
                },
              ],
              activeTabId: 'tab-1',
            },
            saveTabsToStorage: jest.fn(async () => undefined),
          };
          const handoff = renderHook(() => useFullScreenHandoff(model as never, false));
          await act(async () => {
            document.dispatchEvent(new CustomEvent('pathfinder-request-full-screen'));
            await new Promise((resolve) => setTimeout(resolve, 1));
          });
          const pending = panelModeManager.consumePendingGuide();
          handoff.unmount();
          if (!pending) {
            throw new Error('handoff produced no pending guide');
          }
          return normalize(pending.packageInfo);
        },
      },

      // --- Family: recognized package URL -----------------------------------
      {
        path: 'recognized package URL auto-open',
        family: 'url-package-autoopen',
        adapter: async () => normalize(await fetchPackageInfoFromUrl(CONTENT_URL)),
      },

      // --- Family: package recommendation ------------------------------------
      // Two UI entry points, one producer: the milestone rows reuse the same
      // `packageInfo` const the start button was built from (context-panel.tsx
      // computes it once per card), so these two cannot disagree with each
      // other. Both are kept because both are real click sites.
      {
        path: 'package recommendation start',
        family: 'recommendation',
        adapter: () =>
          normalize(
            getRecommendationPackageInfo({
              title: TITLE,
              url: CONTENT_URL,
              type: 'package',
              manifest: MANIFEST,
              repository: TRUE_REPOSITORY,
              milestones: MILESTONES,
            } as never)
          ),
      },
      {
        path: 'package recommendation milestone',
        family: 'recommendation',
        adapter: () =>
          normalize(
            getRecommendationPackageInfo({
              title: TITLE,
              url: MILESTONES[0]!.url,
              type: 'package',
              manifest: MANIFEST,
              repository: TRUE_REPOSITORY,
              milestones: MILESTONES,
            } as never)
          ),
      },

      // --- Family: resolved recommends / suggests nav link -------------------
      {
        path: 'resolved recommends/suggests nav link',
        family: 'nav-link',
        adapter: () =>
          normalize(
            packageInfoForNavLink({
              packageId: PACKAGE_ID,
              title: TITLE,
              contentUrl: CONTENT_URL,
              manifest: MANIFEST,
              repository: TRUE_REPOSITORY,
            })
          ),
      },

      // --- Family: My Learning App Platform member --------------------------
      {
        path: 'My Learning App Platform path member',
        family: 'my-learning-path-member',
        adapter: () =>
          normalize(
            packageInfoForPathMember({
              id: PACKAGE_ID,
              title: TITLE,
              description: 'Learn the fundamentals of Grafana.',
              guides: [],
              badgeId: 'fundamentals',
              manifest: MANIFEST,
            })
          ),
      },

      // --- Family: My Learning Discover More --------------------------------
      {
        path: 'My Learning Discover More card',
        family: 'my-learning-discover-more',
        adapter: () =>
          normalize(
            packageInfoForDiscoverItem({
              id: PACKAGE_ID,
              title: TITLE,
              contentUrl: CONTENT_URL,
              // Production stores the schema-parsed manifest on the item, so
              // the real parser supplies it here rather than the raw fixture.
              manifest: parseDiscoverMoreManifest(MANIFEST),
            })
          ),
      },

      // --- Family: published custom path ------------------------------------
      {
        path: 'published custom path start',
        family: 'custom-path',
        adapter: () => normalize(packageInfoForPath({ id: PACKAGE_ID, title: TITLE, manifest: MANIFEST } as never)),
      },

      // --- Family: PR tester path preview -----------------------------------
      {
        path: 'PR tester path preview',
        family: 'pr-tester-path',
        adapter: () => {
          const catalogById = new Map(
            [PACKAGE_ID, ...MILESTONE_IDS].map((id) => [id, { id, path: `packages/${id}`, title: id, type: 'path' }])
          );
          const result = buildPathPackageInfo({
            pathId: PACKAGE_ID,
            description: TITLE,
            milestoneIds: MILESTONE_IDS,
            packageManifest: MANIFEST,
            prContentById: new Map(),
            catalogById: catalogById as never,
            catalogBaseUrl: CATALOG_BASE_URL,
          });
          if (!result.ok) {
            throw new Error(`PR tester path build failed: ${result.reason}`);
          }
          return normalize(result.packageInfo);
        },
      },
    ];

    // Nine families, thirteen concrete paths (the relay family has four
    // destinations and the recommendation family two). A shrinking table is a
    // regression, not a fix.
    expect(new Set(paths.map((entry) => entry.family)).size).toBe(9);
    expect(paths).toHaveLength(13);

    await assertSymmetric(paths, {
      subject: 'the normalized launch request (packageId, repository, packageManifest, resolvedMilestones)',
      intentionalDifferences: INTENTIONAL_PATH_DIFFERENCES,
    });
  });
});
