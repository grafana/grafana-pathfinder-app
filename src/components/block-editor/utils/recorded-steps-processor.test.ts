/**
 * Tests for recorded-steps-processor utility
 */

import {
  groupRecordedStepsByGroupId,
  convertStepToInteractiveBlock,
  convertStepsToMultistepBlock,
  convertProcessedStepsToBlocks,
} from './recorded-steps-processor';
import type { RecordedStep } from '../../../utils/devtools';

const makeStep = (overrides: Partial<RecordedStep> = {}): RecordedStep => ({
  action: 'click',
  selector: '[data-testid="button"]',
  timestamp: Date.now(),
  description: 'Click the button',
  ...overrides,
});

describe('groupRecordedStepsByGroupId', () => {
  it('returns empty array for empty input', () => {
    expect(groupRecordedStepsByGroupId([])).toEqual([]);
  });

  it('keeps ungrouped steps as singles', () => {
    const steps = [makeStep(), makeStep()];
    const result = groupRecordedStepsByGroupId(steps);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('single');
    expect(result[1].type).toBe('single');
  });

  it('groups consecutive steps with same groupId', () => {
    const steps = [
      makeStep({ groupId: 'group-1' }),
      makeStep({ groupId: 'group-1' }),
      makeStep({ groupId: 'group-1' }),
    ];
    const result = groupRecordedStepsByGroupId(steps);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
    expect(result[0].steps).toHaveLength(3);
  });

  it('separates different groupIds into different groups', () => {
    const steps = [
      makeStep({ groupId: 'group-1' }),
      makeStep({ groupId: 'group-1' }),
      makeStep({ groupId: 'group-2' }),
      makeStep({ groupId: 'group-2' }),
    ];
    const result = groupRecordedStepsByGroupId(steps);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('group');
    expect(result[0].steps).toHaveLength(2);
    expect(result[1].type).toBe('group');
    expect(result[1].steps).toHaveLength(2);
  });

  it('handles alternating grouped and ungrouped steps', () => {
    const steps = [
      makeStep(), // single
      makeStep({ groupId: 'group-1' }),
      makeStep({ groupId: 'group-1' }),
      makeStep(), // single
      makeStep({ groupId: 'group-2' }),
    ];
    const result = groupRecordedStepsByGroupId(steps);

    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('single');
    expect(result[1].type).toBe('group');
    expect(result[1].steps).toHaveLength(2);
    expect(result[2].type).toBe('single');
    expect(result[3].type).toBe('group');
    expect(result[3].steps).toHaveLength(1);
  });

  it('handles single step in a group', () => {
    const steps = [makeStep({ groupId: 'solo-group' })];
    const result = groupRecordedStepsByGroupId(steps);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
    expect(result[0].steps).toHaveLength(1);
  });

  it('handles group at end of sequence', () => {
    const steps = [makeStep(), makeStep({ groupId: 'end-group' }), makeStep({ groupId: 'end-group' })];
    const result = groupRecordedStepsByGroupId(steps);

    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('single');
    expect(result[1].type).toBe('group');
    expect(result[1].steps).toHaveLength(2);
  });
});

describe('convertStepToInteractiveBlock', () => {
  it('converts step to interactive block', () => {
    const step = makeStep({
      action: 'click',
      selector: '[data-testid="submit"]',
      description: 'Click submit',
    });
    const block = convertStepToInteractiveBlock(step);

    expect(block.type).toBe('interactive');
    expect(block.action).toBe('click');
    expect(block.reftarget).toBe('[data-testid="submit"]');
    expect(block.content).toBe('Click submit');
  });

  it('includes targetvalue when step has value', () => {
    const step = makeStep({
      action: 'fill',
      value: 'test input',
    });
    const block = convertStepToInteractiveBlock(step);

    expect(block.targetvalue).toBe('test input');
  });

  it('uses fallback description when none provided', () => {
    const step = makeStep({ description: undefined });
    const block = convertStepToInteractiveBlock(step);

    expect(block.content).toBe('click on element');
  });

  it('does not include targetvalue when step has no value', () => {
    const step = makeStep({ value: undefined });
    const block = convertStepToInteractiveBlock(step);

    expect(block.targetvalue).toBeUndefined();
  });
});

describe('convertStepsToMultistepBlock', () => {
  it('converts steps to multistep block', () => {
    const steps = [makeStep({ description: 'Step 1' }), makeStep({ description: 'Step 2' })];
    const block = convertStepsToMultistepBlock(steps);

    expect(block.type).toBe('multistep');
    expect(block.steps).toHaveLength(2);
    expect(block.content).toBe('Step 1');
  });

  it('maps step properties correctly', () => {
    const steps = [
      makeStep({
        action: 'fill',
        selector: '[data-testid="input"]',
        value: 'hello',
        description: 'Fill input',
      }),
    ];
    const block = convertStepsToMultistepBlock(steps);

    expect(block.steps[0].action).toBe('fill');
    expect(block.steps[0].reftarget).toBe('[data-testid="input"]');
    expect(block.steps[0].targetvalue).toBe('hello');
    expect(block.steps[0].tooltip).toBe('Fill input');
  });

  it('uses fallback description for content when first step has no description', () => {
    const steps = [makeStep({ description: undefined, action: 'click' })];
    const block = convertStepsToMultistepBlock(steps);

    expect(block.content).toBe('Complete the following steps');
  });

  it('uses fallback for step tooltip when no description', () => {
    const steps = [makeStep({ description: undefined, action: 'hover' })];
    const block = convertStepsToMultistepBlock(steps);

    expect(block.steps[0].tooltip).toBe('hover on element');
  });
});

describe('convertProcessedStepsToBlocks', () => {
  it('converts singles to interactive blocks', () => {
    const processed = [{ type: 'single' as const, steps: [makeStep()] }];
    const blocks = convertProcessedStepsToBlocks(processed);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('interactive');
  });

  it('converts groups to multistep blocks', () => {
    const processed = [{ type: 'group' as const, steps: [makeStep(), makeStep()] }];
    const blocks = convertProcessedStepsToBlocks(processed);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe('multistep');
  });

  it('handles mixed singles and groups', () => {
    const processed = [
      { type: 'single' as const, steps: [makeStep()] },
      { type: 'group' as const, steps: [makeStep(), makeStep()] },
      { type: 'single' as const, steps: [makeStep()] },
    ];
    const blocks = convertProcessedStepsToBlocks(processed);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].type).toBe('interactive');
    expect(blocks[1].type).toBe('multistep');
    expect(blocks[2].type).toBe('interactive');
  });

  it('returns empty array for empty input', () => {
    const blocks = convertProcessedStepsToBlocks([]);
    expect(blocks).toEqual([]);
  });
});
