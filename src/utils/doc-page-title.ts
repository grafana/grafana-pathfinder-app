import { isInteractiveLearningUrl } from '../security/url-validator';
import { stripContentFile } from '../lib/guide-content-file';
import { classifyDocsUrl } from '../lib/docs-url-family';
import { isLearnJourneyModeUrl } from './learn-journey-mode';

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

/**
 * The slug-based title a Learn journey, section or step tab shows until its
 * resolved title arrives, while Learn journey mode is on. `titleFromLoadedContent`
 * swaps it for the real one.
 */
export function getLearnUrlPlaceholderTitle(url: string): string | undefined {
  if (!isLearnJourneyModeUrl(classifyDocsUrl(url))) {
    return undefined;
  }
  const segments = stripContentFile(new URL(url).pathname)
    .split('/')
    .filter((segment) => segment && !/^unstyled\.html$/i.test(segment));
  const slug = segments[segments.length - 1];
  return slug ? formatSlug(slug) : undefined;
}
