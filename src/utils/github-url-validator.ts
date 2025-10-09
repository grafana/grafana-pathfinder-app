/**
 * GitHub URL Validator for Tutorial Testing
 * Validates and parses GitHub tree URLs for tutorial directories
 */

export interface GitHubUrlValidation {
  isValid: boolean;
  tutorialName?: string;
  cleanedUrl?: string;
  errorMessage?: string;
}

/**
 * Validates and parses a GitHub tree URL
 * Expected format: https://github.com/{owner}/{repo}/tree/{branch}/{path}
 *
 * @param url - The GitHub URL to validate
 * @returns Validation result with parsed data or error message
 */
export function validateAndParseGitHubUrl(url: string): GitHubUrlValidation {
  // Trim whitespace
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return {
      isValid: false,
      errorMessage: 'Please provide a URL',
    };
  }

  // Check if it's a valid URL
  let urlObj: URL;
  try {
    urlObj = new URL(trimmedUrl);
  } catch {
    return {
      isValid: false,
      errorMessage: 'Invalid URL format. Please provide a valid GitHub URL.',
    };
  }

  // Check if it's a GitHub URL
  if (urlObj.hostname !== 'github.com') {
    return {
      isValid: false,
      errorMessage: 'URL must be from github.com',
    };
  }

  // Parse the path: /{owner}/{repo}/tree/{branch}/{path}
  const pathParts = urlObj.pathname.split('/').filter(Boolean);

  // Need at least: owner, repo, tree, branch, path
  if (pathParts.length < 5) {
    return {
      isValid: false,
      errorMessage:
        'URL must be a GitHub tree URL pointing to a directory. Format: github.com/{owner}/{repo}/tree/{branch}/{path}',
    };
  }

  // Check that it's a tree URL (not blob, etc.)
  if (pathParts[2] !== 'tree') {
    return {
      isValid: false,
      errorMessage: 'URL must be a GitHub tree URL (not blob). Use tree URLs that point to directories.',
    };
  }

  // Extract tutorial name from the last path segment
  const tutorialName = pathParts[pathParts.length - 1];

  if (!tutorialName) {
    return {
      isValid: false,
      errorMessage: 'Could not extract tutorial name from URL',
    };
  }

  // The cleaned URL is the original URL (we'll let content-fetcher handle conversion to raw.githubusercontent.com)
  return {
    isValid: true,
    tutorialName,
    cleanedUrl: trimmedUrl,
  };
}
