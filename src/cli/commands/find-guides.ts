/**
 * Find guides command
 *
 * Ranked search over the public package catalog. One schema and one runner
 * serve both surfaces: `pathfinder-cli find-guides` renders the outcome for a
 * person (or as JSON with `--format json`), and the `pathfinder_find_guides` MCP
 * tool returns the outcome's `data` verbatim.
 */

import { z } from 'zod';

import { defineCommand } from '../contracts';
import type { CommandOutcome } from '../utils/output';
import { fetchRepositoryIndex, type RepositoryPackage } from '../utils/repository-client';
import { buildLaunchLink } from '../utils/launch-link';
import { MAX_REGEX_INPUT_LENGTH } from '../utils/guide-search/bounded-regex';
import {
  buildGuideSearchIndex,
  searchGuides,
  type CatalogEntry,
  type GuideSearchIndex,
  type GuideSearchResult,
} from '../utils/guide-search/search';

export const FindGuidesCommand = z
  .object({
    queries: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(6)
      .optional()
      .describe(
        "1-6 short searches. Include the user's own words AND the Grafana product names, features, or data sources they imply " +
          '(e.g. "log bill too high" → "adaptive logs", "log volume", "log cost").'
      )
      .meta({ role: 'addressing' }),
    pageUrl: z
      .string()
      .min(1)
      .max(MAX_REGEX_INPUT_LENGTH)
      .optional()
      .describe(
        'Path of the Grafana page the user is on (e.g. "/a/grafana-adaptivelogs-app/overview"), without origin. ' +
          'Boosts guides written for this page. With no queries, returns what is relevant to this page.'
      )
      .meta({ role: 'addressing' }),
    categories: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Only these categories. Unknown values return an error that lists the valid ones.')
      .meta({ role: 'control' }),
    type: z
      .enum(['guide', 'path'])
      .optional()
      .describe('"path" returns multi-step learning paths only; "guide" returns single guides and path steps.')
      .meta({ role: 'control' }),
    platform: z
      .enum(['cloud', 'oss'])
      .optional()
      .describe('Hide guides that do not apply to this platform.')
      .meta({ role: 'control' }),
    excludeIds: z
      .array(z.string())
      .max(50)
      .optional()
      .describe('Ids already shown to the user, for "anything else?" follow-ups.')
      .meta({ role: 'control' }),
    limit: z.number().int().min(1).max(15).default(5).describe('Maximum results to return.').meta({ role: 'control' }),
    instanceUrl: z
      .url({ protocol: /^https?$/ })
      .optional()
      .describe(
        "The user's Grafana instance origin. Pass only if you actually know it; adds an absolute launchUrl to each result."
      )
      .meta({ role: 'control' }),
  })
  .refine((args) => (args.queries?.length ?? 0) > 0 || args.pageUrl !== undefined, {
    message: 'Pass queries, pageUrl, or both.',
  });

export type FindGuidesInput = z.output<typeof FindGuidesCommand>;

export async function runFindGuides(input: FindGuidesInput): Promise<CommandOutcome> {
  const catalog = await fetchRepositoryIndex();
  if (!catalog.ok) {
    return {
      status: 'error',
      code: catalog.code,
      message: catalog.message,
      ...(catalog.code === 'HTTP_ERROR' ? { data: { httpStatus: catalog.status } } : {}),
    };
  }
  const index = searchIndexFor(catalog.baseUrl, catalog.catalogVersion ?? catalog, catalog.packages);
  const outcome = searchGuides(index, {
    queries: input.queries,
    pageUrl: input.pageUrl,
    categories: input.categories,
    type: input.type,
    platform: input.platform,
    excludeIds: input.excludeIds,
    limit: input.limit,
  });
  if (!outcome.ok) {
    return {
      status: 'error',
      code: outcome.code,
      message: `Unknown categories: ${outcome.unknown.join(', ')}. Valid categories: ${outcome.categories.join(', ')}.`,
      data: { categories: outcome.categories },
    };
  }

  const results = outcome.results.map((result) => renderResult(result, index, catalog.baseUrl, input.instanceUrl));
  const data = {
    results,
    totalMatches: outcome.totalMatches,
    noStrongMatch: outcome.noStrongMatch,
    ...(results.length === 0 ? { categories: index.categories } : {}),
    ...(catalog.catalogVersion ? { catalogVersion: catalog.catalogVersion } : {}),
  };
  return {
    status: 'ok',
    summary: summarize(results.length, outcome.totalMatches, outcome.noStrongMatch),
    ...(results.length > 0 ? { text: results.map(formatResult).join('\n\n') } : {}),
    ...(results.length === 0 ? { hints: [`Valid categories: ${index.categories.join(', ')}`] } : {}),
    data,
  };
}

type RenderedResult = Record<string, unknown> & {
  id: string;
  type: string;
  relevance: string;
  matchedOn: string[];
};

function renderResult(
  result: GuideSearchResult,
  index: GuideSearchIndex,
  baseUrl: string,
  instanceUrl?: string
): RenderedResult {
  const { entry } = result;
  const linkEntry = (result.partOf && index.byId.get(result.partOf.id)?.entry) ?? entry;
  const link = buildLaunchLink({ baseUrl, entryPath: linkEntry.path, type: linkEntry.type, instanceUrl });
  return omitEmpty({
    id: entry.id,
    type: result.type,
    title: entry.title,
    description: entry.description,
    category: entry.category,
    relevance: result.relevance,
    matchedOn: result.matchedOn,
    startsIn: linkEntry.startingLocation,
    launchPath: link?.launchPath,
    launchUrl: link?.launchUrl,
    stepCount: result.stepCount,
    matchedSteps: result.matchedSteps,
    partOf: result.partOf,
  }) as RenderedResult;
}

function omitEmpty(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)
    )
  );
}

function summarize(shown: number, total: number, noStrongMatch: boolean): string {
  if (shown === 0) {
    return 'No guides found';
  }
  const count = shown === total ? `${total}` : `${shown} of ${total}`;
  return `Found ${count} ${total === 1 ? 'guide' : 'guides'}${noStrongMatch ? ' (no strong match)' : ''}`;
}

function formatResult(result: RenderedResult, position: number): string {
  const lines = [`${position + 1}. ${String(result.title ?? result.id).trim()} [${result.type}, ${result.relevance}]`];
  lines.push(`   id: ${result.id}${result.category ? `  category: ${String(result.category)}` : ''}`);
  lines.push(`   matched on: ${result.matchedOn.join(', ')}`);
  if (result.startsIn) {
    lines.push(`   starts in: ${String(result.startsIn)}`);
  }
  const partOf = result.partOf as GuideSearchResult['partOf'];
  if (partOf) {
    lines.push(`   step ${partOf.step} of ${partOf.of} in ${partOf.title ?? partOf.id}`);
  }
  const steps = result.matchedSteps as GuideSearchResult['matchedSteps'];
  for (const step of steps ?? []) {
    lines.push(`   step ${step.step}: ${step.title ?? step.id}`);
  }
  const link = result.launchUrl ?? result.launchPath;
  if (link) {
    lines.push(`   open: ${String(link)}`);
  }
  return lines.join('\n');
}

const searchIndexCache = new Map<string, { identity: unknown; index: GuideSearchIndex }>();

/** Rebuilds only when the catalog identity (its version, else the fetched object) changes. */
function searchIndexFor(baseUrl: string, identity: unknown, packages: RepositoryPackage[]): GuideSearchIndex {
  const cached = searchIndexCache.get(baseUrl);
  if (cached && cached.identity === identity) {
    return cached.index;
  }
  const index = buildGuideSearchIndex(packages as CatalogEntry[]);
  searchIndexCache.set(baseUrl, { identity, index });
  return index;
}

export function __resetFindGuidesForTests(): void {
  searchIndexCache.clear();
}

export const findGuidesSpec = defineCommand({
  name: 'find-guides',
  summary: 'Search the public guide catalog for guides and learning paths',
  schema: FindGuidesCommand,
  run: runFindGuides,
});
