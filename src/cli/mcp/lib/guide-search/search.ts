/**
 * Lexical guide search over the published package catalog, independent of the
 * MCP transport. `buildGuideSearchIndex` runs once per catalog version;
 * `searchGuides` runs per call.
 */

import { normalizeTerms } from './terms';
import {
  compileTargeting,
  isAvailableOnPlatform,
  normalizePageUrl,
  pageMatchLength,
  type SearchPlatform,
  type TargetingNode,
} from './targeting';

export interface CatalogEntry {
  id: string;
  type: string;
  path: string;
  title?: string;
  description?: string;
  category?: string;
  startingLocation?: string;
  milestones?: string[];
  targeting?: { match?: unknown };
}

export type MatchField = 'title' | 'id' | 'category' | 'description' | 'page';
export type Relevance = 'strong' | 'partial';
export type ResultKind = 'guide' | 'path';

type TextField = Exclude<MatchField, 'page'>;

const FIELD_WEIGHTS: Record<TextField, number> = { title: 3, id: 2, category: 1.5, description: 1 };
const TEXT_FIELDS = Object.keys(FIELD_WEIGHTS) as TextField[];
const MATCHED_ON_ORDER: MatchField[] = ['title', 'id', 'category', 'description', 'page'];

const PREFIX_MATCH_FACTOR = 0.6;
const MIN_PREFIX_TERM_LENGTH = 4;
const MIN_REVERSE_PREFIX_LENGTH = 6;
const EXTRA_QUERY_WEIGHT = 0.25;
const PAGE_TARGETING_SCORE = 4;
const PAGE_STARTING_LOCATION_SCORE = 2;
const PAGE_SPECIFICITY_SCORE = 2;
const PAGE_SPECIFICITY_LENGTH = 40;
const MAX_MATCHED_STEPS = 3;
const SCORE_EPSILON = 1e-9;

interface IndexedEntry {
  entry: CatalogEntry;
  kind: ResultKind;
  fields: Record<TextField, Set<string>>;
  targeting: TargetingNode | null;
  startingLocation?: string;
  hiddenOn: Set<SearchPlatform>;
}

interface ParentRef {
  pathId: string;
  step: number;
  of: number;
}

export interface GuideSearchIndex {
  readonly entries: readonly IndexedEntry[];
  readonly byId: ReadonlyMap<string, IndexedEntry>;
  readonly parents: ReadonlyMap<string, readonly ParentRef[]>;
  readonly stepCounts: ReadonlyMap<string, number>;
  readonly idf: ReadonlyMap<string, number>;
  readonly categories: readonly string[];
}

export interface GuideSearchRequest {
  queries?: string[];
  pageUrl?: string;
  categories?: string[];
  type?: ResultKind;
  platform?: SearchPlatform;
  excludeIds?: string[];
  limit: number;
}

export interface GuideSearchStep {
  id: string;
  title?: string;
  step: number;
}

export interface GuideSearchResult {
  entry: CatalogEntry;
  type: ResultKind;
  relevance: Relevance;
  matchedOn: MatchField[];
  stepCount?: number;
  matchedSteps?: GuideSearchStep[];
  partOf?: { id: string; title?: string; step: number; of: number };
}

export type GuideSearchOutcome =
  | { ok: true; results: GuideSearchResult[]; totalMatches: number; noStrongMatch: boolean }
  | { ok: false; code: 'UNKNOWN_CATEGORY'; unknown: string[]; categories: readonly string[] };

interface Scored {
  indexed: IndexedEntry;
  score: number;
  strong: boolean;
  matchedOn: Set<MatchField>;
}

interface Expansion {
  term: string;
  factor: number;
}

export function buildGuideSearchIndex(catalog: readonly CatalogEntry[]): GuideSearchIndex {
  const entries = [...catalog]
    .filter((entry) => typeof entry.id === 'string' && entry.id !== '')
    .sort((a, b) => compareIds(a.id, b.id))
    .map(indexEntry);
  const byId = new Map(entries.map((indexed) => [indexed.entry.id, indexed]));

  const parents = new Map<string, ParentRef[]>();
  const stepCounts = new Map<string, number>();
  for (const indexed of entries) {
    if (indexed.kind !== 'path') {
      continue;
    }
    const steps = (indexed.entry.milestones ?? []).filter(
      (id, i, all) => byId.get(id)?.kind === 'guide' && all.indexOf(id) === i
    );
    stepCounts.set(indexed.entry.id, steps.length);
    steps.forEach((stepId, i) => {
      const refs = parents.get(stepId) ?? [];
      refs.push({ pathId: indexed.entry.id, step: i + 1, of: steps.length });
      parents.set(stepId, refs);
    });
  }

  const documentFrequency = new Map<string, number>();
  for (const indexed of entries) {
    const seen = new Set(TEXT_FIELDS.flatMap((field) => [...indexed.fields[field]]));
    for (const term of seen) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map([...documentFrequency].map(([term, df]) => [term, Math.log(1 + entries.length / df)] as const));

  const categories = [
    ...new Set(entries.map((e) => e.entry.category).filter((c): c is string => typeof c === 'string' && c !== '')),
  ].sort(compareIds);

  return { entries, byId, parents, stepCounts, idf, categories };
}

function indexEntry(raw: CatalogEntry): IndexedEntry {
  const entry = sanitizeEntry(raw);
  const targeting = compileTargeting(entry.targeting?.match);
  const hiddenOn = new Set<SearchPlatform>(
    targeting ? (['cloud', 'oss'] as const).filter((p) => !isAvailableOnPlatform(targeting, p)) : []
  );
  const startingLocation = entry.startingLocation === undefined ? undefined : normalizePageUrl(entry.startingLocation);
  return {
    entry,
    kind: entry.type === 'path' || entry.type === 'journey' ? 'path' : 'guide',
    fields: {
      title: new Set(normalizeTerms(entry.title ?? '')),
      id: new Set(normalizeTerms(entry.id)),
      category: new Set(normalizeTerms(entry.category ?? '')),
      description: new Set(normalizeTerms(entry.description ?? '')),
    },
    targeting,
    ...(startingLocation && startingLocation.length > 1 ? { startingLocation } : {}),
    hiddenOn,
  };
}

/** Catalog entries that failed schema validation still arrive, so keep only well-typed fields. */
function sanitizeEntry(raw: CatalogEntry): CatalogEntry {
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.filter((id): id is string => typeof id === 'string')
    : undefined;
  const targeting = raw.targeting !== null && typeof raw.targeting === 'object' ? raw.targeting : undefined;
  return omitUndefined({
    id: raw.id,
    type: text(raw.type) ?? 'guide',
    path: text(raw.path) ?? '',
    title: text(raw.title),
    description: text(raw.description),
    category: text(raw.category),
    startingLocation: text(raw.startingLocation),
    milestones,
    targeting,
  });
}

function omitUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

export function searchGuides(index: GuideSearchIndex, request: GuideSearchRequest): GuideSearchOutcome {
  const unknown = (request.categories ?? []).filter((c) => !index.categories.includes(c));
  if (unknown.length > 0) {
    return { ok: false, code: 'UNKNOWN_CATEGORY', unknown, categories: index.categories };
  }

  const queries = (request.queries ?? []).map(normalizeTerms).filter((terms) => terms.length > 0);
  const pageUrl = request.pageUrl === undefined ? undefined : normalizePageUrl(request.pageUrl);
  if (queries.length === 0 && pageUrl === undefined) {
    return { ok: true, results: [], totalMatches: 0, noStrongMatch: true };
  }

  const excluded = new Set(request.excludeIds ?? []);
  const isEligible = (indexed: IndexedEntry | undefined): indexed is IndexedEntry =>
    indexed !== undefined &&
    !excluded.has(indexed.entry.id) &&
    !(request.platform !== undefined && indexed.hiddenOn.has(request.platform));
  const passesCategory = (indexed: IndexedEntry): boolean =>
    request.categories === undefined ||
    request.categories.length === 0 ||
    request.categories.includes(indexed.entry.category ?? '');

  const expansions = expandTerms(index, queries);
  const scored = index.entries
    .filter(isEligible)
    .map((indexed) => scoreEntry(indexed, queries, expansions, index.idf, pageUrl, request.platform))
    .filter((s): s is Scored => s !== null);

  const results =
    request.type === 'guide'
      ? collectGuides(index, scored, passesCategory)
      : collectGrouped(index, scored, isEligible, passesCategory, request.type === 'path');

  results.sort(compareRanked);
  const page = results.slice(0, request.limit).map(({ result }) => result);
  return {
    ok: true,
    results: page,
    totalMatches: results.length,
    noStrongMatch: !page.some((r) => r.relevance === 'strong'),
  };
}

function expandTerms(index: GuideSearchIndex, queries: string[][]): Map<string, Expansion[]> {
  const expansions = new Map<string, Expansion[]>();
  const vocabulary = [...index.idf.keys()];
  for (const term of queries.flat()) {
    if (expansions.has(term)) {
      continue;
    }
    const found: Expansion[] = index.idf.has(term) ? [{ term, factor: 1 }] : [];
    if (term.length >= MIN_PREFIX_TERM_LENGTH && !/^\d+$/.test(term)) {
      for (const candidate of vocabulary) {
        if (candidate === term || candidate.length < MIN_PREFIX_TERM_LENGTH) {
          continue;
        }
        if (
          candidate.startsWith(term) ||
          (candidate.length >= MIN_REVERSE_PREFIX_LENGTH && term.startsWith(candidate))
        ) {
          found.push({ term: candidate, factor: PREFIX_MATCH_FACTOR });
        }
      }
    }
    expansions.set(term, found);
  }
  return expansions;
}

function scoreEntry(
  indexed: IndexedEntry,
  queries: string[][],
  expansions: Map<string, Expansion[]>,
  idf: ReadonlyMap<string, number>,
  pageUrl: string | undefined,
  platform: SearchPlatform | undefined
): Scored | null {
  const matchedOn = new Set<MatchField>();
  let strong = false;
  const queryScores: number[] = [];

  for (const terms of queries) {
    let sum = 0;
    let matchedTerms = 0;
    let allInTitleOrId = true;
    for (const term of terms) {
      let best = 0;
      let inTitleOrId = false;
      for (const field of TEXT_FIELDS) {
        for (const { term: candidate, factor } of expansions.get(term) ?? []) {
          if (!indexed.fields[field].has(candidate)) {
            continue;
          }
          best = Math.max(best, FIELD_WEIGHTS[field] * (idf.get(candidate) ?? 0) * factor);
          matchedOn.add(field);
          inTitleOrId ||= field === 'title' || field === 'id';
        }
      }
      if (best > 0) {
        sum += best;
        matchedTerms++;
      }
      allInTitleOrId &&= inTitleOrId;
    }
    strong ||= allInTitleOrId;
    queryScores.push(sum * (matchedTerms / terms.length));
  }

  const queryScore = combineQueryScores(queryScores);
  const page = pageUrl === undefined ? null : scorePage(indexed, pageUrl, platform);
  if (queries.length > 0 && queryScore <= 0) {
    return null;
  }
  if (queries.length === 0 && page === null) {
    return null;
  }
  if (page !== null) {
    matchedOn.add('page');
    strong ||= page.targeted;
  }
  return { indexed, score: queryScore + (page?.score ?? 0), strong, matchedOn };
}

function combineQueryScores(scores: number[]): number {
  if (scores.length === 0) {
    return 0;
  }
  const max = Math.max(...scores);
  const rest = scores.reduce((total, s) => total + s, 0) - max;
  return max + EXTRA_QUERY_WEIGHT * rest;
}

function scorePage(
  indexed: IndexedEntry,
  pageUrl: string,
  platform: SearchPlatform | undefined
): { score: number; targeted: boolean } | null {
  const targetedLength = indexed.targeting ? pageMatchLength(indexed.targeting, pageUrl, platform) : -1;
  if (targetedLength >= 0) {
    return { score: PAGE_TARGETING_SCORE + specificity(targetedLength), targeted: true };
  }
  const start = indexed.startingLocation;
  if (start !== undefined && pageUrl.startsWith(start)) {
    return { score: PAGE_STARTING_LOCATION_SCORE + specificity(start.length), targeted: false };
  }
  return null;
}

function specificity(length: number): number {
  return (PAGE_SPECIFICITY_SCORE * Math.min(length, PAGE_SPECIFICITY_LENGTH)) / PAGE_SPECIFICITY_LENGTH;
}

interface Ranked {
  score: number;
  result: GuideSearchResult;
}

function collectGuides(
  index: GuideSearchIndex,
  scored: Scored[],
  passesCategory: (indexed: IndexedEntry) => boolean
): Ranked[] {
  return scored
    .filter((s) => s.indexed.kind === 'guide' && passesCategory(s.indexed))
    .map((s) => {
      const parent = index.parents.get(s.indexed.entry.id)?.[0];
      const parentEntry = parent ? index.byId.get(parent.pathId)?.entry : undefined;
      return {
        score: s.score,
        result: {
          ...baseResult(s.indexed, s.strong, s.matchedOn),
          ...(parent && parentEntry
            ? { partOf: { id: parentEntry.id, title: parentEntry.title, step: parent.step, of: parent.of } }
            : {}),
        },
      };
    });
}

interface PathGroup {
  self?: Scored;
  steps: Array<{ scored: Scored; step: number }>;
}

function collectGrouped(
  index: GuideSearchIndex,
  scored: Scored[],
  isEligible: (indexed: IndexedEntry | undefined) => indexed is IndexedEntry,
  passesCategory: (indexed: IndexedEntry) => boolean,
  pathsOnly: boolean
): Ranked[] {
  const groups = new Map<string, PathGroup>();
  const group = (pathId: string): PathGroup => {
    const existing = groups.get(pathId);
    if (existing) {
      return existing;
    }
    const created: PathGroup = { steps: [] };
    groups.set(pathId, created);
    return created;
  };
  const ranked: Ranked[] = [];

  for (const s of scored) {
    if (s.indexed.kind === 'path') {
      group(s.indexed.entry.id).self = s;
      continue;
    }
    const parents = index.parents.get(s.indexed.entry.id);
    if (parents) {
      for (const parent of parents) {
        if (isEligible(index.byId.get(parent.pathId))) {
          group(parent.pathId).steps.push({ scored: s, step: parent.step });
        }
      }
      continue;
    }
    if (!pathsOnly && passesCategory(s.indexed)) {
      ranked.push({ score: s.score, result: baseResult(s.indexed, s.strong, s.matchedOn) });
    }
  }

  for (const [pathId, { self, steps }] of groups) {
    const pathEntry = index.byId.get(pathId)!;
    const ownMatch = self && passesCategory(pathEntry) ? self : undefined;
    const matchedSteps = steps
      .filter(({ scored: step }) => passesCategory(step.indexed))
      .sort((a, b) => compareScores(a.scored.score, b.scored.score) || a.step - b.step);
    if (!ownMatch && matchedSteps.length === 0) {
      continue;
    }
    const members = [...(ownMatch ? [ownMatch] : []), ...matchedSteps.map(({ scored: step }) => step)];
    const matchedOn = new Set(members.flatMap((m) => [...m.matchedOn]));
    ranked.push({
      score: Math.max(...members.map((m) => m.score)),
      result: {
        ...baseResult(
          pathEntry,
          members.some((m) => m.strong),
          matchedOn
        ),
        stepCount: index.stepCounts.get(pathId) ?? 0,
        ...(matchedSteps.length > 0
          ? {
              matchedSteps: matchedSteps.slice(0, MAX_MATCHED_STEPS).map(({ scored: step, step: ordinal }) => ({
                id: step.indexed.entry.id,
                title: step.indexed.entry.title,
                step: ordinal,
              })),
            }
          : {}),
      },
    });
  }
  return ranked;
}

function baseResult(indexed: IndexedEntry, strong: boolean, matchedOn: Set<MatchField>): GuideSearchResult {
  return {
    entry: indexed.entry,
    type: indexed.kind,
    relevance: strong ? 'strong' : 'partial',
    matchedOn: MATCHED_ON_ORDER.filter((field) => matchedOn.has(field)),
  };
}

function compareRanked(a: Ranked, b: Ranked): number {
  return (
    compareScores(a.score, b.score) ||
    (a.result.type === b.result.type ? 0 : a.result.type === 'path' ? -1 : 1) ||
    compareIds(a.result.entry.id, b.result.entry.id)
  );
}

function compareScores(a: number, b: number): number {
  return Math.abs(a - b) < SCORE_EPSILON ? 0 : b - a;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
