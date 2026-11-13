import { isInteractiveLearningUrl } from '../security/url-validator';

export function formatSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getInteractiveLearningUrlTitle(url: string): string | undefined {
  if (!isInteractiveLearningUrl(url)) {
    return undefined;
  }

  const segments = new URL(url).pathname.split('/').filter(Boolean);
  if (/^(content\.json|unstyled\.html)$/i.test(segments[segments.length - 1] ?? '')) {
    segments.pop();
  }
  return formatSlug(segments[segments.length - 1] || 'Interactive tutorial');
}
