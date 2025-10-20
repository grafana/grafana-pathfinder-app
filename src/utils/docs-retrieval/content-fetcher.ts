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
import { DEFAULT_CONTENT_FETCH_TIMEOUT, ALLOWED_GITHUB_REPO_PATHS } from '../../constants';
import {
  parseUrlSafely,
  isAllowedContentUrl,
  isGrafanaDocsUrl,
  isGitHubUrl,
  isGitHubRawUrl,
  isAllowedGitHubRawUrl,
  isLocalhostUrl,
} from '../url-validator';
import { isDevModeEnabled } from '../dev-mode';

// Internal error structure for detailed error handling
interface FetchError {
  message: string;
  errorType: 'not-found' | 'timeout' | 'network' | 'server-error' | 'other';
  statusCode?: number;
}

/**
 * SECURITY: Enforce HTTPS for all external URLs to prevent MITM attacks
 * Exceptions: localhost in dev mode
 */
function enforceHttps(url: string): boolean {
  // Parse URL safely
  const parsedUrl = parseUrlSafely(url);
  if (!parsedUrl) {
    console.error('[SECURITY] Invalid URL format:', url);
    return false;
  }

  // Allow HTTP for localhost in dev mode (for local testing)
  if (isDevModeEnabled() && isLocalhostUrl(url)) {
    return true;
  }

  // Require HTTPS for all other URLs
  if (parsedUrl.protocol !== 'https:') {
    console.error('[SECURITY] Only HTTPS URLs are allowed (found:', parsedUrl.protocol, ')', url);
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
    // In production: Only Grafana docs, bundled content, and approved GitHub repos
    // In dev mode: Also allows localhost URLs for local testing
    const isTrustedSource =
      isAllowedContentUrl(url) || isAllowedGitHubRawUrl(url, ALLOWED_GITHUB_REPO_PATHS) || isGitHubUrl(url);

    if (!isTrustedSource) {
      const errorMessage = isDevModeEnabled()
        ? 'Only Grafana.com documentation, localhost URLs (dev mode), and approved GitHub repositories can be loaded'
        : 'Only Grafana.com documentation and approved GitHub repositories can be loaded';

      console.error('[SECURITY] fetchContent rejected untrusted URL:', url);
      return {
        content: null,
        error: errorMessage,
        errorType: 'other',
      };
    }

    // Log when using localhost in dev mode
    if (isDevModeEnabled() && isLocalhostUrl(url)) {
      console.log('[DEV MODE] Loading content from localhost:', url);
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

    // Extract basic metadata without DOM processing
    const metadata = await extractMetadata(fetchResult.html, finalUrl, contentType);

    // Create unified content object
    const content: RawContent = {
      html: fetchResult.html,
      metadata,
      type: contentType,
      url: finalUrl, // Use final URL to correctly resolve relative links
      lastFetched: new Date().toISOString(),
      hashFragment,
    };

    return { content };
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

  try {
    let html = '';

    // Load the index.json to find the correct filename for this interactive
    const indexData = require('../../bundled-interactives/index.json');
    const interactive = indexData?.interactives?.find((item: any) => item.id === contentId);

    if (!interactive) {
      return {
        content: null,
        error: `Bundled interactive not found in index.json: ${contentId}`,
      };
    }

    // Load the TypeScript file using the filename from index.json
    const filename = interactive.filename || `${contentId}.ts`;
    const exportName = interactive.exportName || `${contentId}Html`;

    // Import the TypeScript module (webpack handles this properly)
    const importedModule = require(`../../bundled-interactives/${filename}`) as any;

    // Get the HTML content from the exported constant
    if (importedModule && typeof importedModule[exportName] === 'string') {
      html = importedModule[exportName];
    } else {
      throw new Error(`Could not find export '${exportName}' in ${filename} or it's not a string`);
    }

    if (!html || html.trim() === '') {
      return {
        content: null,
        error: `Bundled interactive content is empty: ${contentId}`,
      };
    }

    // Determine content type for bundled content (don't assume single-doc)
    const contentType = determineContentType(url);
    const metadata = await extractMetadata(html, url, contentType);

    const content: RawContent = {
      html,
      metadata,
      type: contentType, // Use detected type (learning-journey or single-doc)
      url,
      lastFetched: new Date().toISOString(),
      // No hash fragment support for bundled content for now
    };

    return { content };
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
async function fetchRawHtml(
  url: string,
  options: ContentFetchOptions
): Promise<{ html: string | null; finalUrl?: string; error?: FetchError }> {
  const { headers = {}, timeout = DEFAULT_CONTENT_FETCH_TIMEOUT } = options;

  // Handle GitHub URLs proactively to avoid CORS issues
  // Convert tree/blob URLs to raw URLs before attempting fetch
  // Use proper URL parsing to prevent domain hijacking
  let actualUrl = url;
  const isGitHubRawUrlCheck = isGitHubRawUrl(url);
  const isGitHubUrlCheck = isGitHubUrl(url);

  if (isGitHubUrlCheck && !isGitHubRawUrlCheck) {
    const githubVariations = generateGitHubVariations(url);
    if (githubVariations.length > 0) {
      // Use the first (most specific) GitHub variation instead of the original URL
      actualUrl = githubVariations[0];
    }
  }

  // Build fetch options - use minimal headers for GitHub raw URLs to avoid CORS preflight
  const fetchOptions: RequestInit = {
    method: 'GET',
    headers: isGitHubRawUrlCheck
      ? {
          // Minimal headers for GitHub raw URLs - avoid triggering CORS preflight
          // Only use simple headers that don't require preflight
          ...headers,
        }
      : {
          // Full headers for other URLs
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'User-Agent': 'Grafana-Docs-Plugin/1.0',
          ...headers,
        },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow', // Explicitly follow redirects (up to 20 by default)
  };

  // Try the actual URL (original or converted GitHub raw URL)
  let lastError: FetchError | undefined;

  try {
    const response = await fetch(actualUrl, fetchOptions);

    if (response.ok) {
      const html = await response.text();
      if (html && html.trim()) {
        // SECURITY: Validate redirect target is still trusted
        // After fetch redirects, check the final URL is still in our trusted domain list
        const finalUrl = response.url;

        // Re-validate the final URL after redirects
        const isFinalUrlTrusted =
          isAllowedContentUrl(finalUrl) ||
          isAllowedGitHubRawUrl(finalUrl, ALLOWED_GITHUB_REPO_PATHS) ||
          isGitHubUrl(finalUrl) ||
          (isDevModeEnabled() && isLocalhostUrl(finalUrl));

        if (!isFinalUrlTrusted) {
          console.error('[SECURITY] Redirect to untrusted domain blocked:', finalUrl, 'from:', url);
          lastError = {
            message: 'Redirect target is not in trusted domain list',
            errorType: 'other',
          };
          return { html: null, error: lastError };
        }

        // SECURITY: Enforce HTTPS on redirect target
        if (!enforceHttps(finalUrl)) {
          console.error('[SECURITY] Redirect to non-HTTPS URL blocked:', finalUrl);
          lastError = {
            message: 'Redirect to non-HTTPS URL blocked for security',
            errorType: 'other',
          };
          return { html: null, error: lastError };
        }

        // If this is a Grafana docs/tutorial URL, we MUST get the unstyled version
        // Use proper URL parsing to prevent domain hijacking attacks
        const shouldFetchUnstyled = isGrafanaDocsUrl(finalUrl);

        if (shouldFetchUnstyled) {
          const finalUnstyledUrl = getUnstyledContentUrl(response.url);
          if (finalUnstyledUrl !== response.url) {
            try {
              const unstyledResponse = await fetch(finalUnstyledUrl, fetchOptions);
              if (unstyledResponse.ok) {
                const unstyledHtml = await unstyledResponse.text();
                if (unstyledHtml && unstyledHtml.trim()) {
                  return { html: unstyledHtml, finalUrl: unstyledResponse.url };
                }
              }
              // If unstyled version fails, don't fallback - fail the request
              lastError = {
                message: `Cannot load styled Grafana content. Unstyled version required but failed to load: ${finalUnstyledUrl}`,
                errorType: unstyledResponse.status === 404 ? 'not-found' : 'other',
                statusCode: unstyledResponse.status,
              };
              return { html: null, error: lastError };
            } catch (unstyledError) {
              lastError = {
                message: `Cannot load styled Grafana content. Unstyled version failed: ${
                  unstyledError instanceof Error ? unstyledError.message : 'Unknown error'
                }`,
                errorType: 'other',
              };
              return { html: null, error: lastError };
            }
          }
        }

        // Content fetched successfully - use response.url to get final URL after redirects
        return { html, finalUrl: response.url };
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

        // Try to fetch the redirect target if it's a relative URL
        if (location.startsWith('/')) {
          const baseUrlMatch = url.match(/^(https?:\/\/[^\/]+)/);
          if (baseUrlMatch) {
            const fullRedirectUrl = baseUrlMatch[1] + location;
            try {
              const redirectResponse = await fetch(fullRedirectUrl, fetchOptions);
              if (redirectResponse.ok) {
                const html = await redirectResponse.text();
                if (html && html.trim()) {
                  return { html, finalUrl: redirectResponse.url };
                }
              }
            } catch (redirectError) {
              console.warn(`Failed to fetch redirect target ${fullRedirectUrl}:`, redirectError);
            }
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
      // Categorize HTTP errors by status code
      const errorType = response.status === 404 ? 'not-found' : response.status >= 500 ? 'server-error' : 'other';
      lastError = {
        message: `HTTP ${response.status}: ${response.statusText}`,
        errorType,
        statusCode: response.status,
      };
      console.warn(`Failed to fetch from ${url}:`, lastError.message);
    }
  } catch (error) {
    // Categorize catch errors (network, timeout, etc.)
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

  // If original URL failed and we haven't already converted the URL (to avoid trying the same variations twice)
  if (!lastError?.message.includes('Unstyled version required') && actualUrl === url) {
    // Only try GitHub for URLs that are actually GitHub URLs
    const githubVariations = generateGitHubVariations(url);
    if (githubVariations.length > 0) {
      for (const githubUrl of githubVariations) {
        try {
          const githubResponse = await fetch(githubUrl, fetchOptions);
          if (githubResponse.ok) {
            const githubHtml = await githubResponse.text();
            if (githubHtml && githubHtml.trim()) {
              return { html: githubHtml, finalUrl: githubResponse.url };
            }
          }
        } catch (githubError) {
          console.warn(`Failed to fetch from GitHub variation ${githubUrl}:`, githubError);
        }
      }
    }
  }

  // Log final failure with most relevant error
  if (lastError) {
    // Provide specific guidance for GitHub CORS issues (using centralized validator)
    if (isGitHubUrl(url) && lastError.message.includes('NetworkError')) {
      console.error(
        `Failed to fetch content from ${url}. Last error: ${lastError.message}\n` +
          `GitHub raw URLs may be blocked due to CORS policies. Consider:\n` +
          `1. Using bundled content instead (bundled: URLs)\n` +
          `2. Serving content from a CORS-enabled host\n` +
          `3. Configuring a docs base URL with proper CORS headers`
      );
    } else {
      console.error(`Failed to fetch content from ${url}. Last error: ${lastError.message}`);
    }
  }

  return { html: null, error: lastError };
}

/**
 * Generate GitHub raw content URL variations to try
 * Uses proper URL parsing to prevent domain hijacking
 */
function generateGitHubVariations(url: string): string[] {
  const variations: string[] = [];

  // Parse URL and validate it's actually GitHub (using centralized validators)
  const isGitHubDomain = isGitHubUrl(url);
  const isGitHubRawDomain = isGitHubRawUrl(url);

  // Only try GitHub variations for actual GitHub URLs
  if (isGitHubDomain || isGitHubRawDomain) {
    // If it's a regular GitHub URL, try converting to raw.githubusercontent.com first (more targeted)
    if (isGitHubDomain) {
      // Handle tree URLs (directories) - convert to directory/unstyled.html
      const treeMatch = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/tree\/([^\/]+)\/(.+)/);
      if (treeMatch) {
        const [_fullMatch, owner, repo, branch, path] = treeMatch;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/refs/heads/${branch}/${path}/unstyled.html`;
        variations.push(rawUrl);
      }

      // Handle blob URLs (specific files)
      const blobMatch = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/);
      if (blobMatch) {
        const [_fullMatch, owner, repo, branch, path] = blobMatch;
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
        variations.push(rawUrl);

        // Also try unstyled version of raw URL
        if (!rawUrl.includes('/unstyled.html')) {
          variations.push(`${rawUrl}/unstyled.html`);
        }
      }
    }

    // Generic fallback: try unstyled.html version (only if no specific conversion worked)
    if (!url.includes('/unstyled.html') && variations.length === 0) {
      variations.push(`${url.replace(/\/$/, '')}/unstyled.html`);
    }
  }

  return variations;
}

/**
 * Get unstyled content URL (from single-docs-fetcher)
 */
function getUnstyledContentUrl(url: string): string {
  if (url.includes('/unstyled.html')) {
    return url;
  }

  const baseUrl = url.split('?')[0].split('#')[0];
  const hasTrailingSlash = baseUrl.endsWith('/');

  return hasTrailingSlash ? `${baseUrl}unstyled.html` : `${baseUrl}/unstyled.html`;
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
  // Check for interactive elements (simple string search)
  const hasInteractiveElements = html.includes('data-targetaction') || html.includes('class="interactive"');

  // Extract summary from meta description or first paragraph
  const summary = extractDocSummary(html);

  return {
    hasInteractiveElements,
    summary,
  };
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
