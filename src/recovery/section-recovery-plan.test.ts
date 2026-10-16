import { deriveSectionRecoveryPlan, type RecoveryStepInput } from './section-recovery-plan';

const NONE = new Set<string>();

const toggle = (stepId: string, refTarget = `#${stepId}`, targetState: boolean | string = 'aria-expanded:true') =>
  ({ stepId, kind: 'plain', targetAction: 'highlight', refTarget, targetState }) satisfies RecoveryStepInput;
const cursor = (requirements?: string) =>
  ({
    stepId: 'cursor',
    kind: 'plain',
    targetAction: 'button',
    refTarget: '#run',
    requirements,
  }) satisfies RecoveryStepInput;

function recipe(steps: RecoveryStepInput[], skipped: ReadonlySet<string> = NONE) {
  const plan = deriveSectionRecoveryPlan(steps, steps.length - 1, skipped);
  const target = plan?.checks.find((check) => check.kind === 'target-present');
  return target?.recover?.map((action) => (action.kind === 'toggle' ? action.refTarget : action.kind));
}

it('checks the cursor page and target, returning to the last ready page first', () => {
  const plan = deriveSectionRecoveryPlan([cursor('on-page:/explore, exists-reftarget')], 0, NONE);
  expect(plan?.checks).toEqual([
    { kind: 'requirement', requirement: 'on-page:/explore' },
    {
      kind: 'target-present',
      refTarget: '#run',
      targetAction: 'button',
      recover: [{ kind: 'resume-location', objectives: [{ kind: 'resume-location' }] }],
    },
  ]);
  expect(plan?.cursorStepId).toBe('cursor');
});

it('replays earlier toggles in document order with their own state as the objective', () => {
  const steps = [toggle('row'), toggle('options'), cursor()];
  expect(recipe(steps)).toEqual(['resume-location', '#row', '#options']);
  const plan = deriveSectionRecoveryPlan(steps, 2, NONE)!;
  expect(plan.checks[0]!.recover![1]).toEqual({
    kind: 'toggle',
    refTarget: '#row',
    targetAction: 'highlight',
    targetState: 'aria-expanded:true',
    objectives: [
      { kind: 'target-state', refTarget: '#row', targetAction: 'highlight', targetState: 'aria-expanded:true' },
    ],
  });
});

it.each([
  ['a navigation', { stepId: 'nav', kind: 'plain', targetAction: 'navigate', refTarget: '/dashboards' }],
  ['a one-way click', { stepId: 'save', kind: 'plain', targetAction: 'button', refTarget: 'Save' }],
  ['a multistep', { stepId: 'multi', kind: 'multistep' }],
  ['a guided step', { stepId: 'guided', kind: 'guided' }],
  ['a lazily rendered toggle', { ...toggle('lazy'), lazyRender: true }],
  ['a challenge', { stepId: 'challenge', kind: 'challenge' }],
  ['a data source check', { stepId: 'datasource', kind: 'datasource-check' }],
  ['an unknown step type', { stepId: 'future', kind: 'future-kind' }],
])('stops at %s, keeping only the toggles after it', (_name, barrier: RecoveryStepInput) => {
  expect(recipe([toggle('before'), barrier, toggle('after'), cursor()])).toEqual(['resume-location', '#after']);
});

it.each([
  ['a form fill', { stepId: 'fill', kind: 'plain', targetAction: 'formfill', refTarget: '#name' }],
  ['a hover', { stepId: 'hover', kind: 'plain', targetAction: 'hover', refTarget: '#tip' }],
  ['a noop', { stepId: 'noop', kind: 'plain', targetAction: 'noop' }],
  ['a code block', { stepId: 'code', kind: 'codeblock' }],
  ['a quiz', { stepId: 'quiz', kind: 'quiz' }],
])('passes through %s without replaying it', (_name, transparent: RecoveryStepInput) => {
  expect(recipe([toggle('before'), transparent, cursor()])).toEqual(['resume-location', '#before']);
});

it('passes through a skipped step that would otherwise stop the walk', () => {
  const skippedSave = { stepId: 'save', kind: 'plain', targetAction: 'button', refTarget: 'Save' };
  expect(recipe([toggle('before'), skippedSave, cursor()], new Set(['save']))).toEqual(['resume-location', '#before']);
});

it('keeps only the latest toggle of the same control and attribute', () => {
  const steps = [
    toggle('open', '#row', 'aria-expanded:true'),
    toggle('close', '#row', 'aria-expanded:false'),
    cursor(),
  ];
  const plan = deriveSectionRecoveryPlan(steps, 2, NONE)!;
  expect(plan.checks[0]!.recover!.slice(1)).toEqual([expect.objectContaining({ targetState: 'aria-expanded:false' })]);
});

it('derives only page checks when the cursor step has no target to look for', () => {
  const guided = { stepId: 'guided', kind: 'guided', requirements: ['on-page:/explore'] };
  expect(deriveSectionRecoveryPlan([toggle('row'), guided], 1, NONE)?.checks).toEqual([
    { kind: 'requirement', requirement: 'on-page:/explore' },
  ]);
  expect(deriveSectionRecoveryPlan([{ ...cursor(), lazyRender: true }], 0, NONE)).toBeUndefined();
});

it('keeps only on-page from the cursor requirements, leaving other fixes to the step', () => {
  const plan = deriveSectionRecoveryPlan([cursor('navmenu-open, is-admin, on-page:/d/a')], 0, NONE);
  expect(plan?.checks.filter((check) => check.kind === 'requirement')).toEqual([
    { kind: 'requirement', requirement: 'on-page:/d/a' },
  ]);
});

it('has no plan past the last step or for steps with nothing to check', () => {
  expect(deriveSectionRecoveryPlan([cursor()], 1, NONE)).toBeUndefined();
  expect(
    deriveSectionRecoveryPlan([{ stepId: 'nav', kind: 'plain', targetAction: 'navigate' }], 0, NONE)
  ).toBeUndefined();
});

it('changes its key when the cursor moves or the recipe changes', () => {
  const steps = [toggle('row'), cursor(), { ...cursor(), stepId: 'next' }];
  const first = deriveSectionRecoveryPlan(steps, 1, NONE)!.key;
  expect(deriveSectionRecoveryPlan(steps, 1, NONE)!.key).toBe(first);
  expect(deriveSectionRecoveryPlan(steps, 2, NONE)!.key).not.toBe(first);
});

it('stops at an inline conditional between steps', () => {
  expect(recipe([toggle('before'), { ...toggle('after'), opaqueBefore: true }, cursor()])).toEqual([
    'resume-location',
    '#after',
  ]);
  expect(recipe([toggle('before'), { ...cursor(), opaqueBefore: true }])).toEqual(['resume-location']);
});

it('names the one-way step that set up the cursor target', () => {
  const save = { stepId: 'save', kind: 'plain', targetAction: 'button', refTarget: 'Save' };
  const fill = { stepId: 'fill', kind: 'plain', targetAction: 'formfill', refTarget: '#name' };
  expect(deriveSectionRecoveryPlan([save, fill, toggle('row'), cursor()], 3, NONE)?.setupStepId).toBe('save');
});

it('names no setup step when the walk reaches the section start, a skipped step, or a conditional', () => {
  const save = { stepId: 'save', kind: 'plain', targetAction: 'button', refTarget: 'Save' };
  expect(deriveSectionRecoveryPlan([toggle('row'), cursor()], 1, NONE)?.setupStepId).toBeUndefined();
  expect(deriveSectionRecoveryPlan([save, cursor()], 1, new Set(['save']))?.setupStepId).toBeUndefined();
  expect(deriveSectionRecoveryPlan([save, { ...cursor(), opaqueBefore: true }], 1, NONE)?.setupStepId).toBeUndefined();
  const guided = { stepId: 'guided', kind: 'guided', requirements: ['on-page:/explore'] };
  expect(deriveSectionRecoveryPlan([save, guided], 1, NONE)?.setupStepId).toBeUndefined();
});
