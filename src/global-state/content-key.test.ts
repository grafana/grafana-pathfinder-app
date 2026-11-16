import {
  getActiveTabUrl,
  getContentKey,
  getContentKeyOverride,
  resetContentKeyForTests,
  setActiveTabUrl,
  setContentKeyOverride,
} from './content-key';
import { getPrTestFetchId, isPrTestUrl, withPrTestMarker } from '../lib/pr-test-marker';

describe('content-key', () => {
  beforeEach(() => {
    resetContentKeyForTests();
    delete (window as any).__DocsPluginActiveTabUrl;
    delete (window as any).__DocsPluginContentKey;
  });

  it('prefers the typed active-tab URL when set', () => {
    setActiveTabUrl('https://example.com/guide-a');
    expect(getContentKey()).toBe('https://example.com/guide-a');
  });

  it('falls back to the legacy window global when the typed setter has not been used', () => {
    (window as any).__DocsPluginActiveTabUrl = 'https://example.com/legacy';
    expect(getContentKey()).toBe('https://example.com/legacy');
  });

  it('prefers the typed setter over the legacy global when both are set', () => {
    (window as any).__DocsPluginActiveTabUrl = 'https://example.com/legacy';
    setActiveTabUrl('https://example.com/typed');
    expect(getContentKey()).toBe('https://example.com/typed');
  });

  it('uses the content-key override when no active tab URL is available', () => {
    setContentKeyOverride('bundled:first-dashboard');
    expect(getContentKey()).toBe('bundled:first-dashboard');
  });

  it('falls back to the legacy override global', () => {
    (window as any).__DocsPluginContentKey = 'bundled:legacy-key';
    expect(getContentKey()).toBe('bundled:legacy-key');
  });

  it('falls back to window.location.pathname as a last resort', () => {
    expect(getContentKey()).toBe(window.location.pathname);
  });

  it('strips literal `..` segments to prevent path-traversal', () => {
    setActiveTabUrl('foo/../bar');
    // Matches the existing `get-content-key.ts` behaviour: the `..` is
    // removed but the surrounding slashes are not collapsed.
    expect(getContentKey()).toBe('foo//bar');
  });

  it('truncates values longer than 200 characters', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(500);
    setActiveTabUrl(longUrl);
    expect(getContentKey()).toHaveLength(200);
  });

  describe('PR-tester marker at the length bound', () => {
    const MAX = 200;
    const urlOfLength = (marked: number, fetchId: string) => {
      const markerLength = withPrTestMarker('', fetchId).length;
      return withPrTestMarker(
        'https://raw.githubusercontent.com/org/repo/' + 'a'.repeat(marked - markerLength - 43),
        fetchId
      );
    };

    it.each([199, 200, 201, 228, 500])('keeps preview classification and fetch identity at %i characters', (length) => {
      const marked = urlOfLength(length, 'k3x9a');
      expect(marked).toHaveLength(length);
      setActiveTabUrl(marked);

      const key = getContentKey();

      expect(key.length).toBeLessThanOrEqual(MAX);
      expect(isPrTestUrl(key)).toBe(true);
      expect(getPrTestFetchId(key)).toBe('k3x9a');
      if (length <= MAX) {
        expect(key).toBe(marked);
      }
    });

    it.each([200, 201, 228, 500])('separates two fetches of one %i-character URL', (length) => {
      setActiveTabUrl(urlOfLength(length, 'abcdef1'));
      const first = getContentKey();
      setActiveTabUrl(urlOfLength(length, 'abcdef2'));
      const second = getContentKey();

      expect(first).not.toBe(second);
    });

    it('keeps two distinct long URLs of one fetch on separate keys', () => {
      const prefix = 'https://raw.githubusercontent.com/org/repo/' + 'a'.repeat(190);
      setActiveTabUrl(withPrTestMarker(`${prefix}/guide-one/content.json`, 'abcdef1'));
      const first = getContentKey();
      setActiveTabUrl(withPrTestMarker(`${prefix}/guide-two/content.json`, 'abcdef1'));
      const second = getContentKey();

      expect(first).not.toBe(second);
      expect(first.length).toBeLessThanOrEqual(MAX);
      expect(second.length).toBeLessThanOrEqual(MAX);
      expect(getPrTestFetchId(first)).toBe('abcdef1');
      expect(getPrTestFetchId(second)).toBe('abcdef1');
    });

    it('still truncates an unmarked URL to the bound', () => {
      setActiveTabUrl('https://example.com/' + 'a'.repeat(500) + '#pf-pr-');
      expect(getContentKey()).toHaveLength(MAX);
    });
  });

  it('treats empty-string inputs as unset', () => {
    setActiveTabUrl('');
    expect(getContentKey()).toBe(window.location.pathname);
  });

  describe('getActiveTabUrl', () => {
    it('returns the typed value when set', () => {
      setActiveTabUrl('https://example.com/guide-a');
      expect(getActiveTabUrl()).toBe('https://example.com/guide-a');
    });

    it('falls back to the legacy window global when the typed setter has not been used', () => {
      (window as any).__DocsPluginActiveTabUrl = 'https://example.com/legacy';
      expect(getActiveTabUrl()).toBe('https://example.com/legacy');
    });

    it('returns undefined when neither the typed value nor the global is set', () => {
      expect(getActiveTabUrl()).toBeUndefined();
    });

    it('returns the raw value without sanitization', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(500);
      setActiveTabUrl(longUrl);
      expect(getActiveTabUrl()).toBe(longUrl);
    });
  });

  describe('getContentKeyOverride', () => {
    it('returns the typed value when set', () => {
      setContentKeyOverride('bundled:first-dashboard');
      expect(getContentKeyOverride()).toBe('bundled:first-dashboard');
    });

    it('falls back to the legacy window global when the typed setter has not been used', () => {
      (window as any).__DocsPluginContentKey = 'bundled:legacy-key';
      expect(getContentKeyOverride()).toBe('bundled:legacy-key');
    });

    it('returns undefined when neither the typed value nor the global is set', () => {
      expect(getContentKeyOverride()).toBeUndefined();
    });

    it('returns the raw value without sanitization', () => {
      const longKey = 'bundled:' + 'a'.repeat(500);
      setContentKeyOverride(longKey);
      expect(getContentKeyOverride()).toBe(longKey);
    });
  });
});
