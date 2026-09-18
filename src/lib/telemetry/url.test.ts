import { normalizeTelemetryUrl, stripUrlSecrets } from './url';

describe('normalizeTelemetryUrl', () => {
  it('reduces a URL to hostname/path', () => {
    expect(normalizeTelemetryUrl('https://grafana.com/docs/grafana/latest/panels/')).toBe(
      'grafana.com/docs/grafana/latest/panels/'
    );
  });

  it('strips query strings and fragments', () => {
    expect(normalizeTelemetryUrl('https://grafana.com/docs/page/?token=secret&x=1#fragment')).toBe(
      'grafana.com/docs/page/'
    );
  });

  it('strips userinfo', () => {
    const withUserinfo = 'https://user:password@grafana.com/docs/page/'; // trufflehog:ignore
    expect(normalizeTelemetryUrl(withUserinfo)).toBe('grafana.com/docs/page/');
  });

  it('passes internal content identifiers through unchanged', () => {
    expect(normalizeTelemetryUrl('bundled:welcome-to-pathfinder')).toBe('bundled:welcome-to-pathfinder');
    expect(normalizeTelemetryUrl('backend-guide:my-guide')).toBe('backend-guide:my-guide');
  });

  it('bounds output length', () => {
    const long = `https://grafana.com/docs/${'a'.repeat(500)}`;
    expect(normalizeTelemetryUrl(long).length).toBeLessThanOrEqual(200);
  });

  it('returns a placeholder for unparsable input and empty string for empty input', () => {
    expect(normalizeTelemetryUrl('http://')).toBe('invalid-url');
    expect(normalizeTelemetryUrl('')).toBe('');
  });

  it('resolves relative URLs against the page origin', () => {
    expect(normalizeTelemetryUrl('/d/abc123?orgId=1')).toBe(`${window.location.hostname}/d/abc123`);
  });
});

describe('stripUrlSecrets', () => {
  it('keeps the scheme and host so the URL stays loadable', () => {
    expect(stripUrlSecrets('https://acme.grafana.net/explore?var-user=alice#panel-2')).toBe(
      'https://acme.grafana.net/explore'
    );
  });

  // The path is kept whole — the dashboard title slug is what makes a replay
  // navigable and is visible to anyone who can see the recording. Only the
  // query, which carries `var-*` filter values, is dropped.
  it.each([
    ['a dashboard', '/d/abc123/acme-q3-revenue'],
    ['a solo panel', '/d-solo/abc123/acme-q3-revenue'],
    ['a folder', '/dashboards/f/fld456/finance'],
  ])('keeps the whole %s path and drops only the query', (_label, path) => {
    expect(stripUrlSecrets(`https://acme.grafana.net${path}?var-customer=AcmeCorp`)).toBe(
      `https://acme.grafana.net${path}`
    );
  });

  // A title slug is not a secret; a share token is — it is the whole
  // credential, and the path is otherwise kept.
  it.each([
    ['a public dashboard access token', '/public-dashboards/abc123def456', '/public-dashboards/redacted'],
    ['a snapshot key', '/dashboard/snapshot/xyz789key', '/dashboard/snapshot/redacted'],
  ])('redacts %s', (_label, path, expected) => {
    expect(stripUrlSecrets(`https://acme.grafana.net${path}`)).toBe(`https://acme.grafana.net${expected}`);
  });

  it('keeps asset paths intact', () => {
    expect(stripUrlSecrets('/public/build/app.1a2b3c.js?v=2')).toBe('/public/build/app.1a2b3c.js');
  });

  it('strips userinfo', () => {
    const withUserinfo = 'https://user:password@acme.grafana.net/avatar.png'; // trufflehog:ignore
    expect(stripUrlSecrets(withUserinfo)).toBe('https://acme.grafana.net/avatar.png');
  });

  it('keeps relative URLs relative', () => {
    expect(stripUrlSecrets('/public/img/logo.svg?v=2')).toBe('/public/img/logo.svg');
  });

  it('leaves in-document references untouched', () => {
    expect(stripUrlSecrets('#icon-angle-down')).toBe('#icon-angle-down');
  });

  it('collapses data URIs', () => {
    expect(stripUrlSecrets('data:image/png;base64,iVBORw0KGgoAAAA')).toBe('data:');
  });

  it('bounds output length', () => {
    expect(stripUrlSecrets(`https://acme.grafana.net/${'a'.repeat(500)}`).length).toBeLessThanOrEqual(200);
  });

  it('returns empty string for empty or unparsable input', () => {
    expect(stripUrlSecrets('')).toBe('');
    expect(stripUrlSecrets('http://')).toBe('');
  });

  it.each(['javascript:alert(1)', 'vbscript:msgbox(1)', 'blob:https://acme.grafana.net/abc', 'mailto:a@b.c'])(
    'drops %s, which a replay player has no reason to resolve',
    (url) => {
      expect(stripUrlSecrets(url)).toBe('');
    }
  );
});
