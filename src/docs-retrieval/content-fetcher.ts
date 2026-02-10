// Unified content fetcher - replaces docs-fetcher.ts and single-docs-fetcher.ts
// This version ONLY fetches content and extracts basic metadata
// All DOM processing is moved to React components
import {
  RawContent,
  ContentFetchResult,
  ContentFetchOptions,
  ContentType,
  ContentMetadata,
  LearningJourneyMetadata,
  SingleDocMetadata,
  Milestone,
} from './content.types';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../constants';
import {
  parseUrlSafely,
  isAllowedContentUrl,
  isGrafanaDocsUrl,
  isLocalhostUrl,
  isInteractiveLearningUrl,
  isGitHubRawUrl,
} from '../security';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { StorageKeys } from '../lib/user-storage';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { validateGuide } from '../validation';

// Internal error structure for detailed error handling
interface FetchError {
  message: string;
  errorType: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';
  statusCode?: number;
}

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
 * SECURITY: Enforce HTTPS for all external URLs to prevent MITM attacks
 * Exceptions: localhost in dev mode
 */
function enforceHttps(url: string): boolean {
  // Parse URL safely
  const parsedUrl = parseUrlSafely(url);
  if (!parsedUrl) {
    console.error('Invalid URL format:');
    return false;
  }

  // Allow HTTP for localhost in dev mode (for local testing)
  if (isDevModeEnabledGlobal() && isLocalhostUrl(url)) {
    return true;
  }

  // Require HTTPS for all other URLs
  if (parsedUrl.protocol !== 'https:') {
    console.error('Only HTTPS URLs are allowed');
    return false;
  }

  return true;
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

    // Extract basic metadata without DOM processing
    // For native JSON, we still need to extract metadata from the content
    const metadata = await extractMetadata(fetchResult.html, finalUrl, contentType);

    let jsonContent: string;

    if (isNativeJson) {
      // Native JSON content - use directly without wrapping
      // Validate it's a proper JSON guide structure
      try {
        const parsed = JSON.parse(fetchResult.html);
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
      let processedHtml = fetchResult.html;
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
 * Fetch bundled interactive content from local files
 */
async function fetchBundledInteractive(url: string): Promise<ContentFetchResult> {
  const contentId = url.replace('bundled:', '');

  // SPECIAL CASE: Handle WYSIWYG preview from localStorage
  if (contentId === 'wysiwyg-preview') {
    try {
      // Load JSON content from the dedicated preview key
      const previewContent = localStorage.getItem(StorageKeys.WYSIWYG_PREVIEW_JSON);

      if (!previewContent || previewContent.trim() === '') {
        return {
          content: null,
          error: 'No preview content available. Create content in the WYSIWYG editor and click Test first.',
        };
      }

      // Content is already JSON - parse to extract title for metadata
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
        content: previewContent, // Already valid JSON guide format
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
  // This is used by the E2E test runner CLI to inject arbitrary JSON guides for testing
  if (contentId === 'e2e-test') {
    try {
      // Load JSON content from the E2E test key
      const testContent = localStorage.getItem(StorageKeys.E2E_TEST_GUIDE);

      if (!testContent || testContent.trim() === '') {
        return {
          content: null,
          error: 'No E2E test content available. The E2E runner must inject JSON into localStorage first.',
        };
      }

      // Content is already JSON - parse to extract title for metadata
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
        content: testContent, // Already valid JSON guide format
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

      // Content is already JSON - parse to extract title for metadata
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
        content: pathContent, // Already valid JSON guide format
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

  // Load bundled interactive from index.json
  // JSON format is the standard - all bundled interactives should be .json files
  try {
    // Load the index.json to find the correct filename for this interactive
    const indexData = require('../bundled-interactives/index.json');
    const interactive = indexData?.interactives?.find((item: any) => item.id === contentId);

    if (!interactive) {
      return {
        content: null,
        error: `Bundled interactive not found in index.json: ${contentId}`,
      };
    }

    // Load JSON guide (standard format)
    const filename = interactive.filename || `${contentId}.json`;
    const jsonModule = require(`../bundled-interactives/${filename}`);

    // JSON files are imported as objects by webpack, stringify for consistent handling
    const jsonContent = typeof jsonModule === 'string' ? jsonModule : JSON.stringify(jsonModule);

    if (!jsonContent || jsonContent.trim() === '' || jsonContent === '{}') {
      return {
        content: null,
        error: `Bundled interactive content is empty: ${contentId}`,
      };
    }

    // For JSON guides, we store the JSON string in the content field
    // The ContentProcessor will detect and parse it appropriately
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
    pathname.includes('/learning-journeys/') || // Can be /docs/learning-journeys/ or /learning-journeys/
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
 * Fetch raw HTML content using multiple strategies
 * Combines logic from both existing fetchers
 * Returns structured result with HTML, final URL (after redirects), and error details
 */
/**
 * Internal fetch result type that includes native JSON detection
 */
interface FetchRawResult {
  html: string | null;
  finalUrl?: string;
  error?: FetchError;
  /** Whether the content was fetched as native JSON (content.json) vs HTML */
  isNativeJson?: boolean;
}

/**
 * Check if a URL points to a JSON file (content.json)
 */
function isJsonContentUrl(url: string): boolean {
  // Check the URL path, ignoring query params and fragments
  const urlPath = url.split('?')[0].split('#')[0];
  return urlPath.endsWith('.json') || urlPath.endsWith('/content.json');
}

/**
 * Try multiple URL variations in order, returning the first successful result.
 * This is used for content URLs where we want to try content.json first, then unstyled.html.
 */
async function tryUrlVariations(urls: string[], options: ContentFetchOptions): Promise<FetchRawResult> {
  const { headers = {}, timeout = DEFAULT_CONTENT_FETCH_TIMEOUT } = options;
  let lastError: FetchError | undefined;

  const fetchOptions: RequestInit = {
    method: 'GET',
    headers: { ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  };

  for (const urlVariation of urls) {
    try {
      const response = await fetch(urlVariation, fetchOptions);

      if (response.ok) {
        const content = await response.text();
        if (content && content.trim()) {
          // SECURITY: Validate the final URL is trusted
          const finalUrl = response.url;
          const isDevMode = isDevModeEnabledGlobal();
          const isFinalUrlTrusted =
            isAllowedContentUrl(finalUrl) ||
            (isDevMode && isLocalhostUrl(finalUrl)) ||
            (isDevMode && isGitHubRawUrl(finalUrl));

          if (!isFinalUrlTrusted) {
            console.warn(`URL variation ${urlVariation} redirected to untrusted URL: ${finalUrl}`);
            continue; // Try next variation
          }

          // Detect if this is native JSON content
          const isNativeJson = isJsonContentUrl(response.url) || isJsonContentUrl(urlVariation);
          return { html: content, finalUrl: response.url, isNativeJson };
        }
      }

      // 404 means this variation doesn't exist - try next one
      if (response.status === 404) {
        continue;
      }

      // Other errors - record but try next variation
      lastError = {
        message: `HTTP ${response.status}: ${response.statusText}`,
        errorType: response.status >= 500 ? 'server-error' : 'other',
        statusCode: response.status,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('aborted');
      const isNetwork =
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('CORS');

      lastError = {
        message: errorMessage,
        errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'other',
      };
      // Continue to next variation on network errors
    }
  }

  // All variations failed
  if (lastError) {
    console.error(`Failed to fetch from any URL variation. Last error: ${lastError.message}`);
  }
  return { html: null, error: lastError || { message: 'No content found', errorType: 'not-found' } };
}

async function fetchRawHtml(url: string, options: ContentFetchOptions): Promise<FetchRawResult> {
  const { headers = {}, timeout = DEFAULT_CONTENT_FETCH_TIMEOUT } = options;

  // For interactive learning URLs, try content.json first, then unstyled.html
  if (isInteractiveLearningUrl(url)) {
    const variations = generateInteractiveLearningVariations(url);
    if (variations.length > 0) {
      return tryUrlVariations(variations, options);
    }
  }

  const fetchOptions: RequestInit = {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'User-Agent': 'Grafana-Docs-Plugin/1.0',
      ...headers,
    },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  };

  let lastError: FetchError | undefined;

  try {
    const response = await fetch(url, fetchOptions);

    if (response.ok) {
      const html = await response.text();
      if (html && html.trim()) {
        // SECURITY: Validate redirect target is still trusted
        const finalUrl = response.url;
        const isDevMode = isDevModeEnabledGlobal();
        const isFinalUrlTrusted =
          isAllowedContentUrl(finalUrl) ||
          (isDevMode && isLocalhostUrl(finalUrl)) ||
          (isDevMode && isGitHubRawUrl(finalUrl));

        if (!isFinalUrlTrusted) {
          console.warn(
            `Redirect target not in trusted domain list.\n` +
              `Original URL: ${url}\n` +
              `Final URL: ${finalUrl}\n` +
              `isAllowedContentUrl: ${isAllowedContentUrl(finalUrl)}`
          );
          lastError = {
            message: 'Redirect target is not in trusted domain list',
            errorType: 'other',
          };
          return { html: null, error: lastError };
        }

        // SECURITY: Enforce HTTPS on redirect target
        if (!enforceHttps(finalUrl)) {
          lastError = {
            message: 'Redirect to non-HTTPS URL blocked for security',
            errorType: 'other',
          };
          return { html: null, error: lastError };
        }

        // If this is a Grafana docs/tutorial URL, try to get content in this order:
        // 1. content.json (new JSON format - preferred)
        // 2. unstyled.html (legacy HTML format - fallback)
        // Use proper URL parsing to prevent domain hijacking attacks
        const shouldFetchContent = isGrafanaDocsUrl(finalUrl) || (isDevModeEnabledGlobal() && isLocalhostUrl(finalUrl));

        if (shouldFetchContent) {
          const { jsonUrl, htmlUrl } = getContentUrls(response.url);

          // Determine fetch order based on domain:
          // - grafana.com/docs and grafana.com/tutorials: HTML first (JSON not yet available)
          // - Other sources: JSON first (preferred format)
          const preferHtmlFirst = isGrafanaComDocsOrTutorials(finalUrl);

          const primaryUrl = preferHtmlFirst ? htmlUrl : jsonUrl;
          const fallbackUrl = preferHtmlFirst ? jsonUrl : htmlUrl;
          const primaryIsJson = !preferHtmlFirst;

          // Try primary format first
          if (primaryUrl !== response.url) {
            try {
              const primaryResponse = await fetch(primaryUrl, fetchOptions);
              if (primaryResponse.ok) {
                const primaryContent = await primaryResponse.text();
                if (primaryContent && primaryContent.trim()) {
                  return { html: primaryContent, finalUrl: primaryResponse.url, isNativeJson: primaryIsJson };
                }
              }
            } catch {
              // Primary fetch failed - fall through to fallback
            }
          }

          // Fall back to secondary format
          if (fallbackUrl !== response.url) {
            try {
              const fallbackResponse = await fetch(fallbackUrl, fetchOptions);
              if (fallbackResponse.ok) {
                const fallbackContent = await fallbackResponse.text();
                if (fallbackContent && fallbackContent.trim()) {
                  return { html: fallbackContent, finalUrl: fallbackResponse.url, isNativeJson: !primaryIsJson };
                }
              }
              lastError = {
                message: `Cannot load Grafana content. Neither content.json nor unstyled.html found at: ${response.url}`,
                errorType: fallbackResponse.status === 404 ? 'not-found' : 'other',
                statusCode: fallbackResponse.status,
              };
              return { html: null, error: lastError };
            } catch (fallbackError) {
              lastError = {
                message: `Cannot load Grafana content. Content fetch failed: ${
                  fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
                }`,
                errorType: 'other',
              };
              return { html: null, error: lastError };
            }
          }
        }

        // Content fetched successfully
        const isNativeJson = isJsonContentUrl(response.url) || isJsonContentUrl(url);
        return { html, finalUrl: response.url, isNativeJson };
      }
    } else if (response.status >= 300 && response.status < 400) {
      // Handle manual redirect cases
      const location = response.headers.get('Location');
      if (location) {
        lastError = {
          message: `Redirect to ${location} (status ${response.status})`,
          errorType: 'other',
          statusCode: response.status,
        };
        console.warn(`Manual redirect detected from ${url}:`, lastError.message);

        if (location.startsWith('/')) {
          try {
            const originalUrl = new URL(url);
            const redirectUrl = new URL(location, originalUrl.origin);

            if (redirectUrl.origin !== originalUrl.origin) {
              console.warn(`Blocked redirect to different origin: ${redirectUrl.origin}`);
              lastError = {
                message: `Cross-origin redirect blocked for security: ${redirectUrl.origin}`,
                errorType: 'other',
              };
            } else {
              const isDevMode = isDevModeEnabledGlobal();
              const isRedirectTrusted =
                isAllowedContentUrl(redirectUrl.href) ||
                (isDevMode && isLocalhostUrl(redirectUrl.href)) ||
                (isDevMode && isGitHubRawUrl(redirectUrl.href));

              if (!isRedirectTrusted) {
                console.warn(`Redirect target not in trusted domain list: ${redirectUrl.href}`);
                lastError = {
                  message: 'Redirect target is not in trusted domain list',
                  errorType: 'other',
                };
              } else {
                const redirectResponse = await fetch(redirectUrl.href, fetchOptions);
                if (redirectResponse.ok) {
                  const html = await redirectResponse.text();
                  if (html && html.trim()) {
                    const isNativeJson = isJsonContentUrl(redirectResponse.url) || isJsonContentUrl(redirectUrl.href);
                    return { html, finalUrl: redirectResponse.url, isNativeJson };
                  }
                }
              }
            }
          } catch (redirectError) {
            console.warn(`Failed to fetch redirect target:`, redirectError);
            lastError = {
              message: redirectError instanceof Error ? redirectError.message : 'Redirect failed',
              errorType: 'other',
            };
          }
        }
      } else {
        lastError = {
          message: `Redirect response (status ${response.status}) but no Location header`,
          errorType: 'other',
          statusCode: response.status,
        };
      }
    } else {
      const errorType = response.status === 404 ? 'not-found' : response.status >= 500 ? 'server-error' : 'other';
      lastError = {
        message: `HTTP ${response.status}: ${response.statusText}`,
        errorType,
        statusCode: response.status,
      };
      console.warn(`Failed to fetch from ${url}: ${lastError.message}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = errorMessage.includes('timeout') || errorMessage.includes('aborted');
    const isNetwork =
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('CORS') ||
      errorMessage.includes('network');

    lastError = {
      message: errorMessage,
      errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'other',
    };
    console.warn(`Failed to fetch from ${url}:`, error);
  }

  if (lastError) {
    console.error(`Failed to fetch content from ${url}. Last error: ${lastError.message}`);
  }

  return { html: null, error: lastError };
}

/**
 * Generate URL variations for interactive learning content
 * Tries content.json first (preferred JSON format), then unstyled.html (fallback)
 *
 * @param url - The interactive learning URL
 * @returns Array of URLs to try in order: [content.json, unstyled.html]
 */
function generateInteractiveLearningVariations(url: string): string[] {
  const variations: string[] = [];

  // Only generate variations for interactive learning URLs
  if (!isInteractiveLearningUrl(url)) {
    return variations;
  }

  // Clean the URL path (remove trailing slash)
  const baseUrl = url.split('?')[0].split('#')[0].replace(/\/$/, '');

  // If URL already points to content.json or unstyled.html, return as-is
  if (baseUrl.endsWith('/content.json') || baseUrl.endsWith('/unstyled.html')) {
    return [url];
  }

  // Try content.json first (preferred), then unstyled.html as fallback
  variations.push(`${baseUrl}/content.json`);
  variations.push(`${baseUrl}/unstyled.html`);

  return variations;
}

/**
 * Check if a URL is specifically grafana.com/docs/* or grafana.com/tutorials/*
 * These domains don't have content.json available yet, so we prefer unstyled.html
 * Other sources (like interactive learning domains) should still try JSON first.
 */
function isGrafanaComDocsOrTutorials(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // Only match grafana.com (no subdomains) with /docs/ or /tutorials/ paths
    return (
      url.hostname === 'grafana.com' && (url.pathname.startsWith('/docs/') || url.pathname.startsWith('/tutorials/'))
    );
  } catch {
    return false;
  }
}

/**
 * Get content URLs for both JSON and HTML formats
 * Returns URLs to try in order of preference: JSON first, then HTML
 */
function getContentUrls(url: string): { jsonUrl: string; htmlUrl: string } {
  const baseUrl = url.split('?')[0].split('#')[0].replace(/\/$/, '');

  // If URL already points to a specific file, return it as-is for JSON detection
  if (url.includes('/content.json')) {
    return { jsonUrl: url, htmlUrl: baseUrl.replace('/content.json', '/unstyled.html') };
  }
  if (url.includes('/unstyled.html')) {
    return { jsonUrl: baseUrl.replace('/unstyled.html', '/content.json'), htmlUrl: url };
  }

  return {
    jsonUrl: `${baseUrl}/content.json`,
    htmlUrl: `${baseUrl}/unstyled.html`,
  };
}

/**
 * Extract metadata from HTML without DOM processing
 * Uses simple string parsing instead of DOM manipulation
 */
async function extractMetadata(html: string, url: string, contentType: ContentType): Promise<ContentMetadata> {
  const title = extractTitle(html);

  if (contentType === 'learning-journey') {
    const learningJourney = await extractLearningJourneyMetadata(html, url);
    return { title, learningJourney };
  } else {
    const singleDoc = extractSingleDocMetadata(html);
    return { title, singleDoc };
  }
}

/**
 * Extract page title using simple string parsing
 */
function extractTitle(html: string): string {
  // Try multiple title extraction strategies
  const titlePatterns = [
    /<title[^>]*>([^<]+)<\/title>/i,
    /<h1[^>]*>([^<]+)<\/h1>/i,
    /<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i,
  ];

  for (const pattern of titlePatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return 'Documentation';
}

/**
 * Extract learning journey metadata using simple parsing
 * Replaces complex DOM processing with string-based extraction
 */
async function extractLearningJourneyMetadata(html: string, url: string): Promise<LearningJourneyMetadata> {
  const baseUrl = getLearningJourneyBaseUrl(url);

  // Extract milestones from index.json metadata file
  const milestones = await fetchLearningJourneyMetadataFromJson(baseUrl);
  const currentMilestone = findCurrentMilestoneFromUrl(url, milestones);

  // Since we now filter and renumber milestones sequentially (1, 2, 3, ...),
  // totalMilestones is simply the array length
  const totalMilestones = milestones.length;

  // Extract summary from first few paragraphs (simple string matching)
  const summary = extractJourneySummary(html);

  return {
    currentMilestone,
    totalMilestones,
    milestones,
    baseUrl,
    summary,
  };
}

/**
 * Extract single doc metadata
 */
function extractSingleDocMetadata(html: string): SingleDocMetadata {
  const summary = extractDocSummary(html);
  return { summary };
}

/**
 * Simple summary extraction using string parsing
 */
function extractJourneySummary(html: string): string {
  // Look for first few paragraphs
  const paragraphMatches = html.match(/<p[^>]*>(.*?)<\/p>/gi);
  if (paragraphMatches && paragraphMatches.length > 0) {
    const firstParagraphs = paragraphMatches.slice(0, 3);
    const text = firstParagraphs
      .map((p) => p.replace(/<[^>]+>/g, '').trim())
      .join(' ')
      .substring(0, 300);

    return text + (text.length >= 300 ? '...' : '');
  }

  return '';
}

function extractDocSummary(html: string): string {
  // Try meta description first
  const metaMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
  if (metaMatch && metaMatch[1]) {
    return metaMatch[1];
  }

  // Fallback to first paragraph
  const paragraphMatch = html.match(/<p[^>]*>(.*?)<\/p>/i);
  if (paragraphMatch && paragraphMatch[1]) {
    return paragraphMatch[1]
      .replace(/<[^>]+>/g, '')
      .trim()
      .substring(0, 200);
  }

  return '';
}

/**
 * Learning journey specific functions
 * These are simplified versions that focus on data extraction only
 */
function getLearningJourneyBaseUrl(url: string): string {
  // Handle cases like:
  // https://grafana.com/docs/learning-journeys/drilldown-logs/ -> https://grafana.com/docs/learning-journeys/drilldown-logs
  // https://grafana.com/docs/learning-journeys/drilldown-logs/milestone-1/ -> https://grafana.com/docs/learning-journeys/drilldown-logs
  // https://grafana.com/tutorials/alerting-get-started/ -> https://grafana.com/tutorials/alerting-get-started

  const learningJourneyMatch = url.match(/^(https?:\/\/[^\/]+\/docs\/learning-journeys\/[^\/]+)/);
  if (learningJourneyMatch) {
    return learningJourneyMatch[1];
  }

  const tutorialMatch = url.match(/^(https?:\/\/[^\/]+\/tutorials\/[^\/]+)/);
  if (tutorialMatch) {
    return tutorialMatch[1];
  }

  return url.replace(/\/milestone-\d+.*$/, '').replace(/\/$/, '');
}

async function fetchLearningJourneyMetadataFromJson(baseUrl: string): Promise<Milestone[]> {
  try {
    const indexJsonUrl = `${baseUrl}/index.json`;
    const response = await fetch(indexJsonUrl);

    if (response.ok) {
      const data = await response.json();

      // The actual structure is an array of Hugo/Jekyll page objects
      if (Array.isArray(data)) {
        // First, filter out milestones that should be skipped
        const validItems = data.filter((item) => {
          // Skip if grafana.skip is true
          return !item.params?.grafana?.skip;
        });

        // Then map and renumber sequentially based on array position
        const milestones = validItems.map((item, index) => {
          // Use array index + 1 for sequential numbering (1, 2, 3, etc.)
          // This ensures no gaps in numbering even when items are skipped
          const milestone: Milestone = {
            number: index + 1,
            title: item.params?.title || item.params?.menutitle || `Step ${index + 1}`,
            duration: '5-10 min', // Default duration as it's not in the data
            url: `${new URL(baseUrl).origin}${item.permalink || item.params?.permalink || ''}`,
            isActive: false,
          };

          // Add optional fields if they exist
          if (item.params?.side_journeys) {
            milestone.sideJourneys = item.params.side_journeys;
          }

          if (item.params?.related_journeys) {
            milestone.relatedJourneys = item.params.related_journeys;
          }

          if (item.params?.cta?.image) {
            milestone.conclusionImage = {
              src: `${new URL(baseUrl).origin}${item.params.cta.image.src}`,
              width: item.params.cta.image.width,
              height: item.params.cta.image.height,
            };
          }

          return milestone;
        });

        return milestones; // Already in sequential order, no need to sort
      }
    } else {
      console.warn(`Failed to fetch metadata (${response.status}): ${indexJsonUrl}`);
    }
  } catch (error) {
    console.warn(`Failed to fetch learning journey metadata from ${baseUrl}/index.json:`, error);
  }

  return [];
}

/**
 * Find current milestone number from URL - improved version
 * Handles /unstyled.html suffix added during content fetching
 */
function findCurrentMilestoneFromUrl(url: string, milestones: Milestone[]): number {
  // Strip /unstyled.html suffix for comparison (added during content fetching)
  const cleanUrl = url.replace(/\/unstyled\.html$/, '');

  // Try exact URL match first (with and without trailing slash)
  for (const milestone of milestones) {
    if (urlsMatch(cleanUrl, milestone.url)) {
      return milestone.number;
    }
  }

  // Legacy pattern matching for milestone URLs
  const milestoneMatch = cleanUrl.match(/\/milestone-(\d+)/);
  if (milestoneMatch) {
    const milestoneNum = parseInt(milestoneMatch[1], 10);
    return milestoneNum;
  }

  // Check if this URL looks like a journey base URL (cover page)
  const baseUrl = getLearningJourneyBaseUrl(cleanUrl);
  if (urlsMatch(cleanUrl, baseUrl) || urlsMatch(cleanUrl, baseUrl + '/')) {
    return 0;
  }

  return 0; // Default to cover page
}

/**
 * Check if two URLs match, handling trailing slashes
 */
function urlsMatch(url1: string, url2: string): boolean {
  const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
  return normalize(url1) === normalize(url2);
}
