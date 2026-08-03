import { isInteractiveLearningUrl } from '../../security';

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
 * Check if a URL points to a JSON file (content.json)
 */
export function isJsonContentUrl(url: string): boolean {
  // Check the URL path, ignoring query params and fragments
  const urlPath = url.split('?')[0]!.split('#')[0]!;
  return urlPath.endsWith('.json') || urlPath.endsWith('/content.json');
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
 * Get content URLs for both JSON and HTML formats
 * Returns URLs to try in order of preference: JSON first, then HTML
 */
export function getContentUrls(url: string): { jsonUrl: string; htmlUrl: string } {
  const baseUrl = url.split('?')[0]!.split('#')[0]!.replace(/\/$/, '');

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
 * Check if two URLs match, handling trailing slashes
 */
export function urlsMatch(url1: string, url2: string): boolean {
  const normalize = (u: string) => u.replace(/\/$/, '').toLowerCase();
  return normalize(url1) === normalize(url2);
}
