/**
 * Search over verified procedures: one MiniSearch document per procedure, with
 * the procedure bodies held beside it so a hit returns the whole ordered run.
 */

import MiniSearch from 'minisearch';

import { normalizeTerms } from '../guide-search/terms';
import type { Procedure, Step } from './segment';

const FIELD_BOOSTS = { title: 3, intent: 2, labels: 1.5, steps: 1, pages: 1 };
const PAGE_MATCH_FACTOR = 1.25;
const START_MATCH_FACTOR = 1.25;
const MIN_PREFIX_LENGTH = 4;
const MIN_FUZZY_LENGTH = 6;
/** Below this best score a result is not worth offering. Calibrated on the prod corpus: unrelated queries top out near 14, real topics start above 50. */
export const STRONG_SCORE = 30;
/** A query whose rarest term appears in more than this share of procedures has no distinctive word, so no term gates the hits. */
const GATE_MAX_DF_SHARE = 0.25;
const GATE_PENALTY = 0.3;
const DENSITY_WEIGHT = 0.3;
const DENSITY_CAP = 4;

interface IndexDoc {
  id: string;
  title: string;
  intent: string;
  labels: string;
  steps: string;
  pages: string;
}

export interface StepSearchIndex {
  search: MiniSearch<IndexDoc>;
  procedures: Map<string, Procedure>;
  documentFrequency: Map<string, number>;
}

export interface StepHit {
  procedure: Procedure;
  score: number;
  matchedSteps: number[];
}

export interface StepSearchRequest {
  queries: string[];
  pageUrl?: string;
  excludeIds?: string[];
  limit: number;
}

export interface StepSearchGroup {
  query: string;
  hits: StepHit[];
  noStrongMatch: boolean;
  /** Words of the query, in order, that occur in no procedure. */
  absentWords: string[];
}

const options = {
  fields: Object.keys(FIELD_BOOSTS),
  idField: 'id',
  processTerm: (term: string) => {
    const terms = normalizeTerms(term);
    return terms.length > 0 ? terms : null;
  },
};

const distinct = (values: Array<string | undefined>) => [...new Set(values.filter((v): v is string => !!v))];

/** Words a selector spells out: Grafana selector token paths and the values of testid, label, name, href and :text(). */
export function selectorWords(selector: string): string {
  const quoted = (name: string) => new RegExp(`(?<![\\w-])${name}\\s*[\\^$*~|]?=\\s*(["'])(.*?)\\1`, 'g');
  const found = [
    ...[...selector.matchAll(/\{grafana:([^}]+)\}/g)].map((m) => m[1]),
    ...['data-testid', 'aria-label', 'name', 'href'].flatMap((name) =>
      [...selector.matchAll(quoted(name))].map((m) => m[2])
    ),
    ...[...selector.matchAll(/:text\((["'])(.*?)\1\)/g)].map((m) => m[2]),
  ];
  return found
    .join(' ')
    .split(/[./\-_:\s]+|(?<=[a-z0-9])(?=[A-Z])/)
    .filter((word) => word.length >= 3)
    .join(' ')
    .toLowerCase();
}

const stepTerms = (step: Step) => new Set(normalizeTerms([step.text, step.value].join(' ')));

function toDocument(procedure: Procedure): IndexDoc {
  return {
    id: procedure.id,
    title: [...procedure.crumbs, ...procedure.pathTitles].join(' '),
    intent: [procedure.leadIn, procedure.outro, ...distinct(procedure.steps.map((s) => s.group))].join(' '),
    labels: [...procedure.labels, ...procedure.steps.map((s) => selectorWords(s.selector ?? ''))].join(' '),
    steps: procedure.steps.map((s) => s.text).join(' '),
    pages: distinct(procedure.steps.map((s) => s.page)).join(' '),
  };
}

export function buildStepIndex(procedures: Procedure[]): StepSearchIndex {
  const search = new MiniSearch<IndexDoc>(options);
  const documents = procedures.map(toDocument);
  search.addAll(documents);
  const tokenize = MiniSearch.getDefault('tokenize') as (text: string) => string[];
  const documentFrequency = new Map<string, number>();
  for (const document of documents) {
    const terms = new Set(
      options.fields.flatMap((field) =>
        tokenize(document[field as keyof IndexDoc]).flatMap((token) => options.processTerm(token) ?? [])
      )
    );
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  return { search, procedures: new Map(procedures.map((p) => [p.id, p])), documentFrequency };
}

const normalizePage = (url: string) => (url.split(/[?#]/)[0] ?? url).replace(/\/+$/, '') || '/';

const pageMatches = (page: string, wanted: string) =>
  page === wanted || page.startsWith(`${wanted}/`) || wanted.startsWith(`${page}/`);

function pageFactor(procedure: Procedure, pageUrl: string | undefined): number {
  if (pageUrl === undefined) {
    return 1;
  }
  const wanted = normalizePage(pageUrl);
  const pages = distinct([...procedure.steps.map((s) => s.page), procedure.startsOn, procedure.endsOn]);
  const onPage = pages.some((page) => pageMatches(normalizePage(page), wanted));
  const startsThere = procedure.startsOn !== undefined && pageMatches(normalizePage(procedure.startsOn), wanted);
  return (onPage ? PAGE_MATCH_FACTOR : 1) * (startsThere ? START_MATCH_FACTOR : 1);
}

/** The rarest query term present in the corpus; undefined when none is, or when even the rarest is common. `absent` means some query term is in no procedure. */
function anchorTerm(index: StepSearchIndex, terms: string[]): { anchor?: string; absent: boolean } {
  const all = terms.map((term) => ({ term, df: index.documentFrequency.get(term) ?? 0 }));
  const counted = all.filter(({ df }) => df > 0);
  const rarest = counted.reduce<(typeof counted)[number] | undefined>(
    (best, c) => (!best || c.df < best.df ? c : best),
    undefined
  );
  if (!rarest) {
    return { absent: true };
  }
  const absent = counted.length < all.length;
  return rarest.df > GATE_MAX_DF_SHARE * index.procedures.size ? { absent } : { anchor: rarest.term, absent };
}

const anchorSteps = (procedure: Procedure, anchor: string) =>
  procedure.steps.filter((s) =>
    normalizeTerms([s.text, s.value, selectorWords(s.selector ?? '')].join(' ')).includes(anchor)
  ).length;

function searchQuery(index: StepSearchIndex, query: string, request: StepSearchRequest): StepSearchGroup {
  const excluded = new Set(request.excludeIds ?? []);
  const { anchor, absent } = anchorTerm(index, normalizeTerms(query));
  const absentWords = query.split(/\s+/).filter((word) => {
    const terms = normalizeTerms(word);
    return terms.length > 0 && terms.every((term) => !index.documentFrequency.has(term));
  });
  const results = index.search.search(query, {
    boost: FIELD_BOOSTS,
    combineWith: 'OR',
    prefix: (term) => term.length >= MIN_PREFIX_LENGTH,
    fuzzy: (term) => (term.length >= MIN_FUZZY_LENGTH ? 0.15 : false),
    filter: (result) => !excluded.has(result.id),
  });

  const ranked = results
    .map((result) => {
      const procedure = index.procedures.get(result.id)!;
      const passes = anchor === undefined || result.queryTerms.includes(anchor);
      const gate = passes
        ? 1 +
          (DENSITY_WEIGHT * Math.min(anchor === undefined ? 0 : anchorSteps(procedure, anchor), DENSITY_CAP)) /
            DENSITY_CAP
        : GATE_PENALTY;
      const terms = new Set(
        Object.entries(result.match)
          .filter(([, fields]) => fields.some((field) => field === 'labels' || field === 'steps'))
          .map(([term]) => term)
      );
      return { procedure, passes, terms, score: result.score * gate * pageFactor(procedure, request.pageUrl) };
    })
    .sort((a, b) => b.score - a.score || a.procedure.id.localeCompare(b.procedure.id));

  const top = ranked[0];
  return {
    query,
    absentWords,
    noStrongMatch: absent || !top || !top.passes || top.score < STRONG_SCORE,
    hits: ranked.slice(0, request.limit).map(({ procedure, score, terms }) => ({
      procedure,
      score,
      matchedSteps: procedure.steps.filter((s) => [...stepTerms(s)].some((t) => terms.has(t))).map((s) => s.n),
    })),
  };
}

export const searchSteps = (index: StepSearchIndex, request: StepSearchRequest): StepSearchGroup[] =>
  request.queries.map((query) => searchQuery(index, query, request));
