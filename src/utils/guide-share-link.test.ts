import { buildSidebarGuideLink } from './guide-share-link';
import { findDocPage } from './find-doc-page';
import { parsePathfinderDeepLink } from './pathfinder-search-params';

jest.mock('@grafana/runtime', () => ({ config: { appSubUrl: '' } }));

const BUNDLED_ID = 'welcome-to-grafana';

function tab(type: string, baseUrl: string, currentUrl = baseUrl): any {
  return { type, baseUrl, currentUrl };
}

function parse(link: string | null) {
  expect(link).not.toBeNull();
  const url = new URL(link!);
  return { url, params: parsePathfinderDeepLink(url.search) };
}

describe('buildSidebarGuideLink', () => {
  it.each(['recommendations', 'devtools', 'editor'])('returns null for the %s tab', (type) => {
    expect(buildSidebarGuideLink(tab(type, 'bundled:anything'))).toBeNull();
  });

  it('links a bundled guide to the plugin page in sidebar mode with shared_link source', () => {
    const { url, params } = parse(buildSidebarGuideLink(tab('interactive', `bundled:${BUNDLED_ID}`)));
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/a/grafana-pathfinder-app');
    expect(params).toMatchObject({ doc: `bundled:${BUNDLED_ID}`, panelMode: 'sidebar', source: 'shared_link' });
    expect(findDocPage(params.doc!)).not.toBeNull();
  });

  it('links a bundled guide opened through the package resolver in the canonical bundled:<id> form', () => {
    const { params } = parse(buildSidebarGuideLink(tab('interactive', `bundled:${BUNDLED_ID}/content.json`)));
    expect(params.doc).toBe(`bundled:${BUNDLED_ID}`);
    expect(findDocPage(params.doc!)).not.toBeNull();
  });

  it('does not carry the current page query into the link', () => {
    window.history.replaceState({}, '', '/d/abc?from=now-6h&var-x=1');
    const { url } = parse(buildSidebarGuideLink(tab('interactive', `bundled:${BUNDLED_ID}`)));
    expect(url.pathname).toBe('/a/grafana-pathfinder-app');
    expect(url.searchParams.has('from')).toBe(false);
    expect(url.searchParams.has('var-x')).toBe(false);
  });

  it('emits the canonical api: form for private App Platform guides', () => {
    const { params } = parse(buildSidebarGuideLink(tab('docs', 'backend-guide:my-guide-x7q2k1')));
    expect(params.doc).toBe('api:my-guide-x7q2k1');
    expect(findDocPage(params.doc!)?.url).toBe('backend-guide:my-guide-x7q2k1');
  });

  it('links a CDN-hosted guide unchanged', () => {
    const cdn = 'https://interactive-learning.grafana.net/guides/foo/content.json';
    const { params } = parse(buildSidebarGuideLink(tab('interactive', cdn)));
    expect(params.doc).toBe(cdn);
    expect(findDocPage(params.doc!)?.url).toBe(cdn);
  });

  it('marks learning journeys and keeps the current milestone', () => {
    const base = 'https://grafana.com/docs/learning-journeys/foo/';
    const milestone = 'https://grafana.com/docs/learning-journeys/foo/step-2/';
    const { params } = parse(buildSidebarGuideLink(tab('learning-journey', base, milestone)));
    expect(params.doc).toBe(milestone);
    expect(params.type).toBe('learning-journey');
  });

  it('returns null when the receiving side would reject the URL', () => {
    expect(buildSidebarGuideLink(tab('interactive', 'http://localhost:8080/guide/content.json'))).toBeNull();
    expect(buildSidebarGuideLink(tab('interactive', 'bundled:no-such-guide'))).toBeNull();
  });
});
