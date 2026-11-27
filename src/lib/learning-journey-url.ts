import { stripPrTestMarker } from './pr-test-marker';
import { stripContentFile } from './guide-content-file';
import { classifyDocsUrl } from './docs-url-family';

export function getLearningJourneyBaseUrl(url: string): string {
  const { journeyBaseUrl } = classifyDocsUrl(url);
  if (journeyBaseUrl) {
    return journeyBaseUrl;
  }

  // Not an http(s) journey URL (relative, or another scheme): strip a milestone as plain text.
  return url.replace(/\/milestone-\d+.*$/, '').replace(/\/$/, '');
}

export function getMilestoneSlug(rawUrl: string): string {
  const url = stripPrTestMarker(rawUrl);
  // Private App Platform members are addressed as `backend-guide:<id>` — an
  // opaque scheme with no path to split on. Return the bare id so completion is
  // keyed the same way the read side (LearningPath.guides holds bare ids)
  // expects; without this, progress is written under `backend-guide:<id>` and
  // never matches, so the My Learning ring stays at 0%.
  if (url.startsWith('backend-guide:')) {
    return url.slice('backend-guide:'.length);
  }
  const withoutContentFile = stripContentFile(url).replace(/\/unstyled\.html$/, '');
  return withoutContentFile.replace(/\/+$/, '').split('/').pop() || '';
}
