import { QueuedDocsLink } from 'global-state/link-interception';
import { isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from 'security';
import { isDevModeEnabledGlobal } from '../components/wysiwyg-editor/dev-mode';

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
  return (
    didNotUseModifierKeys(event) &&
    isAnchorElement(event) &&
    isInsidePathfinderContent(event) &&
    isNotInsideWysiwygEditor(event)
  );
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

// Ignore clicks from within the WYSIWYG editor to prevent interference with editor interactions
function isNotInsideWysiwygEditor({ target }: MouseEvent): boolean {
  if (!(target instanceof Element)) {
    return true;
  }

  // Don't intercept clicks from within ProseMirror editor or wysiwyg editor container
  return target.closest('.ProseMirror') === null && target.closest('.wysiwyg-editor-container') === null;
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
// In production: Grafana docs URLs and interactive learning domains
// In dev mode: Also allows localhost and GitHub raw URLs for testing
function isValidUrl(url: string): boolean {
  const isDevMode = isDevModeEnabledGlobal();
  return isAllowedContentUrl(url) || (isDevMode && isLocalhostUrl(url)) || (isDevMode && isGitHubRawUrl(url));
}
