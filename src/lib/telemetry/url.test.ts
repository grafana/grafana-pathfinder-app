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
    expect(normalizeTelemetryUrl('https://user:password@grafana.com/docs/page/')).toBe('grafana.com/docs/page/');
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
    expect(stripUrlSecrets('https://acme.grafana.net/d/abc/board?var-user=alice#panel-2')).toBe(
      'https://acme.grafana.net/d/abc/board'
    );
  });

  it('strips userinfo', () => {
    expect(stripUrlSecrets('https://user:password@acme.grafana.net/avatar.png')).toBe(
      'https://acme.grafana.net/avatar.png'
    );
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
});
