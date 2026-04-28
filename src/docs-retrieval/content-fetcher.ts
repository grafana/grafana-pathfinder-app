// Unified content fetcher - replaces docs-fetcher.ts and single-docs-fetcher.ts
// This version ONLY fetches content and extracts basic metadata
// All DOM processing is moved to React components
import {
  RawContent,
  ContentFetchResult,
  ContentFetchOptions,
  ContentType,
  LearningJourneyMetadata,
} from '../types/content.types';
import { config, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { parseUrlSafely, isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from '../security';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { resolveRelativeUrls } from './resolve-relative-urls';
import { validateGuide } from '../validation';
import { simpleMarkdownToHtml, wrapExpectBlockInOrangeOutline } from './markdown-renderer';
import { extractMetadata } from './metadata-extractor';
import { fetchBundledInteractive } from './bundled-loader';
import { fetchRawHtml, enforceHttps, type FetchError } from './raw-fetch';

/**
 * Generate a simple ID from a URL for use in wrapped JSON guides.
 */
function generateUrlId(url: string): string {
  // Create a simple hash-like ID from the URL
  const cleanUrl = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-');
  return cleanUrl.slice(0, 50);
}

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
  try {
    // Validate URL
    if (!url || typeof url !== 'string' || url.trim() === '') {
      console.error('fetchContent called with invalid URL:', url);
      return { content: null, error: 'Invalid URL provided', errorType: 'other' };
    }

    // Handle bundled interactive content
    if (url.startsWith('bundled:')) {
      return await fetchBundledInteractive(url);
    }
    // Handle custom guides stored in backend CRDs
    if (url.startsWith('backend-guide:')) {
      return await fetchBackendInteractive(url);
    }

    // SECURITY: Validate URL is from a trusted source before fetching
    // Defense-in-depth: Even if callers validate, fetchContent provides final check
    // In production: Only Grafana docs, interactive learning domains, and bundled content
    // In dev mode: Also allows localhost and GitHub raw URLs for testing
    const isDevMode = isDevModeEnabledGlobal();
    const isTrustedSource = isAllowedContentUrl(url) || (isDevMode && (isLocalhostUrl(url) || isGitHubRawUrl(url)));

    if (!isTrustedSource) {
      const errorMessage = isDevMode
        ? 'Only Grafana.com documentation, interactive learning URLs, localhost URLs, and GitHub raw URLs (dev mode) can be loaded'
        : 'Only Grafana.com documentation and interactive learning URLs can be loaded';

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
      return {
        content: null,
        error: 'Only HTTPS URLs are allowed for security',
        errorType: 'other',
      };
    }

    // Determine content type based on URL patterns
    const contentType = determineContentType(url);

    // Fetch raw HTML with structured error handling
    const fetchResult = await fetchRawHtml(cleanUrl, options);
    if (!fetchResult.html) {
      // Generate user-friendly error message based on error type
      const userFriendlyError = generateUserFriendlyError(fetchResult.error, cleanUrl);
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

    const metadata = await extractMetadata(fetchResult.html, finalUrl, contentType, isNativeJson);

    let jsonContent: string;

    if (isNativeJson) {
      // Native JSON content - use directly without wrapping
      // Validate it's a proper JSON guide structure
      try {
        const parsed = JSON.parse(fetchResult.html);

        // Check if the server returned null as a signal to fetch unstyled.html
        // JSON.parse("null") returns the JavaScript value null
        if (parsed === null) {
          const htmlUrl = finalUrl.replace('/content.json', '/unstyled.html');
          const htmlFetchResult = await fetchRawHtml(htmlUrl, options);

          if (!htmlFetchResult.html) {
            return {
              content: null,
              error: 'Content not available. The server returned null and no HTML fallback exists.',
              errorType: 'not-found',
            };
          }

          const htmlMetadata = await extractMetadata(htmlFetchResult.html, htmlUrl, contentType, false);
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

          return { content: rawContent };
        }

        const validationResult = validateGuide(parsed);

        if (!validationResult.isValid) {
          // Use the first error message for the main error
          const errorMessage = validationResult.errors[0]?.message || 'Schema validation failed';
          return {
            content: null,
            error: `Invalid guide: ${errorMessage}`,
            errorType: 'other',
          };
        }
        jsonContent = fetchResult.html; // Valid JSON guide
      } catch {
        // Invalid JSON - treat as HTML and wrap
        console.warn('Failed to parse native JSON, treating as HTML');
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

    return { content: rawContent };
  } catch (error) {
    console.error(`Failed to fetch content from ${url}:`, error);
    return {
      content: null,
      error: error instanceof Error ? error.message : 'Unknown error',
      errorType: 'other',
    };
  }
}

interface BackendGuideResource {
  metadata?: {
    name?: string;
  };
  spec?: {
    id?: string;
    title?: string;
    schemaVersion?: string;
    blocks?: unknown[];
  };
}

async function fetchBackendInteractive(url: string): Promise<ContentFetchResult> {
  const resourceName = url.replace('backend-guide:', '').trim();
  const namespace = config.namespace;

  if (!resourceName) {
    return { content: null, error: 'Invalid backend guide resource name', errorType: 'other' };
  }

  if (!namespace) {
    return { content: null, error: 'No namespace available to load custom guide', errorType: 'other' };
  }

  try {
    // SECURITY: Encode resourceName to prevent path traversal (F3)
    const endpoint = `/apis/pathfinderbackend.ext.grafana.com/v1alpha1/namespaces/${namespace}/interactiveguides/${encodeURIComponent(resourceName)}`;
    const response = await lastValueFrom(
      getBackendSrv().fetch<BackendGuideResource>({
        url: endpoint,
        method: 'GET',
        // Optional rollout endpoint: don't show a global toast when unavailable.
        showErrorAlert: false,
      })
    );
    const guideResource = response.data;

    if (!guideResource?.spec?.blocks || !guideResource.spec.title) {
      return {
        content: null,
        error: `Custom guide is missing required fields: ${resourceName}`,
        errorType: 'other',
      };
    }

    const guide = {
      id: guideResource.spec.id || guideResource.metadata?.name || resourceName,
      title: guideResource.spec.title,
      schemaVersion: guideResource.spec.schemaVersion || '1.0',
      blocks: guideResource.spec.blocks,
    };

    const validationResult = validateGuide(guide);
    if (!validationResult.isValid) {
      const errorMessage = validationResult.errors[0]?.message || 'Schema validation failed';
      return {
        content: null,
        error: `Invalid custom guide: ${errorMessage}`,
        errorType: 'other',
      };
    }

    return {
      content: {
        content: JSON.stringify(guide),
        metadata: {
          title: guide.title,
        },
        type: 'interactive',
        url,
        lastFetched: new Date().toISOString(),
      },
    };
  } catch (error) {
    return {
      content: null,
      error: `Failed to load custom guide: ${resourceName}`,
      errorType: 'other',
      statusCode: (error as { status?: number })?.status,
    };
  }
}

/**
 * Generate user-friendly error messages based on error type
 */
function generateUserFriendlyError(error: FetchError | undefined, url: string): string {
  if (!error) {
    return 'Failed to load content. Please try again.';
  }

  switch (error.errorType) {
    case 'not-found':
      return 'Document not found. It may have been moved or removed.';
    case 'timeout':
      return 'Request timed out. Please check your internet connection and try again.';
    case 'network':
      return 'Unable to connect. Please check your internet connection or try again later.';
    case 'server-error':
      return 'Server error occurred. Please try again later.';
    default:
      return error.message || 'Failed to load content. Please try again.';
  }
}

/**
 * Determine content type based on URL patterns
 * Uses proper URL parsing to prevent path injection attacks
 */
function determineContentType(url: string): ContentType {
  // Handle undefined or empty URL
  if (!url || typeof url !== 'string') {
    console.warn('determineContentType called with invalid URL:', url);
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

/**
 * Inject "Ready to begin" button, bottom navigation, and orange-outline-list
 * card styling into JSON guide content for path packages.
 *
 * Lives in the orchestration hub rather than `package-fetcher.ts` so that
 * docs-panel can call it directly without pulling in the resolver singleton.
 * Falls back to returning the original content if parsing fails.
 */
export function injectJourneyExtrasIntoJsonGuide(jsonContent: string, metadata: LearningJourneyMetadata): string {
  try {
    const parsed = JSON.parse(jsonContent) as {
      id?: string;
      title?: string;
      blocks?: Array<{ type: string; content?: string }>;
    };
    if (!parsed.blocks || !Array.isArray(parsed.blocks)) {
      return jsonContent;
    }

    wrapExpectBlockInOrangeOutline(parsed.blocks);

    const extrasHtml = generateJourneyContentWithExtras('', metadata);

    const htmlParts: string[] = [];
    for (const block of parsed.blocks) {
      if (!block.content) {
        continue;
      }
      if (block.type === 'html') {
        htmlParts.push(block.content);
      } else if (block.type === 'markdown') {
        htmlParts.push(simpleMarkdownToHtml(block.content));
      }
    }

    if (extrasHtml.trim()) {
      htmlParts.push(extrasHtml);
    }

    const merged = {
      id: parsed.id,
      title: parsed.title,
      blocks: [{ type: 'html', content: htmlParts.join('\n') }],
    };

    return JSON.stringify(merged);
  } catch {
    return jsonContent;
  }
}
