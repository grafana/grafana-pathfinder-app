/**
 * Characterization / tripwire tests for the `bundled:wysiwyg-preview` and
 * `bundled:e2e-test` URL kinds in content-fetcher.
 *
 * These pin the localStorage read path (Tier 2 abstraction bypass) before
 * any extraction of a preview-storage helper. They cover:
 *   - happy path: stored JSON title becomes the content title
 *   - empty key: user-facing error string preserved
 *   - malformed JSON: title falls back to the per-kind default
 *   - E2E key isolated from preview key (no crosstalk)
 */
import { StorageKeys } from '../lib/storage-keys';

import { fetchContent } from './content-fetcher';

beforeEach(() => {
  localStorage.clear();
});

describe('bundled:wysiwyg-preview', () => {
  it('returns content with the stored JSON title on success', async () => {
    localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, JSON.stringify({ title: 'My Preview Guide', sections: [] }));

    const result = await fetchContent('bundled:wysiwyg-preview');

    expect(result.error).toBeUndefined();
    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.title).toBe('My Preview Guide');
    expect(result.content!.type).toBe('interactive');
    expect(result.content!.url).toBe('bundled:wysiwyg-preview');
  });

  it('returns the empty-storage error when the key is absent', async () => {
    const result = await fetchContent('bundled:wysiwyg-preview');

    expect(result.content).toBeNull();
    expect(result.error).toMatch(/No preview content available/);
  });

  it('returns the empty-storage error when the key is whitespace-only', async () => {
    localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, '   ');

    const result = await fetchContent('bundled:wysiwyg-preview');

    expect(result.content).toBeNull();
    expect(result.error).toMatch(/No preview content available/);
  });

  it('falls back to the default title when stored JSON is malformed', async () => {
    localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, '{not valid json');

    const result = await fetchContent('bundled:wysiwyg-preview');

    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.title).toBe('Preview: WYSIWYG Guide');
  });
});

describe('bundled:e2e-test', () => {
  it('returns content with the stored JSON title on success', async () => {
    localStorage.setItem(StorageKeys.E2E_TEST_GUIDE, JSON.stringify({ title: 'E2E Scenario Alpha', sections: [] }));

    const result = await fetchContent('bundled:e2e-test');

    expect(result.error).toBeUndefined();
    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.title).toBe('E2E Scenario Alpha');
    expect(result.content!.url).toBe('bundled:e2e-test');
  });

  it('returns the empty-storage error when the key is absent', async () => {
    const result = await fetchContent('bundled:e2e-test');

    expect(result.content).toBeNull();
    expect(result.error).toMatch(/No E2E test content available/);
  });

  it('falls back to default title when stored JSON is malformed', async () => {
    localStorage.setItem(StorageKeys.E2E_TEST_GUIDE, '@@@');

    const result = await fetchContent('bundled:e2e-test');

    expect(result.content).not.toBeNull();
    expect(result.content!.metadata.title).toBe('E2E Test Guide');
  });

  it('reads the e2e-test key independently of wysiwyg-preview', async () => {
    localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, JSON.stringify({ title: 'Preview Title' }));
    localStorage.setItem(StorageKeys.E2E_TEST_GUIDE, JSON.stringify({ title: 'E2E Title' }));

    const preview = await fetchContent('bundled:wysiwyg-preview');
    const e2e = await fetchContent('bundled:e2e-test');

    expect(preview.content!.metadata.title).toBe('Preview Title');
    expect(e2e.content!.metadata.title).toBe('E2E Title');
  });
});
