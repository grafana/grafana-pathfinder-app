import type { JsonBlock } from '../../types/json-guide.types';
import { computeGuideBlockIndex } from './block-index';
import {
  CHOICE_COMPLETION_VARIABLE,
  choiceGuideProgress,
  choicePathCompletionKeys,
  createChoiceProgressModel,
} from './choice-progress';
import type { CompletionEvidence } from './progress';

const options = ['metrics', 'logs', 'traces'];
const blocks: JsonBlock[] = [
  {
    type: 'input',
    inputType: 'checkbox-group',
    variableName: 'signals',
    prompt: 'Which signals?',
    required: true,
    choices: options.map((id) => ({ id, text: id })),
  },
  { type: 'section', id: 'common', blocks: [{ type: 'markdown', id: 'intro', content: 'Common step' }] },
  ...options.map((id): JsonBlock => ({
    type: 'section',
    id,
    requirements: [`var-signals:includes:${id}`],
    whenRequirementsUnmet: 'hide',
    blocks: [
      { type: 'markdown', id: `${id}-first`, content: 'First step' },
      { type: 'markdown', id: `${id}-last`, content: 'Last step' },
    ],
  })),
];
const index = computeGuideBlockIndex(blocks);
const model = createChoiceProgressModel(blocks, index)!;
const none = new Set<string>();
const ack = (id: string): CompletionEvidence => ({ kind: 'mark-section-complete', blockId: `section-${id}` });

it.each(Array.from({ length: 8 }, (_, mask) => [mask, options.filter((_, i) => mask & (1 << i))] as const))(
  'counts only selected paths for combination %i',
  (_mask, selected) => {
    const responses = { signals: selected.join(',') };
    const progress = choiceGuideProgress(model, index, [ack('common'), ...selected.map(ack)], responses, none);
    expect(progress.totalBlockCount).toBe(2 + selected.length * 2);
    expect(progress.complete).toBe(selected.length > 0);
    expect(progress.percent).toBe(selected.length > 0 ? 100 : 50);
  }
);

it('does not credit an earlier unfinished integration from a later completed integration', () => {
  const progress = choiceGuideProgress(model, index, [ack('common'), ack('logs')], { signals: 'metrics,logs' }, none);
  expect(progress.percent).toBe(66);
  expect(progress.complete).toBe(false);
});

it('preserves evidence across deselection and re-selection and lowers progress for a new unfinished path', () => {
  const evidence = [ack('common'), ack('logs')];
  expect(choiceGuideProgress(model, index, evidence, { signals: 'logs' }, none).complete).toBe(true);
  expect(choiceGuideProgress(model, index, evidence, { signals: 'logs,traces' }, none).complete).toBe(false);
  expect(choiceGuideProgress(model, index, evidence, { signals: 'logs' }, none).complete).toBe(true);
});

it('marks only the active path, survives a reload, and does not mark a newly selected path', () => {
  const keys = choicePathCompletionKeys(model, { signals: 'logs' }, none);
  const responses = { signals: 'logs', [CHOICE_COMPLETION_VARIABLE]: JSON.stringify(keys) };
  const restored = createChoiceProgressModel(blocks, computeGuideBlockIndex(blocks))!;
  expect(choiceGuideProgress(restored, index, [], responses, none).complete).toBe(true);
  expect(choiceGuideProgress(restored, index, [], { ...responses, signals: 'logs,traces' }, none).complete).toBe(false);
});

it('retains the old model for guides without choices or visibility controls', () => {
  const old: JsonBlock[] = [
    { type: 'section', requirements: ['var-accepted:true'], blocks: [{ type: 'markdown', content: 'Still visible' }] },
  ];
  expect(createChoiceProgressModel(old, computeGuideBlockIndex(old))).toBeUndefined();
});

it('uses runtime visibility for environment requirements and heading-only sections', () => {
  const environment: JsonBlock[] = [
    {
      type: 'section',
      id: 'environment',
      whenRequirementsUnmet: 'heading-only',
      requirements: ['is-admin'],
      blocks: [{ type: 'markdown', content: 'Configure' }],
    },
  ];
  const envIndex = computeGuideBlockIndex(environment);
  const envModel = createChoiceProgressModel(environment, envIndex)!;
  expect(choiceGuideProgress(envModel, envIndex, [], {}, new Set(['section-environment'])).totalBlockCount).toBe(0);
  expect(choiceGuideProgress(envModel, envIndex, [ack('environment')], {}, none).complete).toBe(true);
});
