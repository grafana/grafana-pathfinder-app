// Loaders for `bundled:` content URLs — the offline fallback used when the
// online CDN is unavailable. Resolves bundled JSON guides from
// `src/bundled-interactives/` (via webpack `require`) or from localStorage
// (WYSIWYG preview + E2E test guides).
import { RawContent, ContentFetchResult } from '../../types/content.types';
import { StorageKeys } from '../../lib/user-storage';
import { logger } from '../../lib/logging';

/**
 * Discriminated representation of a `bundled:` URL. Adding a new
 * bundled URL shape means: extend the union, extend `parseBundledUrl`,
 * and add a loader case to the dispatcher in `fetchBundledInteractive`.
 */
type BundledRef =
  | { kind: 'wysiwyg-preview' }
  | { kind: 'e2e-test' }
  | { kind: 'package'; relativePath: string }
  | { kind: 'indexed'; id: string }
  | { kind: 'invalid'; reason: string };

const SAFE_BUNDLED_PACKAGE_PATH = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*\.json$/;

export function parseBundledUrl(url: string): BundledRef {
  const contentId = url.replace('bundled:', '');
  if (contentId === 'wysiwyg-preview') {
    return { kind: 'wysiwyg-preview' };
  }
  if (contentId === 'e2e-test') {
    return { kind: 'e2e-test' };
  }
  if (contentId.includes('/') && contentId.endsWith('.json')) {
    return SAFE_BUNDLED_PACKAGE_PATH.test(contentId)
      ? { kind: 'package', relativePath: contentId }
      : { kind: 'invalid', reason: `Invalid bundled package path: ${contentId}` };
  }
  if (contentId.length === 0) {
    return { kind: 'invalid', reason: 'Empty bundled URL' };
  }
  return { kind: 'indexed', id: contentId };
}

function readBundledLocalStorageGuide(
  url: string,
  storageKey: string,
  defaultTitle: string,
  emptyMessage: string,
  errorPrefix: string
): ContentFetchResult {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored || stored.trim() === '') {
      return { content: null, error: emptyMessage };
    }
    let title = defaultTitle;
    try {
      const parsed = JSON.parse(stored);
      if (parsed.title) {
        title = parsed.title;
      }
    } catch {
      // Fall back to default title; bad JSON is the parser's problem.
    }
    const rawContent: RawContent = {
      content: stored,
      metadata: { title },
      type: 'interactive',
      url,
      lastFetched: new Date().toISOString(),
    };
    return { content: rawContent };
  } catch (error) {
    logger.error(errorPrefix, { error });
    return {
      content: null,
      error: `${errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

function loadBundledWysiwygPreview(url: string): ContentFetchResult {
  return readBundledLocalStorageGuide(
    url,
    StorageKeys.WYSIWYG_PREVIEW_JSON,
    'Preview: WYSIWYG Guide',
    'No preview content available. Create content in the WYSIWYG editor and click Test first.',
    'Failed to load preview'
  );
}

function loadBundledE2ETest(url: string): ContentFetchResult {
  return readBundledLocalStorageGuide(
    url,
    StorageKeys.E2E_TEST_GUIDE,
    'E2E Test Guide',
    'No E2E test content available. The E2E runner must inject JSON into localStorage first.',
    'Failed to load E2E test guide'
  );
}

function loadBundledPackage(url: string, relativePath: string): ContentFetchResult {
  try {
    const jsonModule = require(`../../bundled-interactives/${relativePath}`);
    const jsonContent = typeof jsonModule === 'string' ? jsonModule : JSON.stringify(jsonModule);
    if (!jsonContent || jsonContent.trim() === '' || jsonContent === '{}') {
      return {
        content: null,
        error: `Bundled package file not found: ${relativePath}`,
        errorType: 'not-found',
      };
    }
    const moduleTitle =
      typeof jsonModule === 'object' && jsonModule !== null && typeof jsonModule.title === 'string'
        ? jsonModule.title
        : undefined;
    const title: string = moduleTitle ?? relativePath.split('/')[0] ?? relativePath;
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
    logger.warn(`[docs-retrieval] Failed to load bundled package file: ${relativePath}`, { error: err });
    return {
      content: null,
      error: `Bundled package file not found: ${relativePath}`,
      errorType: 'not-found',
    };
  }
}

function loadBundledIndexed(url: string, id: string): ContentFetchResult {
  try {
    const indexData = require('../../bundled-interactives/index.json');
    const interactive = indexData?.interactives?.find((item: any) => item.id === id);
    if (!interactive) {
      return { content: null, error: `Bundled interactive not found in index.json: ${id}` };
    }
    const filename = interactive.filename || `${id}.json`;
    const jsonModule = require(`../../bundled-interactives/${filename}`);
    const jsonContent = typeof jsonModule === 'string' ? jsonModule : JSON.stringify(jsonModule);
    if (!jsonContent || jsonContent.trim() === '' || jsonContent === '{}') {
      return { content: null, error: `Bundled interactive content is empty: ${id}` };
    }
    const rawContent: RawContent = {
      content: jsonContent,
      metadata: { title: interactive.title || id },
      type: 'interactive',
      url,
      lastFetched: new Date().toISOString(),
    };
    return { content: rawContent };
  } catch (error) {
    logger.error(`Failed to load bundled interactive ${id}`, { error });
    return {
      content: null,
      error: `Failed to load bundled interactive: ${id}. Error: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    };
  }
}

/**
 * Fetch bundled interactive content from local files
 */
export async function fetchBundledInteractive(url: string): Promise<ContentFetchResult> {
  const ref = parseBundledUrl(url);
  switch (ref.kind) {
    case 'wysiwyg-preview':
      return loadBundledWysiwygPreview(url);
    case 'e2e-test':
      return loadBundledE2ETest(url);
    case 'package':
      return loadBundledPackage(url, ref.relativePath);
    case 'indexed':
      return loadBundledIndexed(url, ref.id);
    case 'invalid':
      return { content: null, error: ref.reason, errorType: 'not-found' };
    default: {
      const _exhaustive: never = ref;
      void _exhaustive;
      return { content: null, error: 'Unknown bundled URL shape' };
    }
  }
}
