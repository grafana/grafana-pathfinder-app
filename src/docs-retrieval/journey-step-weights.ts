import { fetchContent } from './content-fetcher';
import { countGuideSteps } from './count-guide-steps';
import { getMilestoneSlug } from './learning-journey-helpers';
import { getJourneyStepWeights, normalizeJourneyUrl, setJourneyStepWeights } from '../global-state/journey-weights';
import type { Milestone } from '../types/content.types';
import type { JsonBlock } from '../types/json-guide.types';

const weightByUrl = new Map<string, number>();
const inFlightByUrl = new Map<string, Promise<number | null>>();
const inFlightByJourney = new Map<string, Promise<void>>();

/**
 * Fetch every milestone's content.json in parallel, count its steps
 * statically, and publish the weights to the journey-weights store.
 * Successful counts are session-cached per content URL. Failed fetches are
 * NOT cached and leave the whole journey unresolved (store stays null →
 * milestone-equal), so denominators are deterministic per RFC
 * pathfinder-rfcs#14 §4.2; the next resolve retries only the failed URLs.
 */
export async function resolveJourneyStepWeights(journeyUrl: string, milestones: readonly Milestone[]): Promise<void> {
  if (milestones.length === 0) {
    return;
  }
  const existing = getJourneyStepWeights(journeyUrl);
  if (existing !== null && milestones.every((m) => existing.has(getMilestoneSlug(m.url)))) {
    return;
  }
  const journeyKey = normalizeJourneyUrl(journeyUrl);
  const inFlight = inFlightByJourney.get(journeyKey);
  if (inFlight) {
    return inFlight;
  }
  const resolution = (async () => {
    const weights = await Promise.all(milestones.map((m) => weightForUrl(m.url)));
    if (weights.some((weight) => weight === null)) {
      return;
    }
    setJourneyStepWeights(journeyUrl, new Map(milestones.map((m, i) => [getMilestoneSlug(m.url), weights[i] ?? 1])));
  })().finally(() => inFlightByJourney.delete(journeyKey));
  inFlightByJourney.set(journeyKey, resolution);
  return resolution;
}

function weightForUrl(url: string): Promise<number | null> {
  const cached = weightByUrl.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const inFlight = inFlightByUrl.get(url);
  if (inFlight) {
    return inFlight;
  }
  const resolution = fetchWeight(url)
    .catch(() => null)
    .then((weight) => {
      if (weight !== null) {
        weightByUrl.set(url, weight);
      }
      return weight;
    })
    .finally(() => inFlightByUrl.delete(url));
  inFlightByUrl.set(url, resolution);
  return resolution;
}

/**
 * null = fetch failed (do not cache; retryable). Content that fetches but
 * has no countable steps — passive, HTML-wrapped, malformed — weighs 1
 * deterministically: same content yields the same weight every session.
 */
async function fetchWeight(url: string): Promise<number | null> {
  const result = await fetchContent(url, { skipJourneyMetadata: true });
  if (!result.content) {
    return null;
  }
  try {
    const guide: unknown = JSON.parse(result.content.content);
    const blocks = (guide as { blocks?: JsonBlock[] } | null)?.blocks;
    if (!Array.isArray(blocks)) {
      return 1;
    }
    const count = countGuideSteps({ blocks });
    return count > 0 ? count : 1;
  } catch {
    return 1;
  }
}

export function resetJourneyStepWeightsResolverForTests(): void {
  weightByUrl.clear();
  inFlightByUrl.clear();
  inFlightByJourney.clear();
}
