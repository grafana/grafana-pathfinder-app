/**
 * Raw HTTP fetch state machine for Grafana docs and interactive-learning content.
 *
 * Owns the async drain behavior that powers `fetchContent`'s upstream layer:
 * - `fetchRawHtml`: the direct path (single GET → optional content.json/unstyled.html
 *   fallback chain for Grafana docs URLs)
 * - `tryUrlVariations`: the variation queue used by interactive-learning URLs
 *   (content.json → unstyled.html, in order, stopping at first hit)
 * - `getContentUrls` / `generateInteractiveLearningVariations`: URL-shape helpers
 *   that build the variation queue
 * - `isJsonContentUrl`: native-JSON detection on either `response.url` or the
 *   originally requested URL
 * - `enforceHttps`: HTTPS gate used both up-front in `fetchContent` and on
 *   redirect targets in the direct path
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * INVARIANTS (do not change without updating raw-fetch.test.ts):
 *
 * 1. Drain order is observable and pinned by tests:
 *    - Variation path: [content.json, unstyled.html] for interactive-learning,
 *      stopping at first 2xx with a non-empty body.
 *    - Direct path: [baseUrl] then, when `hasContentJson && !isFinalUrl`,
 *      [jsonUrl] then, when content.json returned the literal string "null"
 *      OR was missing/non-2xx, [htmlUrl]. The "null" sentinel triggers a
 *      fallthrough that MUST issue an htmlUrl request — see test 3.
 *
 * 2. Trust/HTTPS asymmetry between paths:
 *    - Variation path: trust check against `response.url || urlVariation`.
 *      Empty `response.url` (proxied/intercepted environments) is allowed
 *      because the variation URL itself is the trust anchor. NO `enforceHttps`
 *      gate on the variation path.
 *    - Direct path: trust check against `response.url || url`, then
 *      `enforceHttps(finalUrl)` runs as a separate gate. In production both
 *      gates require https; in dev mode + localhost, only the trust check
 *      passes and `enforceHttps` allows http on localhost.
 *    - This asymmetry is intentional: the variation path's URLs are
 *      deterministically constructed from a pre-validated input URL.
 *
 * 3. Manual redirect handling for 3xx responses:
 *    - Only `Location: /...` (path or protocol-relative) triggers manual
 *      redirect logic. Absolute Locations (`https://other.com/x`) are recorded
 *      as `Redirect to ... (status N)` and not followed.
 *    - Cross-origin protocol-relative redirects (e.g. `//evil.com/x`) emit a
 *      "Cross-origin redirect blocked" error.
 *
 * 4. Error classification (`FetchError.errorType`):
 *    - 404 → 'not-found' (also: tryUrlVariations exhausted with all 404s
 *      yields the default 'not-found' fallback because 404 does not record
 *      `lastError`)
 *    - >=500 → 'server-error'
 *    - timeout/abort → 'timeout'
 *    - NetworkError/CORS/'Failed to fetch' → 'network'
 *    - everything else → 'other'
 *
 * 5. `isNativeJson` is true if EITHER the final URL or the requested
 *    variation URL ends in `.json` / `/content.json`. This must hold even
 *    when `response.url` is empty.
 * ──────────────────────────────────────────────────────────────────────────────
 */
import { ContentFetchOptions } from '../types/content.types';
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

/** Internal error structure for detailed error handling. */
export interface FetchError {
  message: string;
  errorType: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';
  statusCode?: number;
}

/** Result of a raw fetch attempt. */
export interface FetchRawResult {
  html: string | null;
  finalUrl?: string;
  error?: FetchError;
  /** Whether the content was fetched as native JSON (content.json) vs HTML */
  isNativeJson?: boolean;
}

/**
 * SECURITY: Enforce HTTPS for all external URLs to prevent MITM attacks.
 * Exception: localhost in dev mode (allows local HTTP testing).
 */
export function enforceHttps(url: string): boolean {
  const parsedUrl = parseUrlSafely(url);
  if (!parsedUrl) {
    console.error('Invalid URL format:');
    return false;
  }

  if (isDevModeEnabledGlobal() && isLocalhostUrl(url)) {
    return true;
  }

  if (parsedUrl.protocol !== 'https:') {
    console.error('Only HTTPS URLs are allowed');
    return false;
  }

  return true;
}

/**
 * Check if a URL points to a JSON file (content.json or any *.json).
 * Ignores query string and fragment.
 */
export function isJsonContentUrl(url: string): boolean {
  const urlPath = url.split('?')[0]!.split('#')[0]!;
  return urlPath.endsWith('.json') || urlPath.endsWith('/content.json');
}

/**
 * Try multiple URL variations in order, returning the first successful result.
 * Used for interactive-learning content where we try content.json first,
 * then unstyled.html.
 *
 * NOTE: This path intentionally does NOT call enforceHttps on `finalUrl` —
 * trust validation against `response.url || urlVariation` is the only gate.
 * The variation URLs are deterministically derived from a pre-validated input.
 */
export async function tryUrlVariations(urls: string[], options: ContentFetchOptions): Promise<FetchRawResult> {
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
          const isDevMode = isDevModeEnabledGlobal();
          const isFinalUrlTrusted =
            isAllowedContentUrl(finalUrl) ||
            (isDevMode && isLocalhostUrl(finalUrl)) ||
            (isDevMode && isGitHubRawUrl(finalUrl));

          if (!isFinalUrlTrusted) {
            console.warn(`URL variation ${urlVariation} redirected to untrusted URL: ${finalUrl}`);
            continue;
          }

          const isNativeJson = isJsonContentUrl(finalUrl) || isJsonContentUrl(urlVariation);
          return { html: content, finalUrl, isNativeJson };
        }
      }

      if (response.status === 404) {
        continue;
      }

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
    }
  }

  if (lastError) {
    console.error(`Failed to fetch from any URL variation. Last error: ${lastError.message}`);
  }
  return { html: null, error: lastError || { message: 'No content found', errorType: 'not-found' } };
}

/**
 * Fetch raw HTML/JSON for a content URL.
 *
 * Routes to one of two paths based on URL type:
 * - interactive-learning URLs → variation queue (`tryUrlVariations`)
 * - everything else → direct path with optional Grafana-docs json/html
 *   fallback chain
 *
 * The direct path runs THREE security gates after a successful body:
 *   1. Trust check on `response.url || url` (rejects unknown domains)
 *   2. `enforceHttps(finalUrl)` (rejects http downgrades)
 *   3. For Grafana-docs URLs with `hasContentJson`: prefer content.json,
 *      fall through to unstyled.html on miss/null/non-2xx
 */
export async function fetchRawHtml(url: string, options: ContentFetchOptions): Promise<FetchRawResult> {
  const { headers = {}, timeout = DEFAULT_CONTENT_FETCH_TIMEOUT } = options;

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

/**
 * Generate URL variations for interactive learning content.
 * Tries content.json first (preferred JSON format), then unstyled.html (fallback).
 *
 * @param url - The interactive learning URL
 * @returns Array of URLs to try in order: [content.json, unstyled.html]
 */
export function generateInteractiveLearningVariations(url: string): string[] {
  const variations: string[] = [];

  if (!isInteractiveLearningUrl(url)) {
    return variations;
  }

  const baseUrl = url.split('?')[0]!.split('#')[0]!.replace(/\/$/, '');

  if (baseUrl.endsWith('/content.json') || baseUrl.endsWith('/unstyled.html')) {
    return [url];
  }

  variations.push(`${baseUrl}/content.json`);
  variations.push(`${baseUrl}/unstyled.html`);

  return variations;
}

/**
 * Get content URLs for both JSON and HTML formats.
 * Returns URLs to try in order of preference: JSON first, then HTML.
 */
export function getContentUrls(url: string): { jsonUrl: string; htmlUrl: string } {
  const baseUrl = url.split('?')[0]!.split('#')[0]!.replace(/\/$/, '');

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
