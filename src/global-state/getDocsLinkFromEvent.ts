import { isValidEvent } from './isValidEvent';
import { isValidHref } from './isValidHref';
import { QueuedDocsLink } from 'global-state';
import { isValidUrl } from 'global-state/isValidUrl';

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
  }
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
