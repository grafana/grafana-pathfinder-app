import type { JsonBlock } from '../../../../types/json-guide.types';
import {
  actionUnits,
  hasOnPage,
  joinPath,
  suite,
  unitField,
  type ActionUnit,
  type BlockRule,
  type BlockSuite,
  type RuleContext,
} from './suite';

export const MAX_PARAGRAPH_WORDS = 130;
export const MAX_PLAIN_PARAGRAPH_RUN = 3;

const ACTION_BLOCKS = ['interactive', 'multistep', 'guided'] as const;
const VISUAL_BLOCKS: ReadonlySet<string> = new Set(['callout', 'divider', 'image', 'video']);
const PLACEHOLDER_REFTARGET = /TODO-/;
const PLACEHOLDER_LEAD = '**⚠️ TODO:';
const TRANSLATED_TARGET = /aria-label=|placeholder=|title=|:contains\(/;
const PLAIN_TEXT_TARGET = /^[A-Z][^#.[\]:>=*~+()]*$/;
const NUMBERED_TITLE = /^\s*(?:\d+\s*[.)]|step\s*\d+)/i;
const UI_VERB = /\b(?:click|select|enter|type|set|open|choose|switch|toggle|fill|pick|check|expand|add)\b/i;
const SENTENCE_START_VERB =
  /^\W*(?:click|select|enter|type|set|open|choose|switch|toggle|fill|pick|check|expand|add)\b/i;
const BOLD_LABEL = /\*\*[^*]+\*\*/;
const STATE_CHANGING = /\b(?:save|create|test|apply|submit|add|delete|import)\b/i;
const FENCE_OPEN = /^\s*(?:```|~~~)/m;
const EDITOR_LEAD_IN = /\b(?:enter|type|paste|write)\b[^.]*\b(?:query|code|expression|editor)\b/i;
const STYLED_HTML = /<[a-z][^>]*\s(?:class|style)\s*=/i;

type MarkdownChunk =
  { kind: 'plain' | 'heading' | 'list' | 'table' | 'quote'; text: string } | { kind: 'fence'; lang: string };

const lineKind = (line: string): Exclude<MarkdownChunk['kind'], 'fence'> => {
  if (/^#{1,6}\s/.test(line)) {
    return 'heading';
  }
  if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
    return 'list';
  }
  if (line.trimStart().startsWith('|')) {
    return 'table';
  }
  return line.trimStart().startsWith('>') ? 'quote' : 'plain';
};

function markdownChunks(content: unknown): MarkdownChunk[] {
  const chunks: MarkdownChunk[] = [];
  let open: { kind: Exclude<MarkdownChunk['kind'], 'fence'>; lines: string[] } | undefined;
  let inFence = false;
  const flush = () => {
    if (open) {
      chunks.push({ kind: open.kind, text: open.lines.join('\n') });
      open = undefined;
    }
  };
  for (const line of typeof content === 'string' ? content.split('\n') : []) {
    const fence = /^\s*(?:```|~~~)\s*(\S*)/.exec(line);
    if (inFence) {
      inFence = !fence;
    } else if (fence) {
      flush();
      inFence = true;
      chunks.push({ kind: 'fence', lang: fence[1] ?? '' });
    } else if (line.trim() === '') {
      flush();
    } else if (open) {
      open.lines.push(line);
    } else {
      open = { kind: lineKind(line), lines: [line] };
    }
  }
  flush();
  return chunks;
}

const unitPaths = (block: JsonBlock, flagged: (unit: ActionUnit) => boolean): string[] =>
  actionUnits(block)
    .filter(flagged)
    .map((unit) => unit.path);

const actionOf = (unit: ActionUnit) => unitField(unit, 'action');
const reftargetOf = (unit: ActionUnit) => {
  const value = unitField(unit, 'reftarget');
  return typeof value === 'string' ? value : '';
};

const inSection = (ctx: RuleContext) => ctx.ancestors.some((ancestor) => ancestor.type === 'section');

const actionRules: BlockRule[] = [
  {
    code: 'NOOP_STEP',
    check: (block) => unitPaths(block, (unit) => actionOf(unit) === 'noop'),
    steer: 'Replace the `noop` step with a `markdown` block describing what the reader would do.',
  },
  {
    code: 'MISSING_ON_PAGE',
    check: (block, ctx) =>
      unitPaths(
        block,
        (unit) => actionOf(unit) !== 'navigate' && actionOf(unit) !== 'noop' && !hasOnPage(unit, block, ctx.ancestors)
      ),
    steer: 'Add an `on-page:/path` entry to the step `requirements`.',
  },
  {
    code: 'MISSING_VERIFY',
    check: (block) =>
      unitPaths(block, (unit) => {
        if (block.type !== 'interactive') {
          return false;
        }
        const action = actionOf(unit);
        const text = action === 'button' ? [unit.node.content, reftargetOf(unit)] : [unit.node.content];
        return (
          (action === 'button' || action === 'highlight') &&
          text.some((t) => typeof t === 'string' && STATE_CHANGING.test(t)) &&
          !unitField(unit, 'verify')
        );
      }),
    steer: "Add `verify` to this state-changing step so the next step can't run against a half-finished action.",
  },
  {
    code: 'PLACEHOLDER_UNRESOLVED',
    check: (block) =>
      actionUnits(block)
        .filter((unit) => PLACEHOLDER_REFTARGET.test(reftargetOf(unit)))
        .map((unit) => joinPath(unit.path, 'reftarget')),
    steer:
      "Placeholder selector. If you haven't searched for this step yet, search it with pathfinder_find_steps in the words Grafana's UI uses. If a result covered the surrounding task, check its `nextProcedure`/`previousProcedure` for this step. Keep the placeholder only if neither has it.",
  },
];

const blockLeadOf = (block: JsonBlock) => {
  const text = (block as { content?: unknown }).content;
  return typeof text === 'string' ? text.trimStart() : '';
};

const hasPlaceholder = (block: JsonBlock) =>
  actionUnits(block).some((unit) => PLACEHOLDER_REFTARGET.test(reftargetOf(unit)));

// Multistep never renders step descriptions, so the lead lives in the content of the block that holds the step.
const leadRules: BlockRule[] = [
  {
    code: 'PLACEHOLDER_LEAD_MISSING',
    check: (block) => (hasPlaceholder(block) && !blockLeadOf(block).startsWith(PLACEHOLDER_LEAD) ? ['content'] : []),
    steer:
      "Start the block's `content` with `**⚠️ TODO: add the selector for <target>**` (for a `multistep` or `guided` step, this block's `content`).",
  },
  {
    code: 'PLACEHOLDER_LEAD_ORPHANED',
    check: (block) => (!hasPlaceholder(block) && blockLeadOf(block).startsWith(PLACEHOLDER_LEAD) ? ['content'] : []),
    steer:
      "No step in this block has a `TODO-` selector any more but its `content` still starts with the TODO lead. Remove the lead so it doesn't reach learners.",
  },
];

const textSelectorRule: BlockRule = {
  code: 'TEXT_SELECTOR',
  check: (block, ctx) =>
    actionUnits(block)
      .filter((unit) => {
        const target = reftargetOf(unit);
        if (
          !target ||
          PLACEHOLDER_REFTARGET.test(target) ||
          target.startsWith('grafana:') ||
          ctx.verifiedSelectors.has(target)
        ) {
          return false;
        }
        return TRANSLATED_TARGET.test(target) || (actionOf(unit) !== 'button' && PLAIN_TEXT_TARGET.test(target));
      })
      .map((unit) => joinPath(unit.path, 'reftarget')),
  steer: 'Target a `grafana:` selector path or a `data-testid` instead of translated text.',
};

export const BLOCK_SUITES: BlockSuite[] = [
  suite('interactive, multistep and guided steps', ACTION_BLOCKS, actionRules),
  suite('blocks with a reftarget', [...ACTION_BLOCKS, 'code-block'], [textSelectorRule, ...leadRules]),
  suite(
    'multistep and guided',
    ['multistep', 'guided'],
    [
      {
        code: 'SINGLE_STEP_MULTISTEP',
        check: (block) => Array.isArray(block.steps) && block.steps.length === 1,
        steer: 'Replace the one-step block with an `interactive` block.',
      },
    ]
  ),
  suite(
    'markdown',
    ['markdown'],
    [
      {
        code: 'HTML_STYLING',
        check: (block) => typeof block.content === 'string' && STYLED_HTML.test(block.content),
        steer: 'Remove the HTML and style with markdown headings, lists, tables, quotes and bold lead-ins.',
      },
      {
        code: 'LONG_PARAGRAPH',
        check: (block) =>
          markdownChunks(block.content).some(
            (chunk) => chunk.kind === 'plain' && chunk.text.split(/\s+/).length > MAX_PARAGRAPH_WORDS
          ),
        steer: `Split paragraphs over ${MAX_PARAGRAPH_WORDS} words, and add \`##\` topics or a list rather than longer prose.`,
      },
      {
        code: 'PARAGRAPH_RUN',
        check: (block) => {
          let run = 0;
          return markdownChunks(block.content).some((chunk) => {
            run = chunk.kind === 'plain' ? run + 1 : 0;
            return run > MAX_PLAIN_PARAGRAPH_RUN;
          });
        },
        steer: `Break up more than ${MAX_PLAIN_PARAGRAPH_RUN} plain paragraphs in a row with a heading, list, table, quote or code fence.`,
      },
      {
        code: 'PROSE_UI_STEP',
        check: (block, ctx) => {
          if (!inSection(ctx) || typeof block.content !== 'string') {
            return false;
          }
          const sentences = block.content.split(/(?<=[.!?])\s+|\n+/);
          // A section's leading lead-in is exempt unless a sentence opens with an imperative verb.
          if (ctx.index === 0 && !sentences.some((sentence) => SENTENCE_START_VERB.test(sentence))) {
            return false;
          }
          return sentences.some((sentence) => UI_VERB.test(sentence) && BOLD_LABEL.test(sentence));
        },
        steer:
          'This describes Grafana UI actions in prose. Make each one an interactive step, with a placeholder selector where none is verified.',
      },
      {
        code: 'EDITOR_CODE_IN_MARKDOWN',
        check: (block, ctx) => {
          const fence = typeof block.content === 'string' ? FENCE_OPEN.exec(block.content) : null;
          return (
            inSection(ctx) && fence !== null && EDITOR_LEAD_IN.test((block.content as string).slice(0, fence.index))
          );
        },
        steer:
          'Code the reader types into a Grafana editor belongs in a `code-block` targeting that editor, not a fenced block in `markdown`.',
      },
      {
        code: 'CODE_FENCE_NO_LANG',
        check: (block) => markdownChunks(block.content).some((chunk) => chunk.kind === 'fence' && chunk.lang === ''),
        steer: 'Add a language tag to the opening code fence.',
      },
    ]
  ),
  suite(
    'html',
    ['html'],
    [
      {
        code: 'HTML_STYLING',
        check: () => true,
        steer: 'Replace the `html` block with `markdown`, `section`, `callout` or `divider` blocks.',
      },
    ]
  ),
  suite(
    'section',
    ['section'],
    [
      {
        code: 'NUMBERED_SECTION_TITLE',
        check: (block) => typeof block.title === 'string' && NUMBERED_TITLE.test(block.title),
        steer: 'Remove the number from the section title; the section numbers its own children.',
      },
      {
        code: 'ADJACENT_SECTIONS',
        check: (_block, ctx) => ctx.siblings[ctx.index + 1]?.type === 'section',
        steer:
          'Put a short `markdown` block between the two sections that conceptually bridges them, summarizes, or explains.',
      },
    ]
  ),
  suite(
    'visual blocks',
    ['callout', 'divider', 'image', 'video'],
    [
      {
        code: 'ADJACENT_VISUALS',
        check: (_block, ctx) => VISUAL_BLOCKS.has(ctx.siblings[ctx.index + 1]?.type ?? ''),
        steer: 'Put a short `markdown` paragraph between the two visual blocks, or merge or drop one.',
      },
    ]
  ),
];
