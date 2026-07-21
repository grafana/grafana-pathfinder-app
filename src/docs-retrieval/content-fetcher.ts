// Unified content fetcher - replaces docs-fetcher.ts and single-docs-fetcher.ts
// This version ONLY fetches content and extracts basic metadata
// All DOM processing is moved to React components
import { RawContent, ContentFetchResult, ContentFetchOptions, ContentType } from '../types/content.types';
import { parseUrlSafely, isTrustedFinalUrl, isInteractiveLearningUrl } from '../security';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { resolveRelativeUrls } from './resolve-relative-urls';
import { validateGuide } from '../validation';
import { generateUrlId } from './content-fetcher/url-utils';
import { extractMetadata } from './content-fetcher/metadata-extract';
import { simpleMarkdownToHtml, injectJourneyExtrasIntoJsonGuide } from './content-fetcher/cover-page';
import { fetchBundledInteractive } from './content-fetcher/bundled';
import { fetchBackendInteractive } from './content-fetcher/backend-guide';
import { enforceHttps, fetchRawHtml, generateUserFriendlyError } from './content-fetcher/fetch-raw';
import { logger } from '../lib/logging';
import {
  normalizeTelemetryUrl,
  recordContentFetch,
  recordContentFetchFallback,
  type ContentFetchTier,
} from '../lib/telemetry';

// Re-exported to keep the barrel surface stable: `injectJourneyExtrasIntoJsonGuide`
// is consumed by `components/docs-panel`, and `simpleMarkdownToHtml` by the
// sibling `content-fetcher.test.ts`.
export { simpleMarkdownToHtml, injectJourneyExtrasIntoJsonGuide };

/**
 * Wrap content as a JSON guide for unified rendering.
 * - If content is already a valid JSON guide, return it as-is
 * - If content is HTML, wrap it in a JSON guide with a single html block
 */
function wrapContentAsJsonGuide(content: string, url: string, title: string): string {
  const trimmed = content.trim();

  // Check if already a valid JSON guide
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.id && parsed.title && Array.isArray(parsed.blocks)) {
        return content; // Already a JSON guide
      }
    } catch {
      // Not valid JSON, treat as HTML
    }
  }

  // Wrap HTML in JSON guide structure
  const jsonGuide = {
    id: `external-${generateUrlId(url)}`,
    title: title || 'External Content',
    blocks: [{ type: 'html', content: content }],
  };

  return JSON.stringify(jsonGuide);
}

/**
 * Main unified content fetcher
 * Determines content type and fetches accordingly
 */
export async function fetchContent(url: string, options: ContentFetchOptions = {}): Promise<ContentFetchResult> {
  const fetchStart = performance.now();
  let tier: ContentFetchTier = 'other';
  const recordFetch = (outcome: 'ok' | 'error') =>
    recordContentFetch({ url, tier, durationMs: performance.now() - fetchStart, outcome });

  try {
    // Validate URL
    if (!url || typeof url !== 'string' || url.trim() === '') {
      logger.error('fetchContent called with invalid URL', { url });
      recordFetch('error');
      return { content: null, error: 'Invalid URL provided', errorType: 'other' };
    }

    // Handle bundled interactive content
    if (url.startsWith('bundled:')) {
      tier = 'bundled';
      const result = await fetchBundledInteractive(url);
      recordFetch(result.error ? 'error' : 'ok');
      return result;
    }
    // Handle custom guides stored in backend CRDs
    if (url.startsWith('backend-guide:')) {
      tier = 'backend-guide';
      const result = await fetchBackendInteractive(url);
      recordFetch(result.error ? 'error' : 'ok');
      return result;
    }

    // SECURITY: Validate URL is from a trusted source before fetching
    // Defense-in-depth: Even if callers validate, fetchContent provides final check
    // In production: Only Grafana docs, interactive learning domains, and bundled content
    // In dev mode: Also allows localhost and GitHub raw URLs for testing
    const isDevMode = isDevModeEnabledGlobal();
    const isTrustedSource = isTrustedFinalUrl(url);

    if (!isTrustedSource) {
      const errorMessage = isDevMode
        ? 'Only Grafana.com documentation, interactive learning URLs, localhost URLs, and GitHub raw URLs (dev mode) can be loaded'
        : 'Only Grafana.com documentation and interactive learning URLs can be loaded';

      recordFetch('error');
      return {
        content: null,
        error: errorMessage,
        errorType: 'other',
      };
    }

    // Parse hash fragment from URL
    const hashFragment = parseHashFragment(url);
    const cleanUrl = removeHashFragment(url);

    // SECURITY: Enforce HTTPS to prevent MITM attacks
    if (!enforceHttps(cleanUrl)) {
      recordFetch('error');
      return {
        content: null,
        error: 'Only HTTPS URLs are allowed for security',
        errorType: 'other',
      };
    }

    // Determine content type based on URL patterns
    const contentType = determineContentType(url);
    const metadataContentType = options.skipJourneyMetadata ? 'single-doc' : contentType;
    // Whether fetchRawHtml actually attempted the content.json ↔ unstyled.html
    // ladder for this URL. `contentType === 'learning-journey'` only matches
    // grafana.com path patterns (/tutorials/, /milestone-N/, ...) — generic
    // guides on the interactive-learning hostnames get the same ladder via a
    // separate branch in fetchRawHtml, so they must be included here too.
    const triedContentJsonLadder = contentType === 'learning-journey' || isInteractiveLearningUrl(url);

    // fetchRawHtml resolves the content.json ↔ unstyled.html ladder
    // internally (tryGrafanaDocsContentLadder) — the tier isn't knowable
    // from the requested URL alone, only from its result.
    const fetchResult = await fetchRawHtml(cleanUrl, options);
    if (!fetchResult.html) {
      // Generate user-friendly error message based on error type
      const userFriendlyError = generateUserFriendlyError(fetchResult.error, cleanUrl);
      // Terminal ladder failure: both content.json and unstyled.html were
      // tried — classify as the deepest tier attempted, not `other`.
      if (triedContentJsonLadder) {
        tier = 'unstyled-html';
        recordContentFetchFallback({
          url,
          tierUsed: 'unstyled-html',
          errorType: fetchResult.error?.errorType || 'other',
        });
      }
      recordFetch('error');
      return {
        content: null,
        error: userFriendlyError,
        errorType: fetchResult.error?.errorType || 'other',
        statusCode: fetchResult.error?.statusCode,
      };
    }

    // Use the final URL (after redirects) if available, otherwise use the requested URL
    const finalUrl = fetchResult.finalUrl || cleanUrl;

    // Determine if this is native JSON content (content.json) that doesn't need wrapping
    const isNativeJson = fetchResult.isNativeJson || false;
    tier = isNativeJson ? 'content-json' : 'unstyled-html';

    // These URLs always try content.json first (see tryGrafanaDocsContentLadder
    // / the isInteractiveLearningUrl branch in fetch-raw.ts) — landing on the
    // HTML tier for one of them means that ladder fell back.
    if (triedContentJsonLadder && tier === 'unstyled-html') {
      recordContentFetchFallback({ url, tierUsed: 'unstyled-html', errorType: 'content-json-unavailable' });
    }

    const metadata = await extractMetadata(fetchResult.html, finalUrl, metadataContentType, isNativeJson);

    let jsonContent: string;

    if (isNativeJson) {
      // Native JSON content - use directly without wrapping
      // Validate it's a proper JSON guide structure
      try {
        const parsed = JSON.parse(fetchResult.html);

        // Check if the server returned null as a signal to fetch unstyled.html
        // JSON.parse("null") returns the JavaScript value null
        if (parsed === null) {
          tier = 'unstyled-html';
          recordContentFetchFallback({ url, tierUsed: 'unstyled-html', errorType: 'content-json-null' });
          const htmlUrl = finalUrl.replace('/content.json', '/unstyled.html');
          const htmlFetchResult = await fetchRawHtml(htmlUrl, options);

          if (!htmlFetchResult.html) {
            recordFetch('error');
            return {
              content: null,
              error: 'Content not available. The server returned null and no HTML fallback exists.',
              errorType: 'not-found',
            };
          }

          const htmlMetadata = await extractMetadata(htmlFetchResult.html, htmlUrl, metadataContentType, false);
          let processedHtml = htmlFetchResult.html;

          if (contentType === 'learning-journey' && htmlMetadata.learningJourney) {
            processedHtml = generateJourneyContentWithExtras(
              processedHtml,
              htmlMetadata.learningJourney,
              options.skipReadyToBegin
            );
          }

          jsonContent = wrapContentAsJsonGuide(processedHtml, htmlUrl, htmlMetadata.title);

          // Create content with HTML metadata
          const rawContent: RawContent = {
            content: jsonContent,
            metadata: htmlMetadata,
            type: contentType,
            url: htmlUrl,
            lastFetched: new Date().toISOString(),
            hashFragment,
            isNativeJson: false,
          };

          recordFetch('ok');
          return { content: rawContent };
        }

        const validationResult = validateGuide(parsed);

        if (!validationResult.isValid) {
          // Use the first error message for the main error
          const errorMessage = validationResult.errors[0]?.message || 'Schema validation failed';
          recordFetch('error');
          return {
            content: null,
            error: `Invalid guide: ${errorMessage}`,
            errorType: 'other',
          };
        }
        jsonContent = fetchResult.html; // Valid JSON guide
      } catch {
        // Invalid JSON - treat as HTML and wrap
        logger.warn('Failed to parse native JSON, treating as HTML', { content_url: normalizeTelemetryUrl(url), tier });
        jsonContent = wrapContentAsJsonGuide(fetchResult.html, finalUrl, metadata.title);
      }
    } else {
      // HTML content - apply learning journey extras then wrap
      let processedHtml = resolveRelativeUrls(fetchResult.html, finalUrl);
      if (contentType === 'learning-journey' && metadata.learningJourney) {
        processedHtml = generateJourneyContentWithExtras(
          processedHtml,
          metadata.learningJourney,
          options.skipReadyToBegin
        );
      }

      // Wrap content as JSON guide for unified rendering pipeline
      jsonContent = wrapContentAsJsonGuide(processedHtml, finalUrl, metadata.title);
    }

    // Create unified content object
    const rawContent: RawContent = {
      content: jsonContent,
      metadata,
      type: contentType,
      url: finalUrl, // Use final URL to correctly resolve relative links
      lastFetched: new Date().toISOString(),
      hashFragment,
      isNativeJson,
    };

    recordFetch('ok');
    return { content: rawContent };
  } catch (error) {
    logger.error(`Failed to fetch content from ${normalizeTelemetryUrl(url)}`, { error });
    recordFetch('error');
    return {
      content: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: 'other',
    };
  }
}

/**
 * Determine content type based on URL patterns
 * Uses proper URL parsing to prevent path injection attacks
 */
function determineContentType(url: string): ContentType {
  // Handle undefined or empty URL
  if (!url || typeof url !== 'string') {
    logger.warn('determineContentType called with invalid URL', { url });
    return 'single-doc';
  }

  // Parse URL safely
  const parsedUrl = parseUrlSafely(url);
  if (!parsedUrl) {
    // Invalid URL, treat as single-doc
    return 'single-doc';
  }

  // Check pathname for learning journey indicators
  const pathname = parsedUrl.pathname;

  if (
    pathname.includes('/docs/learning-journeys/') ||
    pathname.includes('/docs/learning-paths/') ||
    pathname.includes('/tutorials/') || // Can be /docs/tutorials/ or /tutorials/
    pathname.match(/\/milestone-\d+/)
  ) {
    return 'learning-journey';
  }

  return 'single-doc';
}

/**
 * Parse and remove hash fragment from URL
 */
function parseHashFragment(url: string): string | undefined {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    return url.substring(hashIndex + 1);
  }
  return undefined;
}

function removeHashFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  if (hashIndex >= 0) {
    return url.substring(0, hashIndex);
  }
  return url;
}
