const JOURNEY_BASE_URL_PATTERNS = [
  /^(https?:\/\/[^/]+\/docs\/learning-journeys\/[^/]+)/,
  /^(https?:\/\/[^/]+\/docs\/learning-paths\/[^/]+)/,
  /^(https?:\/\/[^/]+\/tutorials\/[^/]+)/,
];

export function getLearningJourneyBaseUrl(url: string): string {
  for (const pattern of JOURNEY_BASE_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return url.replace(/\/milestone-\d+.*$/, '').replace(/\/$/, '');
}

export function getMilestoneSlug(url: string): string {
  // Private App Platform members are addressed as `backend-guide:<id>` — an
  // opaque scheme with no path to split on. Return the bare id so completion is
  // keyed the same way the read side (LearningPath.guides holds bare ids)
  // expects; without this, progress is written under `backend-guide:<id>` and
  // never matches, so the My Learning ring stays at 0%.
  if (url.startsWith('backend-guide:')) {
    return url.slice('backend-guide:'.length);
  }
  const withoutContentFile = url.replace(/\/(content\.json|unstyled\.html)$/, '');
  return withoutContentFile.replace(/\/+$/, '').split('/').pop() || '';
}
