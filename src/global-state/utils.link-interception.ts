import { QueuedDocsLink } from 'global-state/link-interception';
import { ALLOWED_GITHUB_REPOS } from '../constants';
import { isAllowedContentUrl, isAllowedGitHubRawUrl, isGitHubRawUrl, isGitHubUrl, isLocalhostUrl } from 'security';
import { isDevModeEnabledGlobal } from 'utils/dev-mode';

export const getDocsLinkFromEvent = (event: MouseEvent): QueuedDocsLink | undefined => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const target = event.target;

  if (!isValidEvent(event) || !isValidHref(event)) {
    return;
  }

  const href = target.getAttribute('href');
  const fullUrl = resolveURL(href);

  if (!fullUrl) {
    return;
  }

  if (!isValidUrl(fullUrl)) {
    return;
  }

  const title = extractTitle(fullUrl);

  return {
    url: fullUrl,
    title,
    timestamp: Date.now(),
  };
};

function resolveURL(href: string | null) {
  if (!href) {
    return null;
  }

  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }

  try {
    return new URL(href, window.location.href).href;
  } catch (error) {
    return null;
  }
}

function extractTitle(url: string) {
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    if (pathSegments.length > 0) {
      const lastSegment = pathSegments[pathSegments.length - 1];
      return lastSegment
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  } catch (error) {
    return 'Documentation';
  }

  return 'Documentation';
}

function isValidEvent(event: MouseEvent) {
  return didNotUseModifierKeys(event) && isAnchorElement(event) && isInsidePathfinderContent(event);
}

function didNotUseModifierKeys(event: MouseEvent) {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    return false;
  }

  return true;
}

function isAnchorElement({ target }: MouseEvent) {
  return target instanceof Element && target.closest('a[href]') !== null;
}

function isInsidePathfinderContent({ target }: MouseEvent) {
  return target instanceof Element && target.closest('[data-pathfinder-content]') === null;
}

function isValidHref(event: MouseEvent) {
  if (!(event.target instanceof Element)) {
    return false;
  }

  const href = event.target.getAttribute('href');

  if (!href || href.startsWith('#')) {
    return false;
  }

  return true;
}

// SECURITY (F6): Check if it's a supported docs URL using secure validation
// Must match the same validation as content-fetcher, docs-panel, link-handler, and global-link-interceptor
// In production: Grafana docs URLs and approved GitHub repos
// In dev mode: Also allows any GitHub URLs and localhost URLs for testing
function isValidUrl(url: string): boolean {
  return (
    isAllowedContentUrl(url) ||
    isAllowedGitHubRawUrl(url, ALLOWED_GITHUB_REPOS) ||
    isGitHubUrl(url) ||
    (isDevModeEnabledGlobal() && (isLocalhostUrl(url) || isGitHubRawUrl(url)))
  );
}
