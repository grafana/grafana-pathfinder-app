import { getContentKey, resetContentKeyForTests, setActiveTabUrl, setContentKeyOverride } from './content-key';

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

  it('treats empty-string inputs as unset', () => {
    setActiveTabUrl('');
    expect(getContentKey()).toBe(window.location.pathname);
  });
});
