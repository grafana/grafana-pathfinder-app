import { pickReadonlyTabOpenAction } from './readonly-tab-open-action';

describe('pickReadonlyTabOpenAction', () => {
  it('returns shouldShow=false for undefined URL', () => {
    expect(pickReadonlyTabOpenAction(undefined)).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for empty string', () => {
    expect(pickReadonlyTabOpenAction('')).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for public Grafana docs URLs (handled by the docs Open button)', () => {
    expect(pickReadonlyTabOpenAction('https://grafana.com/docs/grafana/latest/')).toEqual({ shouldShow: false });
  });

  it('returns shouldShow=false for bundled content URLs', () => {
    expect(pickReadonlyTabOpenAction('bundled:wysiwyg-preview')).toEqual({ shouldShow: false });
  });

  it('builds a same-origin root URL carrying doc + readonly for a backend-guide scheme', () => {
    const result = pickReadonlyTabOpenAction('backend-guide:my-guide');
    expect(result.shouldShow).toBe(true);
    const url = new URL(result.readonlyUrl!, 'http://localhost');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('doc')).toBe('backend-guide:my-guide');
    expect(url.searchParams.get('readonly')).toBe('1');
    expect(url.searchParams.get('type')).toBeNull();
  });

  it('builds the root URL for the api: alias', () => {
    const result = pickReadonlyTabOpenAction('api:my-guide');
    expect(result.shouldShow).toBe(true);
    expect(new URL(result.readonlyUrl!, 'http://localhost').searchParams.get('doc')).toBe('api:my-guide');
  });

  it('builds the root URL for an interactive-learning package (no public doc to redirect to)', () => {
    const doc = 'https://interactive-learning.grafana.net/packages/alerting-101/content.json';
    const result = pickReadonlyTabOpenAction(doc);
    expect(result.shouldShow).toBe(true);
    const url = new URL(result.readonlyUrl!, 'http://localhost');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('doc')).toBe(doc);
    expect(url.searchParams.get('readonly')).toBe('1');
  });

  it('shows for an interactive-learning guide URL too', () => {
    expect(
      pickReadonlyTabOpenAction('https://interactive-learning.grafana.net/guides/explore-drilldowns-101').shouldShow
    ).toBe(true);
  });
});
