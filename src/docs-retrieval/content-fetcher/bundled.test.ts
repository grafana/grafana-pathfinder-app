import { parseBundledUrl, fetchBundledInteractive } from './bundled';
import { StorageKeys } from '../../lib/user-storage';

describe('parseBundledUrl', () => {
  it('recognizes the wysiwyg-preview sentinel', () => {
    expect(parseBundledUrl('bundled:wysiwyg-preview')).toEqual({ kind: 'wysiwyg-preview' });
  });

  it('recognizes the e2e-test sentinel', () => {
    expect(parseBundledUrl('bundled:e2e-test')).toEqual({ kind: 'e2e-test' });
  });

  it('accepts a safe package path', () => {
    expect(parseBundledUrl('bundled:welcome-to-grafana/content.json')).toEqual({
      kind: 'package',
      relativePath: 'welcome-to-grafana/content.json',
    });
  });

  it('rejects an unsafe package path (uppercase)', () => {
    const ref = parseBundledUrl('bundled:Welcome/Content.json');
    expect(ref.kind).toBe('invalid');
  });

  it('rejects a path-traversal attempt', () => {
    const ref = parseBundledUrl('bundled:../../etc/passwd.json');
    expect(ref.kind).toBe('invalid');
  });

  it('flags an empty bundled URL as invalid', () => {
    expect(parseBundledUrl('bundled:')).toEqual({ kind: 'invalid', reason: 'Empty bundled URL' });
  });

  it('treats a bare id (no slash, no .json) as indexed', () => {
    expect(parseBundledUrl('bundled:welcome-to-grafana')).toEqual({ kind: 'indexed', id: 'welcome-to-grafana' });
  });
});

describe('fetchBundledInteractive — package path (require + title from module)', () => {
  it('loads a real bundled package and derives the title from the JSON module', async () => {
    const result = await fetchBundledInteractive('bundled:welcome-to-grafana/content.json');

    expect(result.content).not.toBeNull();
    expect(result.content!.type).toBe('interactive');
    expect(result.content!.isNativeJson).toBe(true);
    expect(result.content!.metadata.title).toBe('Welcome to Grafana');
    // Content is the stringified guide and round-trips to the same id.
    expect(JSON.parse(result.content!.content).id).toBe('welcome-to-grafana');
  });

  it('returns a not-found error for a syntactically valid but missing package', async () => {
    const result = await fetchBundledInteractive('bundled:nonexistent-pkg/content.json');
    expect(result.content).toBeNull();
    expect(result.errorType).toBe('not-found');
  });
});

describe('fetchBundledInteractive — indexed path (index.json lookup + title from index)', () => {
  it('resolves a bare id via index.json and derives the title from the index entry', async () => {
    const result = await fetchBundledInteractive('bundled:welcome-to-grafana');

    expect(result.content).not.toBeNull();
    expect(result.content!.type).toBe('interactive');
    expect(result.content!.metadata.title).toBe('Welcome to Grafana');
    expect(JSON.parse(result.content!.content).id).toBe('welcome-to-grafana');
  });

  it('returns an error when the id is absent from index.json', async () => {
    const result = await fetchBundledInteractive('bundled:no-such-id');
    expect(result.content).toBeNull();
    expect(result.error).toContain('not found in index.json');
  });
});

describe('fetchBundledInteractive — localStorage-backed guides', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('loads the WYSIWYG preview guide and uses its title', async () => {
    localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, JSON.stringify({ title: 'My Draft', blocks: [] }));

    const result = await fetchBundledInteractive('bundled:wysiwyg-preview');

    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.title).toBe('My Draft');
    expect(result.content!.type).toBe('interactive');
  });

  it('falls back to the default title when the stored preview has no title', async () => {
    localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, JSON.stringify({ blocks: [] }));

    const result = await fetchBundledInteractive('bundled:wysiwyg-preview');

    expect(result.content!.metadata.title).toBe('Preview: WYSIWYG Guide');
  });

  it('returns an empty-state error when no preview content is stored', async () => {
    const result = await fetchBundledInteractive('bundled:wysiwyg-preview');
    expect(result.content).toBeNull();
    expect(result.error).toContain('No preview content available');
  });

  it('loads the E2E test guide from localStorage', async () => {
    localStorage.setItem(StorageKeys.E2E_TEST_GUIDE, JSON.stringify({ title: 'E2E Run', blocks: [] }));

    const result = await fetchBundledInteractive('bundled:e2e-test');

    expect(result.content!.metadata.title).toBe('E2E Run');
  });
});

describe('fetchBundledInteractive — invalid shapes', () => {
  it('maps an invalid package path to a not-found error', async () => {
    // Ends in .json but fails SAFE_BUNDLED_PACKAGE_PATH (uppercase segment).
    const result = await fetchBundledInteractive('bundled:Bad/Path.json');
    expect(result.content).toBeNull();
    expect(result.errorType).toBe('not-found');
    expect(result.error).toContain('Invalid bundled package path');
  });

  it('maps an empty bundled URL to a not-found error', async () => {
    const result = await fetchBundledInteractive('bundled:');
    expect(result.content).toBeNull();
    expect(result.errorType).toBe('not-found');
    expect(result.error).toBe('Empty bundled URL');
  });
});
