/**
 * Pre-parse for the verified procedure index: turns a guide's blocks into
 * procedures, each an ordered run of action steps with the prose around it.
 * Pure, no I/O.
 */

import type { JsonBlock, JsonInteractiveBlock, JsonStep } from '../../../types/json-guide.types';

export interface Step {
  n: number;
  action: string;
  selector?: string;
  value?: string;
  text: string;
  group?: string;
  page?: string;
  requirements?: string[];
}

export interface Procedure {
  id: string;
  guideId: string;
  guideTitle: string;
  pathTitles: string[];
  crumbs: string[];
  leadIn: string;
  outro: string;
  steps: Step[];
  startsOn?: string;
  endsOn?: string;
  navigation: number;
  prevId?: string;
  nextId?: string;
  /** Bold and backtick phrases of the step texts, captured before markdown is stripped. */
  labels: string[];
}

export interface SegmentInput {
  id: string;
  title: string;
  pathTitles: string[];
  blocks: JsonBlock[];
}

const MAX_STEPS = 25;
const MAX_STEP_TEXT = 240;
const MAX_GROUP = 160;
const MAX_LEAD_IN = 400;
const MAX_OUTRO = 300;
const NAV_SELECTOR = /data-testid="data-testid Nav menu item"|\{grafana:components\.NavMenu\./;
const HREF_VALUE = /href\s*[\^$*~|]?=\s*["']([^"']+)["']/;

type Event =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'step'; step: Omit<Step, 'n'>; labels: string[] }
  | { kind: 'open'; title: string }
  | { kind: 'close' };

interface Draft {
  crumbs: string[];
  steps: Step[];
  pages: Array<string | undefined>;
  labels: string[][];
  pending: string[];
  leadIn: string;
  outro: string;
}

const cap = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

const plain = (markdown: string) =>
  markdown
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const pathOf = (url: string) => url.split(/[?#]/)[0] ?? url;

const isNavigation = (step: Omit<Step, 'n'>) =>
  step.action === 'navigate' ||
  ((step.action === 'highlight' || step.action === 'button') &&
    (NAV_SELECTOR.test(step.selector ?? '') || (step.requirements ?? []).includes('navmenu-open')));

function splitMarkdown(content: string, out: Event[]): void {
  let fenced = false;
  let text: string[] = [];
  const flush = () => {
    const joined = plain(text.join('\n'));
    if (joined) {
      out.push({ kind: 'text', text: joined });
    }
    text = [];
  };
  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
    }
    const heading = fenced ? null : /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ kind: 'heading', level: heading[1]!.length, text: plain(heading[2]!) });
    } else {
      text.push(line);
    }
  }
  flush();
}

type CodeBlockSource = {
  action: 'code-block';
  reftarget: string;
  refTarget?: undefined;
  targetvalue?: undefined;
  targetValue?: undefined;
};

function toStep(
  source: JsonStep | JsonInteractiveBlock | CodeBlockSource,
  authored: Array<string | undefined>,
  group: string | undefined,
  requirements: string[]
): Event {
  const action = ('targetAction' in source && source.targetAction) || source.action;
  const selector = source.reftarget ?? source.refTarget;
  const value = source.targetvalue ?? source.targetValue;
  const onPage = requirements
    .filter((r) => r.startsWith('on-page:'))
    .pop()
    ?.slice('on-page:'.length);
  const navigatesTo = action === 'navigate' && selector?.startsWith('/') ? pathOf(selector) : undefined;
  const page = navigatesTo ?? (onPage ? pathOf(onPage) : undefined);
  const text =
    authored.find((candidate) => plain(candidate ?? '')) ??
    (action === 'button' && selector ? `Click ${selector}` : (group ?? ''));
  const labels = [...text.matchAll(/\*\*(.+?)\*\*|`([^`]+)`/g)].map((m) => m[1] ?? m[2] ?? '');
  return {
    kind: 'step',
    labels,
    step: {
      action,
      ...(selector ? { selector } : {}),
      ...(value ? { value } : {}),
      text: cap(plain(text), MAX_STEP_TEXT),
      ...(group ? { group } : {}),
      ...(page ? { page } : {}),
      ...(requirements.length > 0 ? { requirements } : {}),
    },
  };
}

const blockRequirements = (block: JsonBlock): string[] => [
  ...('requirements' in block ? (block.requirements ?? []) : []),
  ...(block.type === 'conditional' ? block.conditions : []),
];

function flatten(blocks: JsonBlock[], conditions: string[], out: Event[]): void {
  for (const block of blocks) {
    const inherited = [...conditions, ...blockRequirements(block)];
    if (block.type === 'markdown') {
      splitMarkdown(block.content, out);
    } else if (block.type === 'section') {
      out.push({ kind: 'open', title: plain(block.title ?? '') });
      flatten(block.blocks, inherited, out);
      out.push({ kind: 'close' });
    } else if (block.type === 'collapsible' || block.type === 'assistant') {
      flatten(block.blocks, inherited, out);
    } else if (block.type === 'conditional') {
      // The untaken branch is not what the verified run exercised.
      flatten(block.whenTrue, inherited, out);
    } else if (block.type === 'interactive') {
      out.push(toStep(block, [block.content, block.tooltip], undefined, inherited));
    } else if (block.type === 'code-block') {
      out.push(
        toStep(
          { action: 'code-block', reftarget: block.reftarget },
          [block.content, 'Enter code in the editor'],
          undefined,
          inherited
        )
      );
    } else if (block.type === 'multistep' || block.type === 'guided') {
      const group = cap(plain(block.content), MAX_GROUP);
      for (const step of block.steps) {
        out.push(toStep(step, [step.description, step.tooltip], group, [...inherited, ...(step.requirements ?? [])]));
      }
    }
  }
}

function splitRange(draft: Draft, from: number, to: number): Array<[number, number]> {
  if (to - from <= MAX_STEPS) {
    return [[from, to]];
  }
  const middle = (from + to) / 2;
  const candidates = (changed: (i: number) => boolean) => {
    const found: number[] = [];
    for (let i = from + 1; i < to; i++) {
      if (changed(i)) {
        found.push(i);
      }
    }
    return found.sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
  };
  const at =
    candidates((i) => draft.pages[i] !== draft.pages[i - 1])[0] ??
    candidates((i) => draft.steps[i]!.group !== draft.steps[i - 1]!.group)[0];
  if (at === undefined) {
    const ranges: Array<[number, number]> = [];
    for (let i = from; i < to; i += MAX_STEPS) {
      ranges.push([i, Math.min(i + MAX_STEPS, to)]);
    }
    return ranges;
  }
  return [...splitRange(draft, from, at), ...splitRange(draft, at, to)];
}

export function segmentGuide(guide: SegmentInput): Procedure[] {
  const events: Event[] = [];
  flatten(guide.blocks, [], events);

  const kept: Draft[] = [];
  const sections: string[] = [];
  const headings: Array<Array<{ level: number; text: string }>> = [[]];
  let gap: string[] = [];
  let current: Draft | undefined;
  let lastPage: string | undefined;

  const closeRun = () => {
    if (!current) {
      return;
    }
    if (current.steps.some((s) => s.selector || s.action === 'navigate')) {
      kept.push(current);
    }
    gap = current.pending;
    current = undefined;
  };

  for (const event of events) {
    switch (event.kind) {
      case 'text':
        (current ? current.pending : gap).push(event.text);
        break;
      case 'heading': {
        closeRun();
        const stack = headings[headings.length - 1]!;
        while (stack.length > 0 && stack[stack.length - 1]!.level >= event.level) {
          stack.pop();
        }
        stack.push({ level: event.level, text: event.text });
        break;
      }
      case 'open':
        closeRun();
        sections.push(event.title);
        headings.push([]);
        break;
      case 'close':
        closeRun();
        sections.pop();
        headings.pop();
        break;
      case 'step': {
        if (!current) {
          const previous = kept[kept.length - 1];
          if (previous) {
            previous.outro = cap(gap[0] ?? '', MAX_OUTRO);
          }
          current = {
            crumbs: [guide.title, ...sections, ...headings[headings.length - 1]!.map((h) => h.text)].filter(Boolean),
            steps: [],
            pages: [],
            labels: [],
            pending: [],
            leadIn: cap(gap[gap.length - 1] ?? '', MAX_LEAD_IN),
            outro: '',
          };
          gap = [];
        }
        const last = current.steps[current.steps.length - 1];
        if (last && current.pending.length > 0) {
          last.text = cap(`${last.text} ${current.pending.join(' ')}`.trim(), MAX_STEP_TEXT);
          current.pending = [];
        }
        const href = isNavigation(event.step) ? HREF_VALUE.exec(event.step.selector ?? '')?.[1] : undefined;
        lastPage = event.step.page ?? (href?.startsWith('/') ? pathOf(href) : lastPage);
        current.steps.push({ n: current.steps.length + 1, ...event.step });
        current.pages.push(lastPage);
        current.labels.push(event.labels);
        break;
      }
    }
  }
  closeRun();
  const final = kept[kept.length - 1];
  if (final) {
    final.outro = cap(gap[0] ?? '', MAX_OUTRO);
  }

  const procedures = kept.flatMap((draft) => {
    const ranges = splitRange(draft, 0, draft.steps.length);
    return ranges.map(([from, to], part): Procedure => {
      const steps = draft.steps.slice(from, to).map((s, i) => ({ ...s, n: i + 1 }));
      const pages = draft.pages.slice(from, to);
      let navigation = 0;
      while (navigation < steps.length && isNavigation(steps[navigation]!)) {
        navigation++;
      }
      const crumbs = ranges.length > 1 ? [...draft.crumbs] : draft.crumbs;
      if (ranges.length > 1) {
        crumbs[crumbs.length - 1] = `${crumbs[crumbs.length - 1]} (part ${part + 1} of ${ranges.length})`;
      }
      const startsOn = pages[Math.max(navigation - 1, 0)];
      const endsOn = pages[pages.length - 1];
      return {
        id: '',
        guideId: guide.id,
        guideTitle: guide.title,
        pathTitles: guide.pathTitles,
        crumbs,
        leadIn: draft.leadIn,
        outro: part === ranges.length - 1 ? draft.outro : '',
        steps,
        ...(startsOn ? { startsOn } : {}),
        ...(endsOn ? { endsOn } : {}),
        navigation,
        labels: draft.labels.slice(from, to).flat(),
      };
    });
  });

  return procedures.map((procedure, ordinal) => ({
    ...procedure,
    id: `${guide.id}#${ordinal}`,
    ...(ordinal > 0 ? { prevId: `${guide.id}#${ordinal - 1}` } : {}),
    ...(ordinal < procedures.length - 1 ? { nextId: `${guide.id}#${ordinal + 1}` } : {}),
  }));
}
