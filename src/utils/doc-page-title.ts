import { isInteractiveLearningUrl } from '../security/url-validator';
import { stripContentFile } from '../lib/guide-content-file';

export function formatSlug(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getInteractiveLearningUrlTitle(url: string): string | undefined {
  if (!isInteractiveLearningUrl(url)) {
    return undefined;
  }

  const segments = stripContentFile(new URL(url).pathname).split('/').filter(Boolean);
  if (/^unstyled\.html$/i.test(segments[segments.length - 1] ?? '')) {
    segments.pop();
  }
  return formatSlug(segments[segments.length - 1] || 'Interactive tutorial');
}
