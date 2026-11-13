import { getPrTestFetchId } from './pr-test-marker';

export function getGuideResponseId(contentUrl: string, origin: string): string {
  try {
    const key = new URL(contentUrl, origin).pathname.replace(/^\//, '').replace(/\//g, '-') || 'default';
    const fetchId = getPrTestFetchId(contentUrl);
    return fetchId ? `${key}-pf-pr-${fetchId}` : key;
  } catch {
    return contentUrl || 'default';
  }
}
