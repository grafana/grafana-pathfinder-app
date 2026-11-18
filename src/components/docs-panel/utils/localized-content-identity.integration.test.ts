/**
 * The identity rule end to end (docs/design/I18N.md §6.6): one online package
 * opened as its canonical `content.json` and as a localized `content.ja.json`
 * is ONE guide. Each URL goes through the real package detection, loader,
 * completion identity, completion recorder, progress content key and milestone
 * toolbar context, with only the network and the package resolver faked.
 */
import { loadDocsTabContentResult } from './docs-tab-loader';
import { fetchPackageInfoFromUrl } from '../../../docs-retrieval/package-info-from-url';
import { setPackageResolver } from '../../../docs-retrieval/content-fetcher/package-content';
import { resolveActiveMilestoneToolbarContext } from '../../../docs-retrieval/active-milestone-sequence';
import { resolveJourneyCompletionIdentity } from '../../../completion-records/completion-identity';
import {
  __resetRecorderForTests,
  onCompletionRecorded,
  recordJourneyCompletion,
} from '../../../completion-records/completion-recorder';
import { getContentKey, resetContentKeyForTests, setActiveTabUrl } from '../../../global-state/content-key';
import { findDocPage } from '../../../utils/find-doc-page';
import type { ManifestJson, PackageResolver } from '../../../types/package.types';

jest.mock('@grafana/runtime', () => ({
  config: { bootData: { user: {} }, buildInfo: { version: '12.0.0' } },
  getBackendSrv: () => ({ fetch: jest.fn() }),
  reportInteraction: jest.fn(),
}));

jest.mock('../../../validation', () => ({
  validateGuide: () => ({ isValid: true, errors: [] }),
}));

const CDN = 'https://interactive-learning.grafana.net/packages';
const PATH_ID = 'loki-intro-path';
const CANONICAL_URL = `${CDN}/${PATH_ID}/content.json`;
const LOCALIZED_URL = `${CDN}/${PATH_ID}/content.ja.json`;

const pathManifest: ManifestJson = {
  id: PATH_ID,
  type: 'path',
  repository: 'interactive-tutorials',
  milestones: ['loki-step-one', 'loki-step-two'],
};

const guide = (title: string) =>
  JSON.stringify({ id: PATH_ID, title, schemaVersion: '1.0', blocks: [{ type: 'markdown', content: title }] });

function respond(body: string): Response {
  return {
    ok: true,
    status: 200,
    url: '',
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => body,
    json: async () => JSON.parse(body),
  } as unknown as Response;
}

const fetchMock = jest.fn((url: string) => {
  if (url.startsWith(`${CDN}/${PATH_ID}/manifest.json`)) {
    return Promise.resolve(respond(JSON.stringify(pathManifest)));
  }
  if (url.startsWith(CANONICAL_URL)) {
    return Promise.resolve(respond(guide('Loki intro')));
  }
  if (url.startsWith(LOCALIZED_URL)) {
    return Promise.resolve(respond(guide('Loki 入門')));
  }
  return Promise.resolve({ ok: false, status: 404, headers: new Headers() } as Response);
});

const resolver: PackageResolver = {
  resolve: jest.fn(async (packageId: string) => ({
    ok: true as const,
    id: packageId,
    contentUrl: `${CDN}/${packageId}/content.json`,
    manifestUrl: `${CDN}/${packageId}/manifest.json`,
    repository: 'interactive-tutorials',
    manifest:
      packageId === PATH_ID ? pathManifest : ({ id: packageId, type: 'guide', description: packageId } as ManifestJson),
  })),
};

beforeEach(() => {
  global.fetch = fetchMock as unknown as typeof fetch;
  setPackageResolver(resolver);
  resetContentKeyForTests();
  __resetRecorderForTests();
  localStorage.clear();
});

async function open(url: string) {
  const packageInfo = await fetchPackageInfoFromUrl(url);
  const result = await loadDocsTabContentResult(url, { packageInfo });
  const content = result.content!;
  expect(content).toBeDefined();

  const identity = resolveJourneyCompletionIdentity({
    packageManifest: content.metadata.packageManifest,
    repository: packageInfo?.repository,
    guideId: PATH_ID,
  });
  setActiveTabUrl(url);
  return {
    identity,
    contentKey: getContentKey(),
    toolbar: resolveActiveMilestoneToolbarContext(content, undefined, undefined),
  };
}

describe('a localized content file keeps its canonical guide identity', () => {
  it('gives the same guideId, progress content key and milestone toolbar as the canonical file', async () => {
    const canonical = await open(CANONICAL_URL);
    const localized = await open(LOCALIZED_URL);

    expect(fetchMock).toHaveBeenCalledWith(LOCALIZED_URL, expect.anything());
    expect(canonical.identity).toEqual({ guideSource: 'interactive-tutorials', guideId: PATH_ID });
    expect(localized.identity).toEqual(canonical.identity);
    expect(canonical.contentKey).toBe(CANONICAL_URL);
    expect(localized.contentKey).toBe(canonical.contentKey);
    expect(canonical.toolbar).toMatchObject({ totalMilestones: 2 });
    expect(localized.toolbar).toEqual(canonical.toolbar);
  });

  it('shares one completion dedupe key, so the localized open never records a second completion', async () => {
    const canonical = await open(CANONICAL_URL);
    const localized = await open(LOCALIZED_URL);
    const listener = jest.fn(() => true);
    const unsubscribe = onCompletionRecorded(listener);
    const fact = {
      kind: 'journey',
      guideTitle: 'Loki intro',
      guideCategory: 'learning-journey',
      completionPercent: 100,
      source: 'objectives',
      completedAt: new Date(0).toISOString(),
      sourceConfirmed: true,
    } as const;
    try {
      recordJourneyCompletion({ ...fact, ...canonical.identity });
      recordJourneyCompletion({ ...fact, ...localized.identity });

      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it('opens the canonical URL from a localized ?doc= link', () => {
    expect(findDocPage(LOCALIZED_URL)).toMatchObject({ url: CANONICAL_URL, locale: 'ja' });
  });
});
