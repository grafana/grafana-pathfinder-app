import { pickGrafanaDocsOpenAction } from './grafana-docs-open-action';

describe('pickGrafanaDocsOpenAction', () => {
  it('returns shouldShow=false for undefined URL', () => {
    expect(pickGrafanaDocsOpenAction(undefined)).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for empty string', () => {
    expect(pickGrafanaDocsOpenAction('')).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for bundled content URLs', () => {
    expect(pickGrafanaDocsOpenAction('bundled:wysiwyg-preview')).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for non-allowlisted hostnames', () => {
    expect(pickGrafanaDocsOpenAction('https://example.com/some/page')).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=true with cleaned URL for an allowlisted Grafana docs URL', () => {
    const result = pickGrafanaDocsOpenAction('https://grafana.com/docs/grafana/latest/');
    expect(result.shouldShow).toBe(true);
    expect(result.cleanUrl).toBe('https://grafana.com/docs/grafana/latest/');
  });

  it('strips /content.json suffix for learning-path URLs', () => {
    const result = pickGrafanaDocsOpenAction('https://grafana.com/docs/learning-journeys/intro/content.json');
    expect(result.shouldShow).toBe(true);
    expect(result.cleanUrl).toBe('https://grafana.com/docs/learning-journeys/intro');
  });

  it('strips /unstyled.html suffix for embedded docs', () => {
    const result = pickGrafanaDocsOpenAction('https://grafana.com/docs/grafana/latest/intro/unstyled.html');
    expect(result.shouldShow).toBe(true);
    expect(result.cleanUrl).toBe('https://grafana.com/docs/grafana/latest/intro');
  });
});
