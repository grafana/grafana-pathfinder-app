import { hasOnPage, actionUnits, suite, unitField, walk, type Flag } from './suite';

const H2_LINE = /^##\s/m;
const ACTION_TYPES: ReadonlySet<string> = new Set(['interactive', 'multistep', 'guided']);

export const MIN_SECTION_STEPS = 2;
export const MAX_CALLOUTS_PER_TOPIC = 1;

export const GUIDE_SUITE = suite('guide', 'guide', [
  {
    code: 'CLOSING_SUMMARY',
    check: (content) => {
      const blocks = content.blocks ?? [];
      const last = blocks[blocks.length - 1];
      return last?.type === 'markdown'
        ? []
        : [{ blockId: last?.id, path: `blocks[${Math.max(blocks.length - 1, 0)}]` }];
    },
    steer: 'End the guide with a top-level `markdown` block summarizing what the reader now knows, with next steps.',
  },
  {
    code: 'SMALL_SECTION',
    check: (content) => {
      const flags: Flag[] = [];
      for (const { block, path } of walk(content.blocks)) {
        if (block.type !== 'section' || !Array.isArray(block.blocks)) {
          continue;
        }
        const steps = block.blocks.length - (block.blocks[0]?.type === 'markdown' ? 1 : 0);
        if (steps < MIN_SECTION_STEPS) {
          flags.push({ blockId: block.id, path });
        }
      }
      return flags;
    },
    steer: `Give each section at least ${MIN_SECTION_STEPS} steps besides its lead-in, or make the lone action a top-level block.`,
  },
  {
    code: 'CALLOUTS_PER_TOPIC',
    check: (content) => {
      const flags: Flag[] = [];
      let callouts = 0;
      for (const { block, path, ancestors } of walk(content.blocks)) {
        if (ancestors.length === 0 && block.type === 'markdown' && H2_LINE.test(block.content)) {
          callouts = 0;
        }
        if (block.type === 'callout' && ++callouts > MAX_CALLOUTS_PER_TOPIC) {
          flags.push({ blockId: block.id, path });
        }
      }
      return flags;
    },
    steer: `Keep to ${MAX_CALLOUTS_PER_TOPIC} callout per \`##\` topic; merge or drop the extra.`,
  },
  {
    code: 'UNANCHORED_FIRST_STEP',
    check: (content) => {
      for (const { block, path, ancestors } of walk(content.blocks)) {
        if (!ACTION_TYPES.has(block.type)) {
          continue;
        }
        const [unit] = actionUnits(block);
        if (!unit) {
          continue;
        }
        return unitField(unit, 'action') === 'navigate' || hasOnPage(unit, block, ancestors)
          ? []
          : [{ blockId: block.id, path }];
      }
      return [];
    },
    steer: 'Anchor the first interactive step with an `on-page:/path` requirement or a `navigate` action before it.',
  },
]);
