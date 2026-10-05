import type { QueuedDocsLink } from 'types/link-interception.types';
import { isAllowedContentUrl, isLocalhostUrl, isGitHubRawUrl } from 'security/url-validator';
import { isDevModeEnabledGlobal } from '../utils/dev-mode';

export const getDocsLinkFromEvent = (event: MouseEvent): QueuedDocsLink | undefined => {
  if (event.defaultPrevented || !(event.target instanceof Element) || !didNotUseModifierKeys(event)) {
    return;
  }

  const target = event.target;
  const anchor = target.closest('a[href]');

  if (!anchor || !isOutsidePathfinderContent(target) || !isNotInsideWysiwygEditor(target)) {
    return;
  }

  const href = anchor.getAttribute('href');

  if (!href || href.startsWith('#') || anchor.hasAttribute('download')) {
    return;
  }

  const fullUrl = resolveURL(href);

  if (!fullUrl || !isValidUrl(fullUrl)) {
    return;
  }

  return {
    url: fullUrl,
    title: extractTitle(fullUrl),
    timestamp: Date.now(),
  };
};

function resolveURL(href: string) {
  if (href.startsWith('http://') || href.startsWith('https://')) {
    return href;
  }

  try {
    return new URL(href, window.location.href).href;
  } catch {
    return null;
  }
}

function extractTitle(url: string) {
  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    if (pathSegments.length > 0) {
      const lastSegment = pathSegments[pathSegments.length - 1]!;
      return lastSegment
        .split('-')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
  } catch {
    return 'Documentation';
  }

  return 'Documentation';
}

function didNotUseModifierKeys(event: MouseEvent) {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

function isOutsidePathfinderContent(target: Element) {
  return target.closest('[data-pathfinder-content]') === null;
}

function isNotInsideWysiwygEditor(target: Element): boolean {
  return target.closest('.ProseMirror') === null && target.closest('.wysiwyg-editor-container') === null;
}

// SECURITY (F6): Check if it's a supported docs URL using secure validation
// In production: Grafana docs URLs and interactive learning domains
// In dev mode: Also allows localhost and GitHub raw URLs for testing
function isValidUrl(url: string): boolean {
  const isDevMode = isDevModeEnabledGlobal();
  return isAllowedContentUrl(url) || (isDevMode && isLocalhostUrl(url)) || (isDevMode && isGitHubRawUrl(url));
}
