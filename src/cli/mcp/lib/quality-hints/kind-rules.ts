import type { ContentJson } from '../../../../types/package.types';
import { suite, walk, type GuideKind, type GuideSuite } from './suite';

const ACTION_TYPES: ReadonlySet<string> = new Set(['interactive', 'multistep', 'guided']);

const blocksOfType = (content: ContentJson, types: ReadonlySet<string>) =>
  [...walk(content.blocks)].filter(({ block }) => types.has(block.type));

export const KIND_SUITES: Record<GuideKind, GuideSuite> = {
  teach: suite('teach guide', 'teach', [
    {
      code: 'TEACH_NO_QUIZ',
      check: (content) => (blocksOfType(content, new Set(['quiz'])).length > 0 ? [] : [{}]),
      steer:
        'Add a `quiz` block that tests only facts the guide states, at the end of a topic or in a closing "Check your knowledge" topic.',
    },
  ]),
  walkthrough: suite('walkthrough guide', 'walkthrough', [
    {
      code: 'WALKTHROUGH_NO_INTERACTIVE',
      check: (content) => (blocksOfType(content, ACTION_TYPES).length > 0 ? [] : [{}]),
      steer: 'Add `interactive` steps for the actions in Grafana, using placeholders for unverified selectors.',
    },
  ]),
  reference: suite('reference guide', 'reference', [
    {
      code: 'REFERENCE_HAS_INTERACTIVE',
      check: (content) => blocksOfType(content, ACTION_TYPES).map(({ block, path }) => ({ blockId: block.id, path })),
      steer: 'Replace the interactive blocks with `markdown`; a reference guide has none.',
    },
  ]),
};
