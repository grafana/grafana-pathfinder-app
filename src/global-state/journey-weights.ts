const weightsByJourney = new Map<string, ReadonlyMap<string, number>>();

export function normalizeJourneyUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function setJourneyStepWeights(journeyUrl: string, bySlug: ReadonlyMap<string, number>): void {
  weightsByJourney.set(normalizeJourneyUrl(journeyUrl), new Map(bySlug));
}

/**
 * null = not resolved this session (never ran, or a milestone fetch failed).
 * Consumers MUST treat null as milestone-equal and must never default
 * missing weights when persisting progress or analytics — see RFC
 * pathfinder-rfcs#14 §4.2 (non-deterministic denominators).
 */
export function getJourneyStepWeights(journeyUrl: string): ReadonlyMap<string, number> | null {
  return weightsByJourney.get(normalizeJourneyUrl(journeyUrl)) ?? null;
}

export function clearJourneyStepWeights(journeyUrl?: string): void {
  if (journeyUrl === undefined) {
    weightsByJourney.clear();
    return;
  }
  weightsByJourney.delete(normalizeJourneyUrl(journeyUrl));
}

export function resetJourneyWeightsForTests(): void {
  weightsByJourney.clear();
}
