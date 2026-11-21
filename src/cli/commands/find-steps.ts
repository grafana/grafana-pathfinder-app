/**
 * Find steps command
 *
 * Search over step-by-step procedures taken from guides the live e2e suite
 * currently passes. One schema and one runner serve both surfaces:
 * `pathfinder-cli find-steps` renders the outcome for a person, and the
 * `pathfinder_find_steps` MCP tool returns the outcome's `data` verbatim.
 */

import { z } from 'zod';

import { defineCommand } from '../contracts';
import type { CommandOutcome } from '../utils/output';
import { MAX_REGEX_INPUT_LENGTH } from '../utils/guide-search/bounded-regex';
import { normalizeTerms } from '../utils/guide-search/terms';
import { searchSteps } from '../utils/step-index';
import { getStepIndex, type StepIndexSnapshot } from '../utils/step-index/cache';
import type { Procedure, Step } from '../utils/step-index/segment';

const MAX_FETCH = 8;

const WEAK_HINT =
  "No strong match. Reword once with the words Grafana's UI uses; if still weak, use placeholders only for steps you know.";

export const FindStepsCommand = z
  .object({
    queries: z
      .array(z.string().min(1).max(120))
      .min(1)
      .max(8)
      .optional()
      .describe(
        'One phrase of 2-5 words per sub-task, each searched and returned separately (e.g. "create dashboard", "configure loki data source", "merge query results").'
      )
      .meta({ role: 'addressing' }),
    pageUrl: z
      .string()
      .min(1)
      .max(MAX_REGEX_INPUT_LENGTH)
      .optional()
      .describe(
        "Page the sub-task starts on, without origin (e.g. the previous result's endsOn). Boosts procedures that run on or start on it."
      )
      .meta({ role: 'addressing' }),
    procedureId: z
      .union([z.string().min(1).max(300), z.array(z.string().min(1).max(300)).min(1).max(MAX_FETCH)])
      .optional()
      .describe(
        'Fetch these procedures in one call (1-8 ids, repeat the flag), e.g. the parts named by `nextProcedure`/`previousProcedure` or an outline. Use instead of queries. An id is valid only within the index build that returned it (see stats.healthRevision and stats.builtAt).'
      )
      .meta({ role: 'addressing' }),
    excludeIds: z
      .array(z.string())
      .max(50)
      .optional()
      .describe('Procedure ids already seen, for "anything else?" follow-ups.')
      .meta({ role: 'control' }),
    limit: z.number().int().min(1).max(5).default(2).describe('Results per query.').meta({ role: 'control' }),
  })
  .refine((args) => [args.queries, args.procedureId].filter((arg) => arg !== undefined).length === 1, {
    message: 'Pass exactly one of queries or procedureId.',
  });

export type FindStepsInput = z.output<typeof FindStepsCommand>;

export async function runFindSteps(input: FindStepsInput): Promise<CommandOutcome> {
  const loaded = await getStepIndex();
  if (!loaded.ok) {
    return {
      status: 'error',
      code: loaded.code,
      message: `Cannot build the verified procedure index: ${loaded.message}`,
      ...(loaded.code === 'HTTP_ERROR' ? { data: { httpStatus: loaded.status } } : {}),
    };
  }
  const { snapshot } = loaded;

  if (input.procedureId !== undefined) {
    const ids = [input.procedureId].flat();
    const notFound = ids.filter((id) => !snapshot.procedures.has(id));
    const procedures = ids.flatMap((id) => snapshot.procedures.get(id) ?? []);
    if (procedures.length === 0) {
      return {
        status: 'error',
        code: 'NOT_FOUND',
        message: `${ids.length === 1 ? 'Procedure' : 'Procedures'} ${ids.map((id) => `"${id}"`).join(', ')} ${ids.length === 1 ? 'is' : 'are'} not in the index.`,
      };
    }
    const outlined = new Set<unknown>();
    const results = procedures.map((procedure) => {
      const result = renderFetched(snapshot, procedure);
      const key = pathRun(snapshot, procedure).path ?? procedure.guideId;
      if (outlined.has(key)) {
        return { ...result, outline: undefined };
      }
      outlined.add(key);
      return result;
    });
    const fetched = new Set(procedures.map((procedure) => procedure.id));
    const upcoming = [
      ...new Set(
        results.flatMap((result) => {
          const parts = result.outline?.parts ?? [];
          const last = parts.reduce(
            (at, part, index) => ('procedureId' in part && fetched.has(part.procedureId) ? index : at),
            -1
          );
          return last < 0
            ? []
            : parts.slice(last + 1).flatMap((part) => ('procedureId' in part ? part.procedureId : []));
        })
      ),
    ];
    const hint =
      upcoming.length > 0
        ? `Adjacent parts: { "opts": { "procedureId": ${JSON.stringify(upcoming.slice(0, MAX_FETCH))} } }`
        : undefined;
    return {
      status: 'ok',
      summary: `Found ${procedures.length} ${procedures.length === 1 ? 'procedure' : 'procedures'}`,
      text: [
        ...results.map(formatResult),
        ...(notFound.length > 0 ? [`Not in the index: ${notFound.join(', ')}`] : []),
        ...(hint ? [hint] : []),
      ].join('\n\n'),
      data: {
        results,
        noStrongMatch: false,
        ...(notFound.length > 0 ? { notFound } : {}),
        ...(hint ? { hint } : {}),
        stats: snapshot.stats,
      },
    };
  }

  const renderedFull = new Map<string, number>();
  const groups = searchSteps(snapshot, {
    queries: input.queries ?? [],
    pageUrl: input.pageUrl,
    excludeIds: input.excludeIds,
    limit: input.limit,
  }).map(({ query, noStrongMatch, absentWords, hits }, groupIndex) => {
    const results = hits.map(({ procedure, matchedSteps }, i) => {
      const earlier = renderedFull.get(procedure.id);
      if (i === 0 && earlier === undefined) {
        renderedFull.set(procedure.id, groupIndex);
        return renderFull(snapshot, procedure, matchedSteps);
      }
      return { ...renderSummary(procedure, matchedSteps), ...(earlier === undefined ? {} : { fullIn: earlier }) };
    });
    const generic = query.split(/\s+/).filter((word) => normalizeTerms(word).length > 0 && !absentWords.includes(word));
    const hint = !noStrongMatch
      ? undefined
      : absentWords.length > 0 && generic.length > 0
        ? `No verified steps mention ${absentWords.map((word) => `"${word}"`).join(', ')}. Search the Grafana process in generic terms: { "opts": { "queries": [${JSON.stringify(generic.join(' '))}] } }. Use placeholders only for the product-specific fields.`
        : WEAK_HINT;
    return { query, noStrongMatch, ...(hint ? { hint } : {}), results };
  });

  const found = groups.reduce((sum, g) => sum + g.results.length, 0);
  const weak = groups.filter((g) => g.noStrongMatch).length;
  return {
    status: 'ok',
    summary:
      found === 0
        ? 'No procedures found'
        : `Found ${found} ${found === 1 ? 'procedure' : 'procedures'} for ${groups.length} ${groups.length === 1 ? 'query' : 'queries'}${weak > 0 ? ` (${weak} weak)` : ''}`,
    ...(found > 0
      ? {
          text: groups
            .map(
              (g) =>
                `"${g.query}"${g.noStrongMatch ? ' (no strong match)' : ''}\n${g.hint ? `   ${g.hint}\n` : ''}${g.results.length > 0 ? g.results.map(formatResult).join('\n\n') : '   no procedures'}`
            )
            .join('\n\n'),
        }
      : {}),
    data: { groups, stats: snapshot.stats },
  };
}

function renderLeanSteps(steps: Step[]) {
  return steps.map(({ n, action, selector, value, text, page, requirements }, i) => {
    const kept = requirements?.filter((entry) => entry !== 'exists-reftarget' && entry !== `on-page:${page}`);
    return {
      n,
      action,
      selector,
      value,
      text,
      ...(page && page !== steps[i - 1]?.page ? { page } : {}),
      ...(kept?.length ? { requirements: kept } : {}),
    };
  });
}

function renderSteps(steps: Step[]) {
  return steps.map(({ page, group, ...step }, i) => ({
    ...step,
    ...(page && page !== steps[i - 1]?.page ? { page } : {}),
    ...(group && group !== steps[i - 1]?.group && group !== step.text ? { group } : {}),
  }));
}

type OutlinePart =
  { procedureId: string; title: string; current?: true } | { guide: string; unverified: true } | { more: number };

const MAX_OUTLINE_PARTS = 30;

function pathRun(snapshot: StepIndexSnapshot, procedure: Procedure) {
  const proceduresOf = (guideId: string) => [...snapshot.procedures.values()].filter((p) => p.guideId === guideId);
  const path = snapshot.paths.find((candidate) => candidate.milestones.includes(procedure.guideId));
  const entries: Array<Procedure | string> = path
    ? path.milestones.flatMap((guideId): Array<Procedure | string> => {
        const indexed = proceduresOf(guideId);
        return indexed.length > 0 ? indexed : [guideId];
      })
    : proceduresOf(procedure.guideId);
  return { path, title: path?.title ?? procedure.guideTitle, entries };
}

function listParts(snapshot: StepIndexSnapshot, procedure: Procedure) {
  const { path, title, entries } = pathRun(snapshot, procedure);
  if (!path && entries.length < 2) {
    return undefined;
  }
  return {
    title,
    parts: entries.map((entry): OutlinePart => {
      if (typeof entry === 'string') {
        return { guide: entry, unverified: true };
      }
      return {
        procedureId: entry.id,
        title: entry.crumbs.join(' > '),
        ...(entry.id === procedure.id ? { current: true as const } : {}),
      };
    }),
  };
}

export function buildOutline(snapshot: StepIndexSnapshot, procedure: Procedure) {
  const listed = listParts(snapshot, procedure);
  if (!listed) {
    return undefined;
  }
  const { title, parts } = listed;
  const position = parts.findIndex((part) => 'current' in part) + 1;
  if (parts.length <= MAX_OUTLINE_PARTS) {
    return { title, position, total: parts.length, parts };
  }
  const start = Math.min(Math.max(position - 1 - MAX_OUTLINE_PARTS / 2, 0), parts.length - MAX_OUTLINE_PARTS);
  return {
    title,
    position,
    total: parts.length,
    parts: [...parts.slice(start, start + MAX_OUTLINE_PARTS), { more: parts.length - MAX_OUTLINE_PARTS }],
  };
}

type Neighbour = { procedureId: string; title: string } | { guide: string; unverified: true };

export function buildContext(snapshot: StepIndexSnapshot, procedure: Procedure) {
  const listed = listParts(snapshot, procedure);
  if (!listed) {
    return undefined;
  }
  const { title, parts } = listed;
  const index = parts.findIndex((part) => 'current' in part);
  const neighbour = (part: OutlinePart | undefined): Neighbour | undefined =>
    part && 'procedureId' in part
      ? { procedureId: part.procedureId, title: part.title }
      : (part as Neighbour | undefined);
  const previousProcedure = neighbour(parts[index - 1]);
  const nextProcedure = neighbour(parts[index + 1]);
  return {
    path: title,
    position: index + 1,
    total: parts.length,
    ...(previousProcedure ? { previousProcedure } : {}),
    ...(nextProcedure ? { nextProcedure } : {}),
  };
}

const WINDOW_THRESHOLD = 15;
const WINDOW_RADIUS = 3;

function renderFetched(snapshot: StepIndexSnapshot, procedure: Procedure) {
  return {
    procedureId: procedure.id,
    guideTitle: procedure.guideTitle,
    crumbs: procedure.crumbs,
    leadIn: procedure.leadIn,
    outro: procedure.outro,
    startsOn: procedure.startsOn,
    endsOn: procedure.endsOn,
    navigation: procedure.navigation,
    matchedSteps: [] as number[],
    prevId: procedure.prevId,
    nextId: procedure.nextId,
    steps: renderSteps(procedure.steps),
    outline: buildOutline(snapshot, procedure),
  };
}

function renderFull(snapshot: StepIndexSnapshot, procedure: Procedure, matchedSteps: number[]) {
  const windowed =
    procedure.steps.length > WINDOW_THRESHOLD
      ? procedure.steps.filter(
          (step) =>
            step.n <= procedure.navigation ||
            matchedSteps.some((matched) => Math.abs(matched - step.n) <= WINDOW_RADIUS)
        )
      : procedure.steps;
  const shown = windowed.some((step) => step.n > procedure.navigation)
    ? windowed
    : procedure.steps.filter((step) => step.n <= procedure.navigation + 2 * WINDOW_RADIUS + 1);
  const omitted: Array<[number, number]> = [];
  let previous = 0;
  for (const { n } of [...shown, { n: procedure.steps.length + 1 }]) {
    if (n - previous > 1) {
      omitted.push([previous + 1, n - 1]);
    }
    previous = n;
  }
  const context = buildContext(snapshot, procedure);
  return {
    procedureId: procedure.id,
    crumbs: procedure.crumbs,
    endsOn: procedure.endsOn,
    navigation: procedure.navigation,
    ...(shown.every((step) => matchedSteps.includes(step.n)) ? {} : { matchedSteps }),
    steps: renderLeanSteps(shown),
    ...(omitted.length > 0 ? { omitted, stepCount: procedure.steps.length } : {}),
    ...(context ? { context } : {}),
  };
}

function renderSummary(procedure: Procedure, matchedSteps: number[]) {
  return {
    procedureId: procedure.id,
    crumbs: procedure.crumbs,
    endsOn: procedure.endsOn,
    stepCount: procedure.steps.length,
    matchedSteps,
  };
}

function stepLine(step: Pick<Step, 'n' | 'action' | 'selector' | 'value' | 'text' | 'page'>): string {
  const target = [step.selector, step.value === undefined ? undefined : `= ${step.value}`].filter(Boolean).join(' ');
  return `${step.n}. ${step.action} ${target} - ${step.text}${step.page ? ` [${step.page}]` : ''}`;
}

function formatResult(result: Record<string, unknown>, position: number): string {
  const steps = (result.steps ?? []) as ReturnType<typeof renderSteps>;
  const matched = new Set((result.matchedSteps ?? []) as number[]);
  const lines = [`${position + 1}. ${(result.crumbs as string[]).join(' > ')}`, `   id: ${String(result.procedureId)}`];
  if (result.startsOn || result.endsOn) {
    lines.push(
      `   ${result.startsOn ? `starts on: ${String(result.startsOn)}  ` : ''}ends on: ${String(result.endsOn ?? '?')}`
    );
  }
  if (result.fullIn !== undefined) {
    lines.push(`   steps shown in query ${Number(result.fullIn) + 1} above`);
  }
  if (result.stepCount !== undefined && !result.steps) {
    lines.push(
      `   ${String(result.stepCount)} steps; matched: ${(result.matchedSteps as number[]).join(', ') || 'none'}`
    );
  } else if (result.navigation) {
    lines.push(`   first ${String(result.navigation)} steps only navigate`);
  }
  const omitted = (result.omitted ?? []) as Array<[number, number]>;
  const pendingGaps = [...omitted];
  for (const step of steps) {
    while (pendingGaps.length > 0 && pendingGaps[0]![0] < step.n) {
      const [from, to] = pendingGaps.shift()!;
      lines.push(`   ... steps ${from}-${to} omitted (fetch procedureId for all)`);
    }
    if (step.group) {
      lines.push(`   [${step.group}]`);
    }
    lines.push(`   ${matched.has(step.n) ? '*' : ' '}${stepLine(step)}`);
  }
  for (const [from, to] of pendingGaps) {
    lines.push(`   ... steps ${from}-${to} omitted (fetch procedureId for all)`);
  }
  const context = result.context as ReturnType<typeof buildContext>;
  if (context) {
    const name = (part: Neighbour | undefined) =>
      part && ('guide' in part ? `? ${part.guide} (unverified)` : `${part.title} (${part.procedureId})`);
    lines.push(`   part ${context.position} of ${context.total} in "${context.path}"`);
    if (context.previousProcedure) {
      lines.push(`   previous: ${name(context.previousProcedure)}`);
    }
    if (context.nextProcedure) {
      lines.push(`   next: ${name(context.nextProcedure)}`);
    }
  }
  const outline = result.outline as ReturnType<typeof buildOutline>;
  if (outline) {
    lines.push(`   part ${outline.position} of ${outline.total} in "${outline.title}":`);
    for (const part of outline.parts) {
      if ('more' in part) {
        lines.push(`     ... ${part.more} more`);
      } else if ('guide' in part) {
        lines.push(`   ? ${part.guide} (unverified)`);
      } else {
        lines.push(`   ${part.current ? '>' : ' '} ${part.procedureId}: ${part.title}`);
      }
    }
  }
  for (const [label, id] of [
    ['previous', result.prevId],
    ['next', result.nextId],
  ] as const) {
    if (id) {
      lines.push(`   ${label}: ${String(id)}`);
    }
  }
  return lines.join('\n');
}

export const findStepsSpec = defineCommand({
  name: 'find-steps',
  summary: 'Search verified step-by-step procedures from guides that pass live end-to-end tests',
  schema: FindStepsCommand,
  run: runFindSteps,
});
