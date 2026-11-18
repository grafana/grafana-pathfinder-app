/**
 * Regression for the PR Tester path mode ignoring a milestone's own
 * `startingLocation` (the prompt targeted the enclosing path's start page).
 *
 * Oracle: the values below are the real manifests from
 * grafana/interactive-tutorials PR 649 (drilldown-logs-lj path and its
 * add-log-dashboard milestone). The wrong behaviour this rejects is the prompt
 * targeting the path's `/a/grafana-lokiexplore-app/explore`.
 */
import { fetchPackageContent } from '../../docs-retrieval/content-fetcher/package-content';
import { resolveDocsLoadAlignment } from '../docs-panel/utils/docs-load-finalizer';
import { buildPathPackageInfo, type PathPackageBuildInputs, type PrContentEntry } from './pr-path-package';
import type { PrJsonFile } from './github-api';
import type { OnlinePackageEntry } from '../../lib/package-recommendations-client';
import type { RawContent } from '../../docs-retrieval';

jest.mock('@grafana/runtime', () => ({
  config: {
    get namespace() {
      return 'stacks-123';
    },
    bootData: { user: {} },
  },
  getBackendSrv: () => ({ fetch: jest.fn() }),
}));

jest.mock('../../validation', () => ({
  validateGuide: () => ({ isValid: true, errors: [] }),
}));

const SHA = 'c'.repeat(40);
const RAW_BASE = `https://raw.githubusercontent.com/grafana/interactive-tutorials/${SHA}`;
const CDN_BASE = 'https://interactive-learning.grafana.net/packages';
const PATH_START = '/a/grafana-lokiexplore-app/explore';

const VIEW = 'drilldown-logs-view-logs';
const ADD = 'drilldown-logs-add-log-dashboard';

const pathManifest = {
  id: 'drilldown-logs-lj',
  type: 'path',
  startingLocation: PATH_START,
  milestones: [VIEW, ADD],
};

function prContent(dir: string): PrContentEntry {
  const file: PrJsonFile = {
    directoryName: dir,
    rawUrl: `${RAW_BASE}/${dir}/content.json`,
    status: 'modified',
    kind: 'content',
  };
  return { file, title: dir };
}

function inputs(overrides: Partial<PathPackageBuildInputs> = {}): PathPackageBuildInputs {
  return {
    pathId: 'drilldown-logs-lj',
    milestoneIds: pathManifest.milestones,
    packageManifest: pathManifest,
    prContentById: new Map([
      [VIEW, prContent('drilldown-logs-lj/view-logs')],
      [ADD, prContent('drilldown-logs-lj/add-log-dashboard')],
    ]),
    catalogById: new Map(),
    catalogBaseUrl: CDN_BASE,
    coverFromPr: prContent('drilldown-logs-lj').file,
    fetchId: 'abc123',
    ...overrides,
  };
}

function loadedMember(url: string): { content: RawContent } {
  return {
    content: {
      content: JSON.stringify({ id: ADD, title: 'Add log dashboard', blocks: [] }),
      metadata: { title: 'Add log dashboard' },
      type: 'single-doc',
      url,
      lastFetched: new Date().toISOString(),
    } as RawContent,
  };
}

async function promptTargetFor(build: ReturnType<typeof buildPathPackageInfo>, currentPath: string) {
  if (!build.ok) {
    throw new Error('expected a buildable path');
  }
  const { packageInfo } = build;
  const member = packageInfo.resolvedMilestones![1]!;
  const result = await fetchPackageContent(
    member.url,
    packageInfo.packageManifest,
    packageInfo.resolvedMilestones,
    undefined,
    loadedMember(member.url),
    ADD
  );
  const metadata = result.content!.metadata;
  return resolveDocsLoadAlignment({
    requestedUrl: member.url,
    packageManifest: packageInfo.packageManifest,
    fetchedManifest: metadata.packageManifest,
    packageManifestIsFromEnclosingPath: metadata.journeyManifest !== undefined,
    currentPath,
    launchSource: null,
    isAdmin: true,
    isFullScreen: false,
  });
}

describe('PR Tester path mode milestone starting location', () => {
  const prManifests = new Map<string, Record<string, unknown>>([
    [ADD, { id: ADD, type: 'guide', startingLocation: '/explore' }],
  ]);

  it("prompts against the milestone's own startingLocation from the PR manifest", async () => {
    const decision = await promptTargetFor(
      buildPathPackageInfo(inputs({ prManifestById: prManifests })),
      '/dashboards'
    );

    expect(decision?.startingLocation).toBe('/explore');
  });

  it('does not prompt a reader who is already on the milestone start page', async () => {
    const decision = await promptTargetFor(buildPathPackageInfo(inputs({ prManifestById: prManifests })), '/explore');

    expect(decision).toBeUndefined();
  });

  it("falls back to the catalog entry's manifest when the PR does not change it", async () => {
    const catalogEntry: OnlinePackageEntry = {
      id: ADD,
      path: `${ADD}/v1.0.0`,
      type: 'guide',
      manifest: { id: ADD, type: 'guide', startingLocation: '/explore' },
    };
    const decision = await promptTargetFor(
      buildPathPackageInfo(inputs({ catalogById: new Map([[ADD, catalogEntry]]) })),
      '/dashboards'
    );

    expect(decision?.startingLocation).toBe('/explore');
  });

  it("keeps the path's startingLocation for a milestone that declares none", async () => {
    const decision = await promptTargetFor(
      buildPathPackageInfo(inputs({ prManifestById: new Map([[ADD, { id: ADD, type: 'guide' }]]) })),
      '/dashboards'
    );

    expect(decision?.startingLocation).toBe(PATH_START);
  });

  it('carries each milestone manifest and startingLocation onto the built milestone', () => {
    const build = buildPathPackageInfo(inputs({ prManifestById: prManifests }));

    expect(build.ok && build.packageInfo.resolvedMilestones?.[1]).toMatchObject({
      id: ADD,
      startingLocation: '/explore',
      packageManifest: { id: ADD },
    });
    expect(build.ok && build.packageInfo.resolvedMilestones?.[0]).not.toHaveProperty('startingLocation');
  });
});
