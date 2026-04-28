/**
 * Unit tests for the bundled-loader module.
 *
 * Originated as the Phase 3 pre-extraction characterization safety net for
 * the content-fetcher refactor and was promoted to permanent post-tests
 * after the extraction landed (per .cursor/skills/refactor/SKILL.md per-phase
 * test sandwich).
 *
 * Pattern J (contract-surface) coverage:
 *   - 4 `bundled:` sub-prefixes (wysiwyg-preview, e2e-test, pr-tests/<id>,
 *     <dir>/<file>.json) + the legacy `bundled:<id>` index.json fallback
 *   - 3 storage-key reads (WYSIWYG_PREVIEW_JSON, E2E_TEST_GUIDE,
 *     `pathfinder-bundled-<id>`)
 *   - SAFE_PACKAGE_PATH regex negative table
 *   - error message strings (verbatim — some E2E tests may match them)
 *   - webpack require() literal-path resolution via Jest virtual mocks
 *
 * Permanent additions over the pre-extraction set:
 *   - empty contentId after the bundled: prefix
 *   - malformed JSON in pr-tests sessionStorage (default title path)
 *
 * Mocking strategy:
 *   - Real jsdom `localStorage` / `sessionStorage` (per the project convention
 *     established by `src/lib/user-storage.test.ts`).
 *   - Module-level `jest.mock` for the bundled-interactives `index.json` and
 *     for two specific content.json files (per the pattern in
 *     `src/context-engine/context-v1-recommend.test.ts:12`).
 */

// Bundled-interactives mocks must be declared at module scope so webpack's
// require() resolves through Jest's module registry. See
// content-fetcher.ts ~lines 544, 586, 598 for the require() literals.
jest.mock(
  '../bundled-interactives/index.json',
  () => ({
    interactives: [
      { id: 'mock-existing', filename: 'mock-existing.json', title: 'Mock Existing' },
      { id: 'empty-guide', filename: 'empty-guide.json' },
    ],
  }),
  { virtual: true }
);

jest.mock('../bundled-interactives/mock-existing.json', () => ({ title: 'Mock Existing', blocks: [] }), {
  virtual: true,
});

jest.mock(
  '../bundled-interactives/empty-guide.json',
  () => ({}), // empty object → JSON.stringify(...) === '{}' triggers the empty-guide error path
  { virtual: true }
);

jest.mock(
  '../bundled-interactives/welcome-to-grafana/content.json',
  () => ({ title: 'Welcome to Grafana', blocks: [{ type: 'markdown', content: 'hi' }] }),
  { virtual: true }
);

import { fetchContent } from './content-fetcher';
import { StorageKeys } from '../lib/user-storage';

describe('bundled-loader', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    jest.restoreAllMocks();
  });

  describe('bundled:wysiwyg-preview', () => {
    it('returns the canonical empty-storage error when WYSIWYG_PREVIEW_JSON is unset', async () => {
      const result = await fetchContent('bundled:wysiwyg-preview');
      expect(result.content).toBeNull();
      expect(result.error).toContain('No preview content available');
    });

    it('returns the parsed JSON content with metadata.title pulled from the JSON', async () => {
      localStorage.setItem(StorageKeys.WYSIWYG_PREVIEW_JSON, JSON.stringify({ title: 'Preview Title', blocks: [] }));
      const result = await fetchContent('bundled:wysiwyg-preview');
      expect(result.content).not.toBeNull();
      expect(result.content!.metadata.title).toBe('Preview Title');
      expect(result.content!.type).toBe('interactive');
      expect(result.content!.url).toBe('bundled:wysiwyg-preview');
    });
  });

  describe('bundled:e2e-test', () => {
    it('returns the canonical empty-storage error when E2E_TEST_GUIDE is unset', async () => {
      const result = await fetchContent('bundled:e2e-test');
      expect(result.content).toBeNull();
      expect(result.error).toContain('No E2E test content available');
    });
  });

  describe('bundled:pr-tests/<id>', () => {
    it('returns the parsed JSON when sessionStorage[`pathfinder-bundled-<id>`] is set', async () => {
      sessionStorage.setItem('pathfinder-bundled-abc', JSON.stringify({ title: 'PR Path', blocks: [] }));
      const result = await fetchContent('bundled:pr-tests/abc');
      expect(result.content).not.toBeNull();
      expect(result.content!.metadata.title).toBe('PR Path');
      expect(result.content!.type).toBe('interactive');
    });

    it('returns the canonical not-found error when the sessionStorage key is unset', async () => {
      const result = await fetchContent('bundled:pr-tests/unknown');
      expect(result.content).toBeNull();
      expect(result.error).toContain('PR test path not found');
    });
  });

  describe('SAFE_PACKAGE_PATH regex semantics', () => {
    type Reject = { name: string; contentId: string };
    const rejects: Reject[] = [
      { name: '../x.json (path traversal)', contentId: '../x.json' },
      { name: 'Foo/bar.json (uppercase dir)', contentId: 'Foo/bar.json' },
      { name: 'a/b.txt (wrong extension)', contentId: 'a/b.txt' },
      { name: '/abs/x.json (leading slash)', contentId: '/abs/x.json' },
      { name: 'a//b.json (empty segment)', contentId: 'a//b.json' },
    ];

    it.each(rejects)('rejects $name with errorType: not-found', async ({ contentId }) => {
      // Note: '../x.json' and '/abs/x.json' include '/' and end with '.json' so
      // they hit the package-path branch. 'a/b.txt' does NOT end with '.json'
      // and falls through to the index.json branch — its expected error is
      // different. Keep these in two buckets:
      const result = await fetchContent(`bundled:${contentId}`);
      expect(result.content).toBeNull();
      if (contentId.includes('/') && contentId.endsWith('.json')) {
        // package-path branch
        expect(result.errorType).toBe('not-found');
        expect(result.error).toContain('Invalid bundled package path');
      } else {
        // index.json fallback branch (e.g., 'a/b.txt')
        expect(result.error).toContain('not found in index.json');
      }
    });
  });

  describe('package-path: bundled:<dir>/<file>.json (webpack require)', () => {
    it('resolves via the mocked require and returns isNativeJson:true with title from the JSON module', async () => {
      const result = await fetchContent('bundled:welcome-to-grafana/content.json');
      expect(result.content).not.toBeNull();
      expect(result.content!.isNativeJson).toBe(true);
      expect(result.content!.metadata.title).toBe('Welcome to Grafana');
      expect(result.content!.type).toBe('interactive');
    });
  });

  describe('legacy bundled:<id> via index.json', () => {
    it('returns the canonical not-found error when the id is missing from index.json', async () => {
      const result = await fetchContent('bundled:missing-id');
      expect(result.content).toBeNull();
      expect(result.error).toContain('not found in index.json');
    });

    it('returns the canonical empty-content error when the require resolves to an empty object', async () => {
      const result = await fetchContent('bundled:empty-guide');
      expect(result.content).toBeNull();
      expect(result.error).toContain('content is empty');
    });
  });

  // Permanent additions (post-test promotion) — corner cases the pre-test skipped.
  describe('post-extraction additions', () => {
    it('treats `bundled:` with empty contentId as a missing index.json id (not an empty-content error)', async () => {
      // contentId === '' has no '/', does not end with '.json', so it routes
      // to the legacy index.json branch and reports "not found in index.json".
      const result = await fetchContent('bundled:');
      expect(result.content).toBeNull();
      expect(result.error).toContain('not found in index.json');
    });

    it('falls back to the default "PR Test Path" title when sessionStorage has malformed JSON', async () => {
      // The JSON.parse failure path silently uses the default title — pinning
      // that the pr-tests branch does NOT propagate parse errors.
      sessionStorage.setItem('pathfinder-bundled-malformed', '{not json');
      const result = await fetchContent('bundled:pr-tests/malformed');
      expect(result.content).not.toBeNull();
      expect(result.content!.metadata.title).toBe('PR Test Path');
      expect(result.content!.content).toBe('{not json'); // raw payload preserved
    });
  });
});
