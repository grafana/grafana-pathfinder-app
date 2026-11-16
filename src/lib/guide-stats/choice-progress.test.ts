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

describe('a choice guide with interactive blocks', () => {
  const step = (id: string): JsonBlock => ({ type: 'interactive', id, action: 'noop', content: id });
  const interactiveBlocks: JsonBlock[] = [
    blocks[0]!,
    ...options.map((id): JsonBlock => ({
      type: 'section',
      id,
      requirements: [`var-signals:includes:${id}`],
      whenRequirementsUnmet: 'hide',
      blocks: [step(`${id}-run`), { type: 'markdown', id: `${id}-outro`, content: 'Done' }],
    })),
  ];
  const stepIndex = computeGuideBlockIndex(interactiveBlocks);
  const stepModel = createChoiceProgressModel(interactiveBlocks, stepIndex)!;
  const doIt = (blockId: string): CompletionEvidence => ({ kind: 'do-it', blockId });

  it('completes at the final interactive block of the active path, not of the whole guide', () => {
    const progress = choiceGuideProgress(stepModel, stepIndex, [doIt('logs-run')], { signals: 'logs' }, none);
    expect(progress).toMatchObject({ percent: 100, complete: true });
  });

  it('does not complete until the final interactive block of the active path has evidence', () => {
    const progress = choiceGuideProgress(stepModel, stepIndex, [doIt('logs-run')], { signals: 'logs,traces' }, none);
    expect(progress.complete).toBe(false);
    expect(progress.percent).toBeLessThan(100);
  });

  it('still requires an answer to the required choice', () => {
    expect(choiceGuideProgress(stepModel, stepIndex, [doIt('logs-run')], {}, none).complete).toBe(false);
  });
});
