/**
 * Tests for the centralized Pathfinder deep-link contract.
 *
 * The module is the single source of truth for what `?doc` / `?type` /
 * `?source` / `?page` / `?kiosk_session` / `?panelMode` mean. Drift between
 * call sites has produced real bugs (e.g. floating "copy link" used to omit
 * `type=learning-journey`). These tests pin the truth table down so future
 * changes can't silently revert that fix.
 */

import {
  PATHFINDER_PARAMS,
  buildFullScreenRouteUrl,
  buildPathfinderShareUrl,
  parsePathfinderDeepLink,
  shouldOpenAsLearningJourney,
  stripPathfinderParams,
} from './pathfinder-search-params';

describe('PATHFINDER_PARAMS', () => {
  it('contains the documented six params (kept in lock-step with parse + strip)', () => {
    expect([...PATHFINDER_PARAMS].sort()).toEqual(
      ['doc', 'kiosk_session', 'page', 'panelMode', 'source', 'type'].sort()
    );
  });
});

describe('parsePathfinderDeepLink', () => {
  it('returns an empty shape for an empty search string', () => {
    expect(parsePathfinderDeepLink('')).toEqual({
      doc: undefined,
      type: undefined,
      source: undefined,
      page: undefined,
      kioskSession: undefined,
      panelMode: undefined,
    });
  });

  it('parses every supported param, including the renamed kiosk_session → kioskSession', () => {
    const search =
      '?doc=https%3A%2F%2Fgrafana.com%2Fdocs%2Ffoo&type=learning-journey&source=learning-hub&page=%2Fexplore&kiosk_session=abc123&panelMode=fullscreen';
    expect(parsePathfinderDeepLink(search)).toEqual({
      doc: 'https://grafana.com/docs/foo',
      type: 'learning-journey',
      source: 'learning-hub',
      page: '/explore',
      kioskSession: 'abc123',
      panelMode: 'fullscreen',
    });
  });

  it('rejects unknown `type` values (typos drop to undefined rather than poisoning consumers)', () => {
    const parsed = parsePathfinderDeepLink('?doc=foo&type=workshop');
    expect(parsed.doc).toBe('foo');
    expect(parsed.type).toBeUndefined();
  });

  it('rejects unknown `panelMode` values (defends against URL tampering)', () => {
    const parsed = parsePathfinderDeepLink('?panelMode=picture-in-picture');
    expect(parsed.panelMode).toBeUndefined();
  });

  it('accepts each whitelisted type', () => {
    expect(parsePathfinderDeepLink('?type=docs').type).toBe('docs');
    expect(parsePathfinderDeepLink('?type=interactive').type).toBe('interactive');
    expect(parsePathfinderDeepLink('?type=learning-journey').type).toBe('learning-journey');
  });

  it('accepts each whitelisted panelMode', () => {
    expect(parsePathfinderDeepLink('?panelMode=sidebar').panelMode).toBe('sidebar');
    expect(parsePathfinderDeepLink('?panelMode=floating').panelMode).toBe('floating');
    expect(parsePathfinderDeepLink('?panelMode=fullscreen').panelMode).toBe('fullscreen');
  });
});

describe('stripPathfinderParams', () => {
  it('removes every Pathfinder-controlled param while preserving foreign params', () => {
    const url = new URL(
      'https://example.com/foo?doc=bar&type=learning-journey&source=hub&page=/explore&kiosk_session=xyz&panelMode=floating&keep=this'
    );

    stripPathfinderParams(url);

    expect(url.searchParams.get('doc')).toBeNull();
    expect(url.searchParams.get('type')).toBeNull();
    expect(url.searchParams.get('source')).toBeNull();
    expect(url.searchParams.get('page')).toBeNull();
    expect(url.searchParams.get('kiosk_session')).toBeNull();
    expect(url.searchParams.get('panelMode')).toBeNull();
    expect(url.searchParams.get('keep')).toBe('this');
  });

  it('is safe on a URL with no Pathfinder params', () => {
    const url = new URL('https://example.com/foo?keep=this');
    expect(() => stripPathfinderParams(url)).not.toThrow();
    expect(url.toString()).toBe('https://example.com/foo?keep=this');
  });
});

describe('buildPathfinderShareUrl', () => {
  it('sets `doc` and `panelMode` on the supplied base URL', () => {
    const base = new URL('https://grafana.example.com/dashboards/edit');
    const out = buildPathfinderShareUrl({ base, doc: 'bundled:foo', panelMode: 'fullscreen' });

    const parsed = new URL(out);
    expect(parsed.searchParams.get('doc')).toBe('bundled:foo');
    expect(parsed.searchParams.get('panelMode')).toBe('fullscreen');
    expect(parsed.searchParams.get('type')).toBeNull();
  });

  it('appends `type=learning-journey` only when the guide is a journey', () => {
    const base = new URL('https://grafana.example.com/dashboards/edit');

    const journey = new URL(
      buildPathfinderShareUrl({ base, doc: 'pkg:foo', panelMode: 'floating', guideType: 'learning-journey' })
    );
    expect(journey.searchParams.get('type')).toBe('learning-journey');

    const docs = new URL(
      buildPathfinderShareUrl({ base, doc: 'bundled:foo', panelMode: 'floating', guideType: 'docs' })
    );
    expect(docs.searchParams.get('type')).toBeNull();

    const noType = new URL(buildPathfinderShareUrl({ base, doc: 'bundled:foo', panelMode: 'floating' }));
    expect(noType.searchParams.get('type')).toBeNull();
  });

  it('omits `panelMode` when not provided (e.g. share URL that should inherit the recipient default)', () => {
    const base = new URL('https://grafana.example.com/foo');
    const out = new URL(buildPathfinderShareUrl({ base, doc: 'bundled:foo' }));
    expect(out.searchParams.get('panelMode')).toBeNull();
  });

  it('preserves unrelated existing query params on the base URL', () => {
    const base = new URL('https://grafana.example.com/foo?keep=this');
    const out = new URL(buildPathfinderShareUrl({ base, doc: 'bundled:foo', panelMode: 'floating' }));
    expect(out.searchParams.get('keep')).toBe('this');
  });

  it('URI-encodes special characters in `doc` (security: F4)', () => {
    const base = new URL('https://grafana.example.com/');
    const out = new URL(buildPathfinderShareUrl({ base, doc: 'https://grafana.com/docs/foo bar?x=1' }));
    expect(out.searchParams.get('doc')).toBe('https://grafana.com/docs/foo bar?x=1');
    // Round-trip through the URL serializer escapes the embedded `?` and space.
    expect(out.toString()).toContain('doc=https%3A%2F%2Fgrafana.com%2Fdocs%2Ffoo+bar%3Fx%3D1');
  });
});

describe('buildFullScreenRouteUrl', () => {
  it('builds the in-app fullscreen route with both doc and type encoded', () => {
    const out = buildFullScreenRouteUrl({
      pluginBaseUrl: '/a/grafana-pathfinder-app',
      fullScreenRoute: 'fullscreen',
      doc: 'https://raw.githubusercontent.com/x/y/z/m1/content.json',
      guideType: 'learning-journey',
    });

    const url = new URL(out, 'http://localhost');
    expect(url.pathname).toBe('/a/grafana-pathfinder-app/fullscreen');
    expect(url.searchParams.get('doc')).toBe('https://raw.githubusercontent.com/x/y/z/m1/content.json');
    expect(url.searchParams.get('type')).toBe('learning-journey');
  });

  it('always sets `type` even for plain docs (so the receiving panel does not have to second-guess)', () => {
    const out = buildFullScreenRouteUrl({
      pluginBaseUrl: '/a/grafana-pathfinder-app',
      fullScreenRoute: 'fullscreen',
      doc: 'bundled:foo',
      guideType: 'docs',
    });

    const url = new URL(out, 'http://localhost');
    expect(url.searchParams.get('type')).toBe('docs');
  });
});

describe('shouldOpenAsLearningJourney', () => {
  it('returns true when type is learning-journey', () => {
    expect(shouldOpenAsLearningJourney('learning-journey', undefined)).toBe(true);
    expect(shouldOpenAsLearningJourney('learning-journey', 'recommender')).toBe(true);
  });

  it('returns true when source is learning-hub (regardless of type)', () => {
    expect(shouldOpenAsLearningJourney(undefined, 'learning-hub')).toBe(true);
    expect(shouldOpenAsLearningJourney('docs', 'learning-hub')).toBe(true);
  });

  it('returns false for plain docs / interactive opens', () => {
    expect(shouldOpenAsLearningJourney('docs', 'recommender')).toBe(false);
    expect(shouldOpenAsLearningJourney('interactive', 'url_param')).toBe(false);
    expect(shouldOpenAsLearningJourney(undefined, undefined)).toBe(false);
  });
});
