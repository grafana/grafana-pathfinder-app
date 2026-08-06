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
  const withoutContentFile = url.replace(/\/(content\.json|unstyled\.html)$/, '');
  return withoutContentFile.replace(/\/+$/, '').split('/').pop() || '';
}
