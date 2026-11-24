// Resolves a Grafana Learn journey from the website's own `index.json` files.
// The journey index lists its sections or modules and each section index lists
// its steps. Order follows the website's navigation, so both levels sort by
// `params.weight`. Design and failure rules: docs/design/GRAFANA_LEARN.md.
import type { GuideLoadContext } from '../../types/guide-diagnostics.types';
import type { LearningJourneyMetadata, Milestone } from '../../types/content.types';
import { DEFAULT_CONTENT_FETCH_TIMEOUT } from '../../constants';
import { classifyDocsUrl, type LearnKind, type LearnLocation } from '../../lib/docs-url-family';
import { stripContentFile } from '../../lib/guide-content-file';
import { logger } from '../../lib/logging';
import { fetchGuideResource } from '../../lib/telemetry/guide-load';
import { isGrafanaDocsUrl, isTrustedFinalUrl, parseUrlSafely } from '../../security';
import { isLearnJourneyModeUrl, learnJourneyLocation } from '../../utils/learn-journey-mode';
import { enforceHttps } from './fetch-raw';
import { urlsMatch } from './url-utils';

const LEARN_ORIGIN = 'https://grafana.com';

export const LEARN_JOURNEY_TTL_MS = 10 * 60 * 1000;
export const LEARN_FAILURE_TTL_MS = 30 * 1000;

const MAX_CACHED_JOURNEYS = 64;
const MAX_ENTRIES_PER_INDEX = 200;

export interface LearnJourney {
  /** Journey URL without a trailing slash. */
  baseUrl: string;
  /** Every step in website order, numbered from 1, each carrying the section it sits under. */
  milestones: Milestone[];
  /** A section index failed or was cut short, so `milestones` is a partial tree. */
  hasUnavailableMilestones: boolean;
}

/** Where a requested Learn URL sits in its resolved journey, and which page to fetch for it. */
export interface LearnJourneyPlan {
  journey: LearnJourney;
  /** 0 for the cover, otherwise the step's milestone number. */
  currentMilestone: number;
  /** The journey or step page to fetch; a section URL becomes its first step. */
  fetchUrl: string;
}

interface IndexEntry {
  url: string;
  title?: string;
  weight?: number;
  order: number;
}

interface CacheEntry {
  expiresAt: number;
  promise: Promise<LearnJourney | null>;
}

const cache = new Map<string, CacheEntry>();

export function resetLearnJourneyCache(): void {
  cache.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function withTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function withoutTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function sameUrl(a: string, b: string): boolean {
  return urlsMatch(a, b);
}

/** The page URL with its content file, query and fragment removed. */
function pageUrl(raw: string): string | undefined {
  const parsed = parseUrlSafely(raw);
  return parsed ? `${parsed.origin}${stripContentFile(parsed.pathname).replace(/\/unstyled\.html$/, '')}` : undefined;
}

async function fetchIndex(baseUrl: string, context: GuideLoadContext | undefined): Promise<unknown[] | null> {
  const indexUrl = `${withoutTrailingSlash(baseUrl)}/index.json`;
  if (!isTrustedFinalUrl(indexUrl) || !enforceHttps(indexUrl)) {
    return null;
  }
  try {
    const response = await fetchGuideResource(
      indexUrl,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(DEFAULT_CONTENT_FETCH_TIMEOUT),
      },
      context,
      'index'
    );
    if (!response.ok) {
      logger.warn('Learn index request failed', { status: response.status });
      return null;
    }
    if (response.url && (!isTrustedFinalUrl(response.url) || !enforceHttps(response.url))) {
      logger.warn('Learn index redirected outside the trusted docs hosts');
      return null;
    }
    const data: unknown = await response.json();
    return Array.isArray(data) ? data : null;
  } catch (error) {
    logger.warn('Learn index request failed', { error });
    return null;
  }
}

function indexEntry(raw: unknown, order: number): { url: string; entry: IndexEntry } | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const params = isRecord(raw.params) ? raw.params : {};
  if (isRecord(params.grafana) && params.grafana.skip) {
    return undefined;
  }
  const permalink = nonEmptyString(raw.permalink);
  if (!permalink) {
    return undefined;
  }
  let absolute: URL;
  try {
    absolute = new URL(permalink, LEARN_ORIGIN);
  } catch {
    return undefined;
  }
  // SECURITY: the index is network input, so every permalink passes the trust predicate before it becomes a URL.
  if (!isGrafanaDocsUrl(absolute.href)) {
    logger.warn('Ignoring a Learn index entry outside the trusted docs hosts');
    return undefined;
  }
  const url = withTrailingSlash(`${absolute.origin}${absolute.pathname}`);
  const weight = typeof params.weight === 'number' && Number.isFinite(params.weight) ? params.weight : undefined;
  return {
    url,
    entry: { url, title: nonEmptyString(params.title) ?? nonEmptyString(params.menutitle), weight, order },
  };
}

function sameHierarchy(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && sameUrl(a, b);
}

/** The entries of one index that are the expected kind of child of `parent`, in website order. */
function orderedChildren(
  raw: unknown[],
  kind: LearnKind,
  belongsTo: (location: LearnLocation) => boolean
): { entries: IndexEntry[]; truncated: boolean } {
  const seen = new Set<string>();
  const entries: IndexEntry[] = [];
  raw.forEach((item, order) => {
    const parsed = indexEntry(item, order);
    if (!parsed) {
      return;
    }
    const location = learnJourneyLocation(classifyDocsUrl(parsed.url));
    if (!location || location.kind !== kind || !belongsTo(location) || seen.has(parsed.url.toLowerCase())) {
      return;
    }
    seen.add(parsed.url.toLowerCase());
    entries.push(parsed.entry);
  });
  entries.sort((a, b) => {
    const weightA = a.weight ?? Number.POSITIVE_INFINITY;
    const weightB = b.weight ?? Number.POSITIVE_INFINITY;
    return weightA === weightB ? a.order - b.order : weightA < weightB ? -1 : 1;
  });
  return { entries: entries.slice(0, MAX_ENTRIES_PER_INDEX), truncated: entries.length > MAX_ENTRIES_PER_INDEX };
}

async function loadJourney(baseUrl: string, context: GuideLoadContext | undefined): Promise<LearnJourney | null> {
  const journeyIndex = await fetchIndex(baseUrl, context);
  if (!journeyIndex) {
    return null;
  }
  const sections = orderedChildren(journeyIndex, 'section', (location) =>
    sameHierarchy(location.journeyBaseUrl, baseUrl)
  );
  const stepLists = await Promise.all(
    sections.entries.map(async (section) => {
      const stepIndex = await fetchIndex(section.url, context);
      return (
        stepIndex && orderedChildren(stepIndex, 'step', (location) => sameHierarchy(location.sectionUrl, section.url))
      );
    })
  );

  let hasUnavailableMilestones = sections.truncated;
  const milestones: Milestone[] = [];
  sections.entries.forEach((section, sectionIndex) => {
    const steps = stepLists[sectionIndex];
    if (!steps) {
      hasUnavailableMilestones = true;
      return;
    }
    hasUnavailableMilestones ||= steps.truncated;
    const sectionTitle = section.title ?? `Section ${sectionIndex + 1}`;
    for (const step of steps.entries) {
      const number = milestones.length + 1;
      milestones.push({
        number,
        title: step.title ?? `Step ${number}`,
        url: step.url,
        isActive: false,
        section: { url: withoutTrailingSlash(section.url), title: sectionTitle },
      });
    }
  });

  if (milestones.length === 0) {
    return null;
  }
  return { baseUrl, milestones, hasUnavailableMilestones };
}

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
  while (cache.size >= MAX_CACHED_JOURNEYS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

/**
 * Resolve a journey from its URL without a trailing slash. Concurrent callers
 * share one load. The cache holds anonymous public data only, lives in memory,
 * and keeps a partial tree or a failure for the short lifetime so a recovered
 * website is picked up quickly.
 */
export function resolveLearnJourney(baseUrl: string, context?: GuideLoadContext): Promise<LearnJourney | null> {
  const now = Date.now();
  const hit = cache.get(baseUrl);
  if (hit && hit.expiresAt > now) {
    return hit.promise;
  }
  pruneCache(now);
  const entry: CacheEntry = { expiresAt: Number.POSITIVE_INFINITY, promise: Promise.resolve(null) };
  entry.promise = loadJourney(baseUrl, context)
    .catch((error): null => {
      logger.warn('Learn journey resolution failed', { error });
      return null;
    })
    .then((journey) => {
      const lifetime = journey && !journey.hasUnavailableMilestones ? LEARN_JOURNEY_TTL_MS : LEARN_FAILURE_TTL_MS;
      entry.expiresAt = Date.now() + lifetime;
      return journey;
    });
  cache.set(baseUrl, entry);
  return entry.promise;
}

function locate(journey: LearnJourney, url: string, location: LearnLocation): LearnJourneyPlan | undefined {
  if (location.kind === 'journey') {
    return { journey, currentMilestone: 0, fetchUrl: url };
  }
  const target =
    location.kind === 'step'
      ? journey.milestones.find((milestone) => sameUrl(milestone.url, pageUrl(url) ?? ''))
      : journey.milestones.find(
          (milestone) => location.sectionUrl !== undefined && sameHierarchy(milestone.section?.url, location.sectionUrl)
        );
  return target && { journey, currentMilestone: target.number, fetchUrl: target.url };
}

/**
 * Where a requested Learn URL sits in its journey, or `undefined` when it
 * should open as a single document: the flag is off, the URL is not a Learn
 * journey, section or step, the journey index is unavailable, or the URL is
 * missing from the tree.
 */
export async function planLearnJourney(url: string, context?: GuideLoadContext): Promise<LearnJourneyPlan | undefined> {
  const classification = classifyDocsUrl(url);
  const location = learnJourneyLocation(classification);
  if (!location?.journeyBaseUrl || !isLearnJourneyModeUrl(classification)) {
    return undefined;
  }
  const journey = await resolveLearnJourney(location.journeyBaseUrl, context);
  if (!journey) {
    logger.warn('Learn journey unavailable; opening it as a single document');
    return undefined;
  }
  const plan = locate(journey, url, location);
  if (!plan) {
    logger.warn('Learn page is not in its journey index; opening it as a single document');
  }
  return plan;
}

/** The journey's own page title: Learn pages end their `<title>` with the site name. */
export function cleanLearnDocumentTitle(title: string): string {
  return title.replace(/\s*\|\s*Grafana Labs\s*$/i, '').trim() || title;
}

export function learnJourneyMetadata(plan: LearnJourneyPlan, summary: string): LearningJourneyMetadata {
  const { journey, currentMilestone } = plan;
  return {
    currentMilestone,
    totalMilestones: journey.milestones.length,
    milestones: journey.milestones,
    baseUrl: journey.baseUrl,
    summary,
    ...(journey.hasUnavailableMilestones && { hasUnavailableMilestones: true }),
  };
}
