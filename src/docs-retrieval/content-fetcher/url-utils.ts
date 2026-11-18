import { isInteractiveLearningUrl } from '../../security';
import { CANONICAL_CONTENT_FILE, contentFileSiblingUrl, isContentFileUrl } from '../../lib/guide-content-file';

export { getLearningJourneyBaseUrl } from '../../lib/learning-journey-url';

/**
 * Generate a simple ID from a URL for use in wrapped JSON guides.
 */
export function generateUrlId(url: string): string {
  // Create a simple hash-like ID from the URL
  const cleanUrl = url.replace(/^https?:\/\//, '').replace(/[^a-zA-Z0-9]/g, '-');
  return cleanUrl.slice(0, 50);
}

/**
 * Check if a URL points to a JSON file (content.json or a localized content.<locale>.json)
 */
export function isJsonContentUrl(url: string): boolean {
  // Check the URL path, ignoring query params and fragments
  const urlPath = url.split('?')[0]!.split('#')[0]!;
  return urlPath.endsWith('.json');
}

/**
 * Generate URL variations for interactive learning content
 * Tries content.json first (preferred JSON format), then unstyled.html (fallback)
 *
 * @param url - The interactive learning URL
 * @returns Array of URLs to try in order: [content.json, unstyled.html]
 */
export function generateInteractiveLearningVariations(url: string): string[] {
  const variations: string[] = [];

  // Only generate variations for interactive learning URLs
  if (!isInteractiveLearningUrl(url)) {
    return variations;
  }

  // Clean the URL path (remove trailing slash)
  const baseUrl = url.split('?')[0]!.split('#')[0]!.replace(/\/$/, '');

  // If URL already points to a content file or unstyled.html, return as-is
  if (isContentFileUrl(baseUrl) || baseUrl.endsWith('/unstyled.html')) {
    return [url];
  }

  // Try content.json first (preferred), then unstyled.html as fallback
  variations.push(`${baseUrl}/${CANONICAL_CONTENT_FILE}`);
  variations.push(`${baseUrl}/unstyled.html`);

  return variations;
}

/**
 * Get content URLs for both JSON and HTML formats
 * Returns URLs to try in order of preference: JSON first, then HTML
 */
export function getContentUrls(url: string): { jsonUrl: string; htmlUrl: string } {
  const baseUrl = url.split('?')[0]!.split('#')[0]!.replace(/\/$/, '');

  // If URL already points to a specific file, return it as-is for JSON detection
  const htmlSibling = contentFileSiblingUrl(baseUrl, 'unstyled.html');
  if (htmlSibling) {
    return { jsonUrl: url, htmlUrl: htmlSibling };
  }
  if (url.includes('/unstyled.html')) {
    return { jsonUrl: baseUrl.replace('/unstyled.html', `/${CANONICAL_CONTENT_FILE}`), htmlUrl: url };
  }

  return {
    jsonUrl: `${baseUrl}/${CANONICAL_CONTENT_FILE}`,
    htmlUrl: `${baseUrl}/unstyled.html`,
  };
}

/**
 * Check if two URLs match, handling trailing slashes
 */
export function urlsMatch(url1: string, url2: string): boolean {
  const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
  return normalize(url1) === normalize(url2);
}
