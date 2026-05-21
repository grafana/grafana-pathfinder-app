import { deriveSnippetsBaseUrl } from './online-snippet-resolver';

describe('deriveSnippetsBaseUrl', () => {
  it('swaps a trailing /packages segment for /guides/shared/snippets', () => {
    expect(deriveSnippetsBaseUrl('https://interactive-learning.grafana.net/packages')).toBe(
      'https://interactive-learning.grafana.net/guides/shared/snippets'
    );
  });

  it('tolerates a trailing slash on the input', () => {
    expect(deriveSnippetsBaseUrl('https://interactive-learning.grafana.net/packages/')).toBe(
      'https://interactive-learning.grafana.net/guides/shared/snippets'
    );
  });

  it('appends /guides/shared/snippets to non-/packages roots as a defensive fallback', () => {
    expect(deriveSnippetsBaseUrl('https://example.test')).toBe('https://example.test/guides/shared/snippets');
  });

  it('returns empty for empty input so callers can short-circuit', () => {
    expect(deriveSnippetsBaseUrl('')).toBe('');
    expect(deriveSnippetsBaseUrl('///')).toBe('');
  });
});
