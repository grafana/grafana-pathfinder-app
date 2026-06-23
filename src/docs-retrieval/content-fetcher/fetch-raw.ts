// Transport core for the unified content fetcher: the raw HTTPS fetch, redirect
// trust re-validation, the content.json → unstyled.html ladder, and the
// structured error mapping. All network-facing, security-sensitive code lives
// here so the orchestrator (`fetchContent`) stays a thin composition layer.
import { ContentFetchOptions } from '../../types/content.types';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../../constants';
import {
  parseUrlSafely,
  isAllowedContentUrl,
  isGrafanaDocsUrl,
  isLocalhostUrl,
  isInteractiveLearningUrl,
  isTrustedFinalUrl,
} from '../../security';
import { isDevModeEnabledGlobal } from '../../utils/dev-mode';
import { isJsonContentUrl, generateInteractiveLearningVariations, getContentUrls } from './url-utils';

// Internal error structure for detailed error handling
export interface FetchError {
  message: string;
  errorType: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';
  statusCode?: number;
}

/**
 * Internal fetch result type that includes native JSON detection
 */
export interface FetchRawResult {
  html: string | null;
  finalUrl?: string;
  error?: FetchError;
  /** Whether the content was fetched as native JSON (content.json) vs HTML */
  isNativeJson?: boolean;
}

/**
 * SECURITY: Enforce HTTPS for all external URLs to prevent MITM attacks
 * Exceptions: localhost in dev mode
 */
export function enforceHttps(url: string): boolean {
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
 * Generate user-friendly error messages based on error type
 */
export function generateUserFriendlyError(error: FetchError | undefined, url: string): string {
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

/**
 * The content.json → unstyled.html fallback ladder for a trusted Grafana docs
 * URL. Tries content.json first (only for URL types that support it, and unless
 * the server returns the `null` signal), then unstyled.html. Returns the first
 * usable result, a structured error when the HTML fallback fails, or `null` to
 * signal the caller should fall through to the already-fetched page content.
 *
 * Behavior-preserving extraction of the ladder previously inlined in
 * `fetchRawHtml`. Keeps the candidate order and the null-signal fallthrough;
 * the `unstyled.html` rung is intentionally retained (primary for regular docs).
 */
async function tryGrafanaDocsContentLadder(
  finalUrl: string,
  baseFetchOptions: RequestInit,
  timeout: number
): Promise<FetchRawResult | null> {
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
      return {
        html: null,
        error: {
          message: hasContentJson
            ? `Cannot load Grafana content. Neither content.json nor unstyled.html found at: ${finalUrl}`
            : `Cannot load Grafana content. unstyled.html not found at: ${finalUrl}`,
          errorType: htmlResponse.status === 404 ? 'not-found' : 'other',
          statusCode: htmlResponse.status,
        },
      };
    } catch (htmlError) {
      return {
        html: null,
        error: {
          message: `Cannot load Grafana content. Content fetch failed: ${
            htmlError instanceof Error ? htmlError.message : 'Unknown error'
          }`,
          errorType: 'other',
        },
      };
    }
  }

  return null;
}

export async function fetchRawHtml(url: string, options: ContentFetchOptions): Promise<FetchRawResult> {
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
          const ladderResult = await tryGrafanaDocsContentLadder(finalUrl, baseFetchOptions, timeout);
          if (ladderResult) {
            return ladderResult;
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
