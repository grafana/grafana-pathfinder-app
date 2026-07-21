import { fetchContent } from './content-fetcher';
import { countGuideSteps } from './count-guide-steps';
import { getMilestoneSlug } from './learning-journey-helpers';
import {
  clearJourneyStepWeights,
  getJourneyStepWeights,
  normalizeJourneyUrl,
  setJourneyStepWeights,
} from '../global-state/journey-weights';
import type { Milestone } from '../types/content.types';
import type { JsonBlock } from '../types/json-guide.types';

const weightByUrl = new Map<string, number>();
const inFlightByUrl = new Map<string, Promise<number | null>>();
const inFlightByJourney = new Map<string, Promise<void>>();
const retryAfterByJourney = new Map<string, number>();

const MAX_CONCURRENT_FETCHES = 6;
const RESOLUTION_BUDGET_MS = 3_000;
const FAILED_RESOLUTION_TTL_MS = 30_000;

/**
 * Resolve static step counts under a bounded concurrency and time budget.
 * A partial roster is never published: failure leaves the journey unresolved.
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
  if ((retryAfterByJourney.get(journeyKey) ?? 0) > Date.now()) {
    clearJourneyStepWeights(journeyUrl);
    return;
  }
  const inFlight = inFlightByJourney.get(journeyKey);
  if (inFlight) {
    await inFlight;
    return resolveJourneyStepWeights(journeyUrl, milestones);
  }
  clearJourneyStepWeights(journeyUrl);
  const resolution = (async () => {
    const weights = await resolveRosterWeights(milestones, Date.now() + RESOLUTION_BUDGET_MS);
    if (weights.some((weight) => weight === null)) {
      retryAfterByJourney.set(journeyKey, Date.now() + FAILED_RESOLUTION_TTL_MS);
      return;
    }
    retryAfterByJourney.delete(journeyKey);
    setJourneyStepWeights(journeyUrl, new Map(milestones.map((m, i) => [getMilestoneSlug(m.url), weights[i] ?? 1])));
  })().finally(() => inFlightByJourney.delete(journeyKey));
  inFlightByJourney.set(journeyKey, resolution);
  return resolution;
}

async function resolveRosterWeights(milestones: readonly Milestone[], deadline: number): Promise<Array<number | null>> {
  const weights: Array<number | null> = Array.from({ length: milestones.length }, () => null);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < milestones.length) {
      const index = nextIndex++;
      const milestone = milestones[index];
      const remainingMs = deadline - Date.now();
      if (!milestone || remainingMs <= 0) {
        return;
      }
      weights[index] = await weightForUrl(milestone.url, remainingMs);
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_FETCHES, milestones.length) }, () => worker()));
  return weights;
}

function weightForUrl(url: string, timeoutMs: number): Promise<number | null> {
  const cached = weightByUrl.get(url);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }
  const inFlight = inFlightByUrl.get(url);
  if (inFlight) {
    return settleWithin(inFlight, timeoutMs);
  }
  const resolution = settleWithin(fetchWeight(url, timeoutMs), timeoutMs)
    .then((weight) => {
      if (weight !== null) {
        weightByUrl.set(url, weight);
      }
      return weight;
    })
    .finally(() => {
      if (inFlightByUrl.get(url) === resolution) {
        inFlightByUrl.delete(url);
      }
    });
  inFlightByUrl.set(url, resolution);
  return resolution;
}

function settleWithin(promise: Promise<number | null>, timeoutMs: number): Promise<number | null> {
  if (timeoutMs <= 0) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(null);
      }
    );
  });
}

/** `null` is retryable; fetched content without countable steps deterministically weighs 1. */
async function fetchWeight(url: string, timeout: number): Promise<number | null> {
  const result = await fetchContent(url, { skipJourneyMetadata: true, timeout });
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
  retryAfterByJourney.clear();
}
