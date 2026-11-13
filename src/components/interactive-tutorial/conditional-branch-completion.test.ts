import { completedParsedBranch } from './conditional-branch-completion';
import type { ParsedElement } from '../../docs-retrieval';

const step = (stepId: string): ParsedElement => ({ type: 'interactive-step', props: { stepId }, children: [] });
const evidence = (...ids: string[]) => ids.map((blockId) => ({ kind: 'do-it' as const, blockId }));

it('locks only after every step completes, never on an empty or prose-only branch', () => {
  expect(completedParsedBranch([], [])).toBe(false);
  expect(completedParsedBranch([{ type: 'p', props: {}, children: ['Read me'] }], [])).toBe(false);
  expect(completedParsedBranch([step('fill'), step('save')], evidence('fill'))).toBe(false);
  expect(completedParsedBranch([step('fill'), step('save')], evidence('fill', 'save'))).toBe(true);
});

it('restores nested completed work without requiring the old page DOM', () => {
  const nested: ParsedElement = {
    type: 'interactive-conditional',
    props: { whenTrueChildren: [step('save')], whenFalseChildren: [] },
    children: [],
  };
  expect(completedParsedBranch([nested], [])).toBe(false);
  expect(completedParsedBranch([nested], evidence('save'))).toBe(true);
  expect(completedParsedBranch([step('open'), nested], evidence('save'))).toBe(false);
});
