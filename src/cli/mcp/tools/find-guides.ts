/**
 * Contract: mcp-native
 *
 * `pathfinder_find_guides` — ranked search over the public package catalog for
 * agents that want to suggest a guide to a user. Read-only and stateless; the
 * ranking lives in `lib/guide-search/` so it can be tested without a transport.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { fetchRepositoryIndex, type RepositoryPackage } from '../../utils/repository-client';
import { renderMachineJson } from '../../utils/output';
import { buildLaunchLink } from '../lib/launch-link';
import {
  buildGuideSearchIndex,
  searchGuides,
  type CatalogEntry,
  type GuideSearchIndex,
  type GuideSearchResult,
} from '../lib/guide-search/search';
import { MAX_REGEX_INPUT_LENGTH } from '../lib/guide-search/bounded-regex';
import { readOnly } from './annotations';
import { repositoryErrorResult } from './repository-tools';
import { textResult, type ToolResult } from './result';

const FindGuidesInputSchema = z
  .object({
    queries: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(6)
      .optional()
      .describe(
        "1-6 short searches. Include the user's own words AND the Grafana product names, features, or data sources they imply " +
          '(e.g. "log bill too high" → "adaptive logs", "log volume", "log cost").'
      ),
    pageUrl: z
      .string()
      .min(1)
      .max(MAX_REGEX_INPUT_LENGTH)
      .optional()
      .describe(
        'Path of the Grafana page the user is on (e.g. "/a/grafana-adaptivelogs-app/overview"), without origin. ' +
          'Boosts guides written for this page. With no queries, returns what is relevant to this page.'
      ),
    categories: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Only these categories. Unknown values return an error that lists the valid ones.'),
    type: z
      .enum(['guide', 'path'])
      .optional()
      .describe('"path" returns multi-step learning paths only; "guide" returns single guides and path steps.'),
    platform: z.enum(['cloud', 'oss']).optional().describe('Hide guides that do not apply to this platform.'),
    excludeIds: z
      .array(z.string())
      .max(50)
      .optional()
      .describe('Ids already shown to the user, for "anything else?" follow-ups.'),
    limit: z.number().int().min(1).max(15).default(5),
    instanceUrl: z
      .url({ protocol: /^https?$/ })
      .optional()
      .describe(
        "The user's Grafana instance origin. Pass only if you actually know it; adds an absolute launchUrl to each result."
      ),
  })
  .refine((args) => (args.queries?.length ?? 0) > 0 || args.pageUrl !== undefined, {
    message: 'Pass queries, pageUrl, or both.',
  });

type FindGuidesInput = z.infer<typeof FindGuidesInputSchema>;

const DESCRIPTION =
  'Use this tool to find interactive Grafana guides and learning paths that walk the user through a task inside their Grafana instance. ' +
  'Call this whenever the user asks how to set up, configure, learn, or do something in Grafana, or asks whether help or a ' +
  "tutorial exists for a topic, even if they did not ask for a guide. Pass several `queries` that mix the user's words with " +
  'the Grafana product names they imply, and pass `pageUrl` when you know the current page. Offer at most 1-3 results as ' +
  'Markdown links using `launchPath` (or `launchUrl`). If `noStrongMatch` is true, say no guide covers this rather than ' +
  'listing weak matches.';

export function registerFindGuides(server: McpServer): void {
  server.registerTool(
    'pathfinder_find_guides',
    {
      description: DESCRIPTION,
      annotations: readOnly('Find Pathfinder guides', /* openWorld */ true),
      inputSchema: FindGuidesInputSchema,
    },
    async (args) => handleFindGuides(args)
  );
}

async function handleFindGuides(args: FindGuidesInput): Promise<ToolResult> {
  const catalog = await fetchRepositoryIndex();
  if (!catalog.ok) {
    return repositoryErrorResult(catalog);
  }
  const index = searchIndexFor(catalog.baseUrl, catalog.catalogVersion ?? catalog, catalog.packages);
  const outcome = searchGuides(index, {
    queries: args.queries,
    pageUrl: args.pageUrl,
    categories: args.categories,
    type: args.type,
    platform: args.platform,
    excludeIds: args.excludeIds,
    limit: args.limit,
  });
  if (!outcome.ok) {
    return textResult(
      renderMachineJson({
        status: 'error',
        code: outcome.code,
        message: `Unknown categories: ${outcome.unknown.join(', ')}. Valid categories: ${outcome.categories.join(', ')}.`,
        categories: outcome.categories,
      }),
      true
    );
  }

  const results = outcome.results.map((result) => renderResult(result, index, catalog.baseUrl, args.instanceUrl));
  return textResult(
    renderMachineJson({
      results,
      totalMatches: outcome.totalMatches,
      noStrongMatch: outcome.noStrongMatch,
      ...(results.length === 0 ? { categories: index.categories } : {}),
      ...(catalog.catalogVersion ? { catalogVersion: catalog.catalogVersion } : {}),
    })
  );
}

function renderResult(
  result: GuideSearchResult,
  index: GuideSearchIndex,
  baseUrl: string,
  instanceUrl?: string
): Record<string, unknown> {
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
  });
}

function omitEmpty(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([, value]) => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0)
    )
  );
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
