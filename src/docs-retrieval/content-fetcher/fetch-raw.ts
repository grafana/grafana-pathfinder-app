import type { GuideDiagnostic, GuideLoadContext } from '../../types/guide-diagnostics.types';
import { diagnoseGuideError, guideSource } from '../../lib/guide-diagnostics';
import { fetchGuideResource } from '../../lib/telemetry/guide-load';
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
import { logger } from '../../lib/logging';
import { assertExhaustive } from '../../lib/assert-exhaustive';
import { normalizeTelemetryUrl } from '../../lib/telemetry';
import { isJsonContentUrl, generateInteractiveLearningVariations, getContentUrls } from './url-utils';

// Internal error structure for detailed error handling
export interface FetchError {
  diagnostic?: GuideDiagnostic;
  message: string;
  errorType: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';
  statusCode?: number;
}

/**
 * Internal fetch result type that includes native JSON detection
 */
export interface FetchRawResult {
  fallback?: GuideDiagnostic;
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
    logger.error('Invalid URL format:');
    return false;
  }

  // Allow HTTP for localhost in dev mode (for local testing)
  if (isDevModeEnabledGlobal() && isLocalhostUrl(url)) {
    return true;
  }

  // Require HTTPS for all other URLs
  if (parsedUrl.protocol !== 'https:') {
    logger.error('Only HTTPS URLs are allowed');
    return false;
  }

  return true;
}

/**
 * Generate user-friendly error messages based on error type
 */
export function generateUserFriendlyError(error: FetchError | undefined, _url: string): string {
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
    case 'other':
      return error.message || 'Failed to load content. Please try again.';
    default:
      assertExhaustive(error.errorType);
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
      const response = await fetchGuideResource(
        urlVariation,
        {
          method: 'GET',
          headers: { ...headers },
          signal: AbortSignal.timeout(timeout),
          redirect: 'follow',
        },
        options.loadContext
      );

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
            logger.warn('URL variation redirected to untrusted URL', {
              content_url: normalizeTelemetryUrl(urlVariation),
              final_url: normalizeTelemetryUrl(finalUrl),
            });
            lastError = {
              message: 'Untrusted redirect',
              errorType: 'other',
              diagnostic: { source: guideSource(urlVariation), stage: 'fetch', reason: 'blocked-url' },
            };
            continue;
          }

          // Detect if this is native JSON content
          const isNativeJson = isJsonContentUrl(finalUrl) || isJsonContentUrl(urlVariation);
          return {
            html: content,
            finalUrl,
            isNativeJson,
            ...(lastError && {
              fallback: lastError.diagnostic ?? {
                source: guideSource(urlVariation),
                stage: 'fetch',
                reason: lastError.statusCode ? 'http-error' : 'not-found',
                statusCode: lastError.statusCode,
              },
            }),
          };
        }
      }

      if (response.ok) {
        lastError = {
          message: 'Content is empty',
          errorType: 'other',
          diagnostic: { source: guideSource(urlVariation), stage: 'decode', reason: 'empty-content' },
        };
        continue;
      }

      // 404 means this variation doesn't exist - try next one
      if (response.status === 404) {
        lastError ??= { message: 'Content not found', errorType: 'not-found', statusCode: 404 };
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
      const diagnostic = diagnoseGuideError(error, guideSource(urlVariation));
      const isTimeout = diagnostic.reason === 'timeout';
      const isNetwork =
        errorMessage.includes('NetworkError') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('CORS');

      lastError = {
        message: errorMessage,
        diagnostic,
        errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'other',
      };
      // Continue to next variation on network errors
    }
  }

  // All variations failed
  if (lastError) {
    logger.error('Failed to fetch from any URL variation', { lastErrorMessage: lastError.message });
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
  timeout: number,
  context?: GuideLoadContext
): Promise<FetchRawResult | null> {
  const { jsonUrl, htmlUrl } = getContentUrls(finalUrl);
  let fallback: GuideDiagnostic | undefined;

  const urlPath = new URL(finalUrl).pathname;
  const hasContentJson =
    urlPath.includes('/learning-journeys/') ||
    urlPath.includes('/learning-paths/') ||
    isInteractiveLearningUrl(finalUrl);

  if (hasContentJson && jsonUrl !== finalUrl) {
    try {
      const jsonResponse = await fetchGuideResource(
        jsonUrl,
        { ...baseFetchOptions, signal: AbortSignal.timeout(timeout) },
        context
      );
      if (jsonResponse.ok) {
        const jsonContent = await jsonResponse.text();
        if (jsonContent && jsonContent.trim()) {
          if (jsonContent.trim() !== 'null') {
            return {
              html: jsonContent,
              finalUrl: jsonResponse.url || jsonUrl,
              isNativeJson: true,
            };
          }
          fallback = { source: guideSource(finalUrl), stage: 'decode', reason: 'json-null' };
        } else {
          fallback = { source: guideSource(finalUrl), stage: 'decode', reason: 'empty-content' };
        }
      } else {
        fallback = {
          source: guideSource(finalUrl),
          stage: 'fetch',
          reason: 'http-error',
          statusCode: jsonResponse.status,
        };
      }
    } catch (error) {
      fallback = diagnoseGuideError(error, guideSource(finalUrl));
    }
  }

  if (htmlUrl !== finalUrl) {
    try {
      const htmlResponse = await fetchGuideResource(
        htmlUrl,
        { ...baseFetchOptions, signal: AbortSignal.timeout(timeout) },
        context
      );
      if (htmlResponse.ok) {
        const htmlContent = await htmlResponse.text();
        if (htmlContent && htmlContent.trim()) {
          return {
            html: htmlContent,
            finalUrl: htmlResponse.url || htmlUrl,
            isNativeJson: false,
            fallback,
          };
        }
      }
      if (htmlResponse.status === 404 && fallback && fallback.statusCode !== 404 && fallback.reason !== 'json-null') {
        return {
          html: null,
          error: {
            diagnostic: fallback,
            message: 'Cannot load Grafana content. Please try again later.',
            errorType:
              fallback.reason === 'timeout'
                ? 'timeout'
                : fallback.reason === 'network-error'
                  ? 'network'
                  : fallback.statusCode !== undefined && fallback.statusCode >= 500
                    ? 'server-error'
                    : 'other',
            statusCode: fallback.statusCode,
          },
        };
      }
      return {
        html: null,
        error: {
          diagnostic: htmlResponse.ok
            ? { source: guideSource(finalUrl), stage: 'decode', reason: 'empty-content' }
            : { source: guideSource(finalUrl), stage: 'fetch', reason: 'http-error', statusCode: htmlResponse.status },
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
          diagnostic: diagnoseGuideError(htmlError, guideSource(finalUrl)),
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
    const response = await fetchGuideResource(
      url,
      { ...baseFetchOptions, signal: AbortSignal.timeout(timeout) },
      options.loadContext
    );

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
          logger.warn('Redirect target not in trusted domain list', {
            content_url: normalizeTelemetryUrl(url),
            final_url: normalizeTelemetryUrl(finalUrl),
            response_url_empty: !response.url,
            is_allowed_content_url: isAllowedContentUrl(finalUrl),
          });
          lastError = {
            message: 'Redirect target is not in trusted domain list',
            diagnostic: { source: guideSource(url), stage: 'fetch', reason: 'blocked-url' },
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
            diagnostic: { source: guideSource(url), stage: 'fetch', reason: 'blocked-url' },
            errorType: 'other',
          };
          return { html: null, error: lastError };
        }

        // If this is a Grafana docs/tutorial URL, try to get content in this order:
        // 1. content.json (new JSON format - preferred)
        // 2. unstyled.html (legacy HTML format - fallback)
        // Use proper URL parsing to prevent domain hijacking attacks
        const shouldFetchContent = isGrafanaDocsUrl(finalUrl) || (isDevModeEnabledGlobal() && isLocalhostUrl(finalUrl));

        if (shouldFetchContent && !isJsonContentUrl(finalUrl)) {
          const ladderResult = await tryGrafanaDocsContentLadder(
            finalUrl,
            baseFetchOptions,
            timeout,
            options.loadContext
          );
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
        logger.warn('Manual redirect detected', {
          content_url: normalizeTelemetryUrl(url),
          lastErrorMessage: lastError.message,
        });

        if (location.startsWith('/')) {
          try {
            const originalUrl = new URL(url);
            const redirectUrl = new URL(location, originalUrl.origin);

            if (redirectUrl.origin !== originalUrl.origin) {
              logger.warn('Blocked redirect to different origin', {
                redirect_origin: redirectUrl.origin,
                content_url: normalizeTelemetryUrl(url),
              });
              lastError = {
                message: `Cross-origin redirect blocked for security: ${redirectUrl.origin}`,
                errorType: 'other',
              };
            } else {
              const isRedirectTrusted = isTrustedFinalUrl(redirectUrl.href);

              if (!isRedirectTrusted) {
                logger.warn('Redirect target not in trusted domain list', {
                  content_url: normalizeTelemetryUrl(url),
                  final_url: normalizeTelemetryUrl(redirectUrl.href),
                });
                lastError = {
                  message: 'Redirect target is not in trusted domain list',
                  diagnostic: { source: guideSource(url), stage: 'fetch', reason: 'blocked-url' },
                  errorType: 'other',
                };
              } else {
                const redirectResponse = await fetchGuideResource(
                  redirectUrl.href,
                  {
                    ...baseFetchOptions,
                    signal: AbortSignal.timeout(timeout),
                  },
                  options.loadContext
                );
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
            logger.warn('Failed to fetch redirect target', { redirectError });
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
      logger.warn(`Failed to fetch content: ${lastError.message}`, {
        content_url: normalizeTelemetryUrl(url),
        error_type: errorType,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const diagnostic = diagnoseGuideError(error, guideSource(url));
    const isTimeout = diagnostic.reason === 'timeout';
    const isNetwork =
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('CORS') ||
      errorMessage.includes('network');

    lastError = {
      message: errorMessage,
      diagnostic,
      errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'other',
    };
    logger.warn('Failed to fetch content', { error, content_url: normalizeTelemetryUrl(url) });
  }

  if (lastError) {
    logger.error('Failed to fetch content', {
      lastErrorMessage: lastError.message,
      content_url: normalizeTelemetryUrl(url),
      error_type: lastError.errorType,
    });
  }

  return { html: null, error: lastError };
}
