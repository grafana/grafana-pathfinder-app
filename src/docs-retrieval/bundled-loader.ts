// Bundled + dynamic content loader for the docs-retrieval pipeline.
//
// Extracted from content-fetcher.ts in Phase 3 of the content-fetcher refactor
// (Pattern J — contract-surface extraction). Owns the `bundled:` URL scheme
// and its 4 sub-prefixes (wysiwyg-preview / e2e-test / pr-tests/<id> /
// <dir>/<file>.json) plus the legacy `bundled:<id>` path that consults
// `bundled-interactives/index.json` for the filename.
//
// CONTRACT SURFACES owned here (do NOT change during a structural refactor):
//
//   1. The 4 `bundled:` sub-prefixes above.
//   2. Three storage reads with these exact keys:
//        - localStorage[StorageKeys.WYSIWYG_PREVIEW_JSON]
//        - localStorage[StorageKeys.E2E_TEST_GUIDE]
//        - sessionStorage['pathfinder-bundled-' + pathId]
//      The StorageKeys constants stay in src/lib/user-storage.ts; only the
//      reads move. The writers (PrTester.tsx, the E2E runner spec) write the
//      same keys.
//   3. SAFE_PACKAGE_PATH regex unchanged.
//   4. Error message strings — preserved verbatim. Some E2E tests may match
//      them.
//   5. index.json filename fallback: `interactive.filename || `${contentId}.json``.
//
// Webpack require() literal-path constraint: this file lives at
// `src/docs-retrieval/bundled-loader.ts` (same depth as content-fetcher.ts),
// so `require('../bundled-interactives/...')` resolves to
// `src/bundled-interactives/...` — unchanged.

import { RawContent, ContentFetchResult } from '../types/content.types';
import { StorageKeys } from '../lib/user-storage';

/**
 * Fetch bundled interactive content from local files / browser storage.
 *
 * URL: `bundled:<contentId>` where contentId is one of:
 *   - 'wysiwyg-preview'           → reads localStorage[WYSIWYG_PREVIEW_JSON]
 *   - 'e2e-test'                  → reads localStorage[E2E_TEST_GUIDE]
 *   - 'pr-tests/<id>'             → reads sessionStorage['pathfinder-bundled-<id>']
 *   - '<dir>/<file>.json'         → require() under SAFE_PACKAGE_PATH whitelist
 *   - '<legacy-id>'               → looked up in bundled-interactives/index.json
 */
export async function fetchBundledInteractive(url: string): Promise<ContentFetchResult> {
  const contentId = url.replace('bundled:', '');

  // SPECIAL CASE: Handle WYSIWYG preview from localStorage
  if (contentId === 'wysiwyg-preview') {
    try {
      const previewContent = localStorage.getItem(StorageKeys.WYSIWYG_PREVIEW_JSON);

      if (!previewContent || previewContent.trim() === '') {
        return {
          content: null,
          error: 'No preview content available. Create content in the WYSIWYG editor and click Test first.',
        };
      }

      let title = 'Preview: WYSIWYG Guide';
      try {
        const parsed = JSON.parse(previewContent);
        if (parsed.title) {
          title = parsed.title;
        }
      } catch {
        // If parsing fails, use default title
      }

      const rawContent: RawContent = {
        content: previewContent,
        metadata: {
          title,
        },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
      };

      return { content: rawContent };
    } catch (error) {
      console.error('Failed to load WYSIWYG preview:', error);
      return {
        content: null,
        error: `Failed to load preview: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // SPECIAL CASE: Handle E2E test guide from localStorage
  // Used by the E2E test runner CLI to inject arbitrary JSON guides for testing.
  if (contentId === 'e2e-test') {
    try {
      const testContent = localStorage.getItem(StorageKeys.E2E_TEST_GUIDE);

      if (!testContent || testContent.trim() === '') {
        return {
          content: null,
          error: 'No E2E test content available. The E2E runner must inject JSON into localStorage first.',
        };
      }

      let title = 'E2E Test Guide';
      try {
        const parsed = JSON.parse(testContent);
        if (parsed.title) {
          title = parsed.title;
        }
      } catch {
        // If parsing fails, use default title
      }

      const rawContent: RawContent = {
        content: testContent,
        metadata: {
          title,
        },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
      };

      return { content: rawContent };
    } catch (error) {
      console.error('Failed to load E2E test guide:', error);
      return {
        content: null,
        error: `Failed to load E2E test guide: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // SPECIAL CASE: Handle PR test learning paths from sessionStorage
  if (contentId.startsWith('pr-tests/')) {
    try {
      const pathId = contentId.replace('pr-tests/', '');
      const storageKey = `pathfinder-bundled-${pathId}`;
      const pathContent = sessionStorage.getItem(storageKey);

      if (!pathContent || pathContent.trim() === '') {
        return {
          content: null,
          error: 'PR test path not found. It may have expired or been cleared.',
        };
      }

      let title = 'PR Test Path';
      try {
        const parsed = JSON.parse(pathContent);
        if (parsed.title) {
          title = parsed.title;
        }
      } catch {
        // If parsing fails, use default title
      }

      const rawContent: RawContent = {
        content: pathContent,
        metadata: {
          title,
        },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
      };

      return { content: rawContent };
    } catch (error) {
      console.error('Failed to load PR test path:', error);
      return {
        content: null,
        error: `Failed to load test path: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  // Handle package-format paths: bundled:<package-dir>/content.json
  // Produced by BundledPackageResolver (two-file package model).
  if (contentId.includes('/') && contentId.endsWith('.json')) {
    if (!SAFE_PACKAGE_PATH.test(contentId)) {
      return {
        content: null,
        error: `Invalid bundled package path: ${contentId}`,
        errorType: 'not-found',
      };
    }

    try {
      const jsonModule = require(`../bundled-interactives/${contentId}`);
      const jsonContent = typeof jsonModule === 'string' ? jsonModule : JSON.stringify(jsonModule);

      if (!jsonContent || jsonContent.trim() === '' || jsonContent === '{}') {
        return {
          content: null,
          error: `Bundled package file not found: ${contentId}`,
          errorType: 'not-found',
        };
      }

      // Webpack imports JSON as objects — read title directly to avoid a round-trip.
      const moduleTitle =
        typeof jsonModule === 'object' && jsonModule !== null && typeof jsonModule.title === 'string'
          ? jsonModule.title
          : undefined;
      const title: string = moduleTitle ?? contentId.split('/')[0] ?? contentId;

      const rawContent: RawContent = {
        content: jsonContent,
        metadata: { title },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
        isNativeJson: true,
      };

      return { content: rawContent };
    } catch (err) {
      console.warn(`[docs-retrieval] Failed to load bundled package file: ${contentId}`, err);
      return {
        content: null,
        error: `Bundled package file not found: ${contentId}`,
        errorType: 'not-found',
      };
    }
  }

  // Load bundled interactive from index.json
  // JSON format is the standard - all bundled interactives should be .json files.
  try {
    const indexData = require('../bundled-interactives/index.json');
    const interactive = indexData?.interactives?.find((item: any) => item.id === contentId);

    if (!interactive) {
      return {
        content: null,
        error: `Bundled interactive not found in index.json: ${contentId}`,
      };
    }

    const filename = interactive.filename || `${contentId}.json`;
    const jsonModule = require(`../bundled-interactives/${filename}`);

    // JSON files are imported as objects by webpack; stringify for consistent handling.
    const jsonContent = typeof jsonModule === 'string' ? jsonModule : JSON.stringify(jsonModule);

    if (!jsonContent || jsonContent.trim() === '' || jsonContent === '{}') {
      return {
        content: null,
        error: `Bundled interactive content is empty: ${contentId}`,
      };
    }

    // For JSON guides, we store the JSON string in the content field;
    // ContentProcessor detects and parses it appropriately.
    const rawContent: RawContent = {
      content: jsonContent,
      metadata: {
        title: interactive.title || contentId,
      },
      type: 'interactive',
      url,
      lastFetched: new Date().toISOString(),
    };

    return { content: rawContent };
  } catch (error) {
    console.error(`Failed to load bundled interactive ${contentId}:`, error);
    return {
      content: null,
      error: `Failed to load bundled interactive: ${contentId}. Error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

/**
 * Whitelist regex for bundled package paths (bundled:<dir>/<file>.json).
 *
 * Hoisted to module scope post-extraction so it isn't re-allocated on every
 * call. Behavior preserved verbatim — same character classes, same anchors.
 *
 * Accepts: lowercase-alnum-and-hyphen dir / lowercase-alnum-and-period-and-hyphen-and-underscore file.json
 * Rejects: ../traversal, /absolute, uppercase, double slash, non-.json
 */
export const SAFE_PACKAGE_PATH = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\.json$/;
