// Unified content fetcher - replaces docs-fetcher.ts and single-docs-fetcher.ts
// This version ONLY fetches content and extracts basic metadata
// All DOM processing is moved to React components
import {
  RawContent,
  ContentFetchResult,
  ContentFetchOptions,
  ContentType,
  LearningJourneyMetadata,
  Milestone,
} from '../types/content.types';
import type { PackageResolver } from '../types';
import type { ResolvedNavLink } from '../types/context.types';
import { getPackageRenderType } from '../types/package.types';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../constants';
import {
  parseUrlSafely,
  isAllowedContentUrl,
  isGrafanaDocsUrl,
  isLocalhostUrl,
  isInteractiveLearningUrl,
  isTrustedFinalUrl,
} from '../security';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';
import { generateJourneyContentWithExtras } from './learning-journey-helpers';
import { resolveRelativeUrls } from './resolve-relative-urls';
import { validateGuide } from '../validation';
import {
  generateUrlId,
  isJsonContentUrl,
  generateInteractiveLearningVariations,
  getContentUrls,
} from './content-fetcher/url-utils';
import { extractMetadata } from './content-fetcher/metadata-extract';
import { simpleMarkdownToHtml, injectJourneyExtrasIntoJsonGuide } from './content-fetcher/cover-page';
import { fetchBundledInteractive } from './content-fetcher/bundled';
import { fetchBackendInteractive } from './content-fetcher/backend-guide';

// Re-exported to keep the barrel surface stable: `injectJourneyExtrasIntoJsonGuide`
// is consumed by `components/docs-panel`, and `simpleMarkdownToHtml` by the
// sibling `content-fetcher.test.ts`.
export { simpleMarkdownToHtml, injectJourneyExtrasIntoJsonGuide };

// Internal error structure for detailed error handling
interface FetchError {
  message: string;
  errorType: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';
  statusCode?: number;
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
    // Handle custom guides stored in backend CRDs
    if (url.startsWith('backend-guide:')) {
      return await fetchBackendInteractive(url);
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
 * Try multiple URL variations in order, returning the first successful result.
 * This is used for content URLs where we want to try content.json first, then unstyled.html.
 */
async function tryUrlVariations(urls: string[], options: ContentFetchOptions): Promise<FetchRawResult> {
  const { headers = {}, timeout = DEFAULT_CONTENT_FETCH_TIMEOUT } = options;
  let lastError: FetchError | undefined;

  for (const urlVariation of urls) {
    try {
      const response = await fetch(urlVariation, {
        method: 'GET',
        headers: { ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });

      if (response.ok) {
        const content = await response.text();
        if (content && content.trim()) {
          // SECURITY: Validate the final URL is trusted
          // NOTE: response.url can be empty in proxied/intercepted environments
          // (e.g., Grafana Cloud). Fall back to the requested URL which was
          // already validated before entering this function.
          const finalUrl = response.url || urlVariation;
          const isFinalUrlTrusted = isTrustedFinalUrl(finalUrl);

          if (!isFinalUrlTrusted) {
            console.warn(`URL variation ${urlVariation} redirected to untrusted URL: ${finalUrl}`);
            continue; // Try next variation
          }

          // Detect if this is native JSON content
          const isNativeJson = isJsonContentUrl(finalUrl) || isJsonContentUrl(urlVariation);
          return { html: content, finalUrl, isNativeJson };
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

  const baseFetchOptions = {
    method: 'GET',
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'User-Agent': 'Grafana-Docs-Plugin/1.0',
      ...headers,
    },
    redirect: 'follow' as RequestRedirect,
  };

  let lastError: FetchError | undefined;

  try {
    const response = await fetch(url, { ...baseFetchOptions, signal: AbortSignal.timeout(timeout) });

    if (response.ok) {
      const html = await response.text();
      if (html && html.trim()) {
        // SECURITY: Validate redirect target is still trusted
        // NOTE: response.url can be empty in environments where fetch is intercepted
        // by a proxy, service worker, or platform wrapper (e.g., Grafana Cloud).
        // Per the Fetch API spec, synthetic Response objects have url === "".
        // When empty, fall back to the original request URL which was already
        // validated at the initial trust gate in fetchContent().
        const finalUrl = response.url || url;
        const isFinalUrlTrusted = isTrustedFinalUrl(finalUrl);

        if (!isFinalUrlTrusted) {
          console.warn(
            `Redirect target not in trusted domain list.\n` +
              `Original URL: ${url}\n` +
              `Final URL: ${finalUrl}\n` +
              `response.url: ${response.url}\n` +
              `isAllowedContentUrl: ${isAllowedContentUrl(finalUrl)}`
          );
          lastError = {
            message: 'Redirect target is not in trusted domain list',
            errorType: 'other',
          };
          return { html: null, error: lastError };
        }

        // SECURITY: Enforce HTTPS on redirect target
        // When response.url is empty, finalUrl falls back to the original URL
        // which has already passed the HTTPS check in fetchContent()
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
          const { jsonUrl, htmlUrl } = getContentUrls(finalUrl);

          // Determine if this URL type supports content.json
          // Learning paths and interactive learning URLs have content.json
          // Regular docs pages only have unstyled.html
          const urlPath = new URL(finalUrl).pathname;
          const hasContentJson =
            urlPath.includes('/learning-journeys/') ||
            urlPath.includes('/learning-paths/') ||
            isInteractiveLearningUrl(finalUrl);

          // Try content.json first only for URLs that support it
          if (hasContentJson && jsonUrl !== finalUrl) {
            try {
              const jsonResponse = await fetch(jsonUrl, { ...baseFetchOptions, signal: AbortSignal.timeout(timeout) });
              if (jsonResponse.ok) {
                const jsonContent = await jsonResponse.text();
                if (jsonContent && jsonContent.trim()) {
                  // Check if server returned null as a signal to try unstyled.html
                  if (jsonContent.trim() !== 'null') {
                    return {
                      html: jsonContent,
                      finalUrl: jsonResponse.url || jsonUrl,
                      isNativeJson: true,
                    };
                  }
                  // Fall through to try the HTML fallback
                }
              }
            } catch {
              // JSON fetch failed - fall through to HTML fallback
            }
          }

          // Fetch unstyled.html (fallback for learning journeys, primary for regular docs)
          if (htmlUrl !== finalUrl) {
            try {
              const htmlResponse = await fetch(htmlUrl, { ...baseFetchOptions, signal: AbortSignal.timeout(timeout) });
              if (htmlResponse.ok) {
                const htmlContent = await htmlResponse.text();
                if (htmlContent && htmlContent.trim()) {
                  return {
                    html: htmlContent,
                    finalUrl: htmlResponse.url || htmlUrl,
                    isNativeJson: false,
                  };
                }
              }
              lastError = {
                message: hasContentJson
                  ? `Cannot load Grafana content. Neither content.json nor unstyled.html found at: ${finalUrl}`
                  : `Cannot load Grafana content. unstyled.html not found at: ${finalUrl}`,
                errorType: htmlResponse.status === 404 ? 'not-found' : 'other',
                statusCode: htmlResponse.status,
              };
              return { html: null, error: lastError };
            } catch (htmlError) {
              lastError = {
                message: `Cannot load Grafana content. Content fetch failed: ${
                  htmlError instanceof Error ? htmlError.message : 'Unknown error'
                }`,
                errorType: 'other',
              };
              return { html: null, error: lastError };
            }
          }
        }

        // Content fetched successfully
        const isNativeJson = isJsonContentUrl(finalUrl) || isJsonContentUrl(url);
        return { html, finalUrl, isNativeJson };
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
              const isRedirectTrusted = isTrustedFinalUrl(redirectUrl.href);

              if (!isRedirectTrusted) {
                console.warn(`Redirect target not in trusted domain list: ${redirectUrl.href}`);
                lastError = {
                  message: 'Redirect target is not in trusted domain list',
                  errorType: 'other',
                };
              } else {
                const redirectResponse = await fetch(redirectUrl.href, {
                  ...baseFetchOptions,
                  signal: AbortSignal.timeout(timeout),
                });
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

// ---------------------------------------------------------------------------
// Package content integration (Phase 4g)
// ---------------------------------------------------------------------------

/**
 * Module-level PackageResolver injected at Tier 3+ (docs-panel wires the
 * concrete CompositePackageResolver here so docs-retrieval stays decoupled
 * from the package-engine Tier 2 implementation).
 */
let _packageResolver: PackageResolver | undefined;

/**
 * Inject the PackageResolver implementation into docs-retrieval.
 * Called once at app startup by Tier 3/4 wiring code.
 */
export function setPackageResolver(resolver: PackageResolver): void {
  _packageResolver = resolver;
}

/**
 * Derive the grafana.com/docs/learning-paths/ website URL for a milestone.
 * Convention: the milestone package ID shares a prefix with the path slug,
 * and the remainder becomes the URL leaf segment.
 *
 * Example:
 *   pathSlug = "grafana-cloud-tour"
 *   milestoneId = "grafana-cloud-tour-business-value"
 *   → "https://grafana.com/docs/learning-paths/grafana-cloud-tour/business-value/"
 */
function buildMilestoneWebsiteUrl(pathSlug: string, milestoneId: string): string | undefined {
  const prefix = `${pathSlug}-`;
  if (!milestoneId.startsWith(prefix)) {
    return undefined;
  }
  const slug = milestoneId.slice(prefix.length);
  return `https://grafana.com/docs/learning-paths/${pathSlug}/${slug}/`;
}

/**
 * Derive the path slug from a path-type manifest ID.
 * Strips the conventional `-lj` suffix if present.
 */
export function derivePathSlug(manifestId: string): string {
  return manifestId.endsWith('-lj') ? manifestId.slice(0, -3) : manifestId;
}

/**
 * Resolve manifest milestone IDs into rich Milestone objects via the injected
 * PackageResolver. Each milestone ID is resolved to obtain its contentUrl (used
 * as the navigation URL) and its manifest title. Unresolvable milestones are
 * silently skipped so partial data still renders.
 *
 * @param milestoneIds - Bare package IDs from a path manifest's `milestones` array
 * @param pathSlug - Optional path slug for building website URLs
 * @returns Milestone[] suitable for LearningJourneyMetadata and Recommendation.milestones
 */
export async function resolvePackageMilestones(milestoneIds: string[], pathSlug?: string): Promise<Milestone[]> {
  if (!_packageResolver || milestoneIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    milestoneIds.map((id) => _packageResolver!.resolve(id, { loadContent: 'metadata-only' }))
  );

  const milestones: Milestone[] = [];
  let sequenceNumber = 1;

  for (let i = 0; i < milestoneIds.length; i++) {
    const result = settled[i]!;
    const id = milestoneIds[i]!;

    if (result.status === 'rejected') {
      console.warn(`[resolvePackageMilestones] Error resolving milestone ${id}:`, result.reason);
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      console.warn(`[resolvePackageMilestones] Skipping unresolvable milestone: ${id}`);
      continue;
    }

    const title = resolution.content?.title ?? resolution.manifest?.description ?? id;

    milestones.push({
      number: sequenceNumber++,
      title,
      duration: '5-10 min',
      url: resolution.contentUrl,
      isActive: false,
      ...(pathSlug != null && { websiteUrl: buildMilestoneWebsiteUrl(pathSlug, id) }),
    });
  }

  return milestones;
}

/**
 * Resolve bare package IDs (from manifest `recommends`/`suggests`) into
 * {@link ResolvedNavLink} objects so the context panel can display
 * human-readable titles and open packages with the correct type.
 *
 * Unresolvable IDs are silently skipped.
 */
export async function resolvePackageNavLinks(packageIds: string[]): Promise<ResolvedNavLink[]> {
  if (!_packageResolver || packageIds.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    packageIds.map((id) => _packageResolver!.resolve(id, { loadContent: 'metadata-only' }))
  );

  const links: ResolvedNavLink[] = [];

  for (let i = 0; i < packageIds.length; i++) {
    const result = settled[i]!;
    const id = packageIds[i]!;

    if (result.status === 'rejected') {
      console.warn(`[resolvePackageNavLinks] Error resolving package ${id}:`, result.reason);
      continue;
    }

    const resolution = result.value;
    if (!resolution.ok) {
      console.warn(`[resolvePackageNavLinks] Skipping unresolvable package: ${id}`);
      continue;
    }

    const title = resolution.content?.title ?? resolution.manifest?.description ?? id;
    const manifest: Record<string, unknown> | undefined = resolution.manifest
      ? (resolution.manifest as unknown as Record<string, unknown>)
      : undefined;

    links.push({
      packageId: id,
      title,
      contentUrl: resolution.contentUrl,
      manifest,
    });
  }

  return links;
}

function isPathManifest(manifest?: Record<string, unknown>): boolean {
  if (!manifest || typeof manifest.type !== 'string') {
    return false;
  }
  return manifest.type === 'path' || manifest.type === 'journey';
}

function getManifestMilestoneIds(manifest?: Record<string, unknown>): string[] {
  if (!manifest || !Array.isArray(manifest.milestones)) {
    return [];
  }
  return manifest.milestones.filter((s): s is string => typeof s === 'string');
}

/**
 * Fetch package content from a pre-resolved contentUrl (CDN or bundled).
 *
 * This is the primary fetch path for package-backed recommendations.
 * The v1 recommender response already carries a resolved contentUrl, so no
 * resolver call is needed — we fetch directly and enrich with manifest metadata.
 *
 * For path/journey packages, also resolves manifest milestones into
 * LearningJourneyMetadata so the docs panel renders the milestone progress
 * bar and arrow navigation.
 *
 * @param contentUrl - Pre-resolved CDN URL or bundled: URL for the content.json
 * @param packageManifest - Optional manifest metadata to attach to the result
 * @param preResolvedMilestones - Optional milestones already resolved by the caller (avoids redundant resolution)
 */
export async function fetchPackageContent(
  contentUrl: string,
  packageManifest?: Record<string, unknown>,
  preResolvedMilestones?: Milestone[]
): Promise<ContentFetchResult> {
  const renderType = getPackageRenderType(packageManifest);
  const needsMilestones = renderType === 'learning-journey' && isPathManifest(packageManifest);

  const manifestId = needsMilestones && typeof packageManifest?.id === 'string' ? packageManifest.id : '';
  const pathSlug = manifestId ? derivePathSlug(manifestId) : undefined;
  const milestoneIds = needsMilestones ? getManifestMilestoneIds(packageManifest) : [];
  const shouldResolveMilestones =
    needsMilestones && (!preResolvedMilestones || preResolvedMilestones.length === 0) && milestoneIds.length > 0;

  // Run content fetch, milestone resolution, and baseUrl resolution in
  // parallel. These are independent: the page body doesn't need milestones
  // and milestones don't need the page body.
  const [result, resolvedMilestones, baseUrlResolution] = await Promise.all([
    fetchContent(contentUrl),
    shouldResolveMilestones ? resolvePackageMilestones(milestoneIds, pathSlug) : Promise.resolve(undefined),
    manifestId && _packageResolver
      ? _packageResolver.resolve(manifestId, { loadContent: false }).catch(() => undefined)
      : Promise.resolve(undefined),
  ]);

  if (!result.content) {
    return result;
  }

  let learningJourney: LearningJourneyMetadata | undefined;
  let contentString = result.content.content;

  if (needsMilestones) {
    const milestones = preResolvedMilestones?.length ? preResolvedMilestones : resolvedMilestones;

    if (milestones && milestones.length > 0) {
      const milestoneIndex = milestones.findIndex((m) => m.url === contentUrl);
      const currentMilestone = milestoneIndex >= 0 ? milestoneIndex + 1 : 0;

      let baseUrl = contentUrl;
      if (milestoneIndex >= 0 && baseUrlResolution && baseUrlResolution.ok) {
        baseUrl = baseUrlResolution.contentUrl;
      }

      learningJourney = {
        currentMilestone,
        totalMilestones: milestones.length,
        milestones,
        baseUrl,
        summary: result.content.metadata.singleDoc?.summary,
        ...(pathSlug != null && {
          websiteUrl: `https://grafana.com/docs/learning-paths/${pathSlug}/`,
        }),
      };

      if (currentMilestone === 0) {
        contentString = injectJourneyExtrasIntoJsonGuide(contentString, learningJourney);
      }
    }
  }

  return {
    ...result,
    content: {
      ...result.content,
      content: contentString,
      type: renderType,
      metadata: {
        ...result.content.metadata,
        ...(packageManifest !== undefined && { packageManifest }),
        ...(learningJourney !== undefined && { learningJourney }),
      },
    },
  };
}

/**
 * Fetch package content by bare package ID using the injected PackageResolver.
 * Used for deep links and milestone navigation where only an ID is available.
 *
 * Requires setPackageResolver() to have been called first.
 *
 * @param packageId - Bare package ID (e.g., "alerting-101")
 * @param packageManifest - Optional manifest metadata to attach to the result
 */
export async function fetchPackageById(
  packageId: string,
  packageManifest?: Record<string, unknown>
): Promise<ContentFetchResult> {
  if (!_packageResolver) {
    return {
      content: null,
      error: 'No package resolver configured — call setPackageResolver() first',
      errorType: 'other',
    };
  }

  const resolution = await _packageResolver.resolve(packageId, { loadContent: false });

  if (!resolution.ok) {
    return {
      content: null,
      error: `Failed to resolve package: ${packageId}`,
      errorType: resolution.error.code === 'not-found' ? 'not-found' : 'other',
    };
  }

  return fetchPackageContent(resolution.contentUrl, packageManifest);
}
