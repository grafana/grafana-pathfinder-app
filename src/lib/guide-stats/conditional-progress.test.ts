import {
  conditionalBranchesReady,
  conditionalWorkComplete,
  type ActiveConditionalBranch,
} from './conditional-progress';
import { computeGuideBlockIndex } from './block-index';

it('requires a settled branch and every active action, including save', () => {
  const branches = new Map<string, ActiveConditionalBranch>();
  expect(conditionalWorkComplete(['labels'], branches, [])).toBe(false);
  branches.set('labels', { stepIds: ['fill', 'save'], nestedConditionalIds: [] });
  const filled = [{ kind: 'do-it' as const, blockId: 'fill' }];
  expect(conditionalWorkComplete(['labels'], branches, filled)).toBe(false);
  expect(conditionalWorkComplete(['labels'], branches, [...filled, { kind: 'do-it', blockId: 'save' }])).toBe(true);
});

it('follows only the active nested branch and retains history without crediting inactive work', () => {
  const branches = new Map<string, ActiveConditionalBranch>([
    ['page', { stepIds: [], nestedConditionalIds: ['fields'] }],
    ['fields', { stepIds: ['save-new'], nestedConditionalIds: [] }],
  ]);
  const evidence = [{ kind: 'do-it' as const, blockId: 'save-old' }];
  expect(conditionalWorkComplete(['page'], branches, evidence)).toBe(false);
  branches.set('fields', { stepIds: ['save-old'], nestedConditionalIds: [] });
  expect(conditionalWorkComplete(['page'], branches, evidence)).toBe(true);
  branches.set('page', { stepIds: [], nestedConditionalIds: [] });
  branches.delete('fields');
  expect(conditionalWorkComplete(['page'], branches, [])).toBe(true);
});

it('indexes conditional work without changing published block positions', () => {
  const index = computeGuideBlockIndex([
    { type: 'interactive', id: 'open-labels' },
    { type: 'conditional', id: 'labels', whenTrue: [{ type: 'conditional', whenTrue: [{ type: 'interactive' }] }] },
    { type: 'conditional', whenTrue: [{ type: 'markdown' }] },
  ]);
  expect(index.totalBlockCount).toBe(3);
  expect([...index.conditionalPositions!]).toEqual([['labels', 2]]);
});

it('waits for all active nested branches to register without waiting for their work to complete', () => {
  const branches = new Map<string, ActiveConditionalBranch>([
    ['outer', { stepIds: ['save'], nestedConditionalIds: ['inner'] }],
  ]);
  expect(conditionalBranchesReady(['outer'], branches)).toBe(false);
  branches.set('inner', { stepIds: ['fill'], nestedConditionalIds: [] });
  expect(conditionalBranchesReady(['outer'], branches)).toBe(true);
  expect(conditionalWorkComplete(['outer'], branches, [])).toBe(false);
});
