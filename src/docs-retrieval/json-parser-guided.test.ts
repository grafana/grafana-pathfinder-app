import { parseJsonGuide } from './json-parser';
import type { GuidedAction } from '../types/interactive-actions.types';
import type { JsonGuide, JsonGuidedBlock } from '../types/json-guide.types';

function parseGuided(block: JsonGuidedBlock) {
  const guide: JsonGuide = { id: 'guided-contract', title: 'Guided contract', blocks: [block] };
  const result = parseJsonGuide(guide);
  expect(result.isValid).toBe(true);
  return result.data!.elements.find((element) => element.type === 'interactive-guided')!.props;
}

describe('guided JSON conversion', () => {
  it('preserves authored substep fields', () => {
    const props = parseGuided({
      type: 'guided',
      content: 'Configure the dashboard.',
      stepTimeout: 45_000,
      steps: [
        {
          action: 'highlight',
          reftarget: '#panel-toggle',
          targetstate: 'true',
          requirements: ['exists-reftarget', 'has-datasource:prometheus'],
          description: '**Open** the panel.',
          tooltip: 'Older instruction',
          skippable: true,
          lazyRender: true,
          scrollContainer: '#dashboard-scroll',
        },
        {
          action: 'formfill',
          reftarget: '#title',
          targetvalue: 'My dashboard',
          formHint: 'Enter the dashboard name.',
          validateInput: true,
          lazyRender: false,
          scrollContainer: '#form-scroll',
        },
        { action: 'noop', description: 'Review the dashboard.' },
      ],
    });
    const steps = props.internalActions as GuidedAction[];
    expect(props.stepTimeout).toBe(45_000);
    expect(steps[0]).toMatchObject({
      targetAction: 'highlight',
      refTarget: '#panel-toggle',
      targetState: 'true',
      requirements: ['exists-reftarget', 'has-datasource:prometheus'],
      isSkippable: true,
      lazyRender: true,
      scrollContainer: '#dashboard-scroll',
    });
    expect(steps[0]!.targetComment).toContain('<strong>Open</strong>');
    expect(steps[0]!.targetComment).not.toContain('Older instruction');
    expect(steps[1]).toMatchObject({
      targetAction: 'formfill',
      refTarget: '#title',
      targetValue: 'My dashboard',
      formHint: 'Enter the dashboard name.',
      validateInput: true,
      lazyRender: false,
      scrollContainer: '#form-scroll',
    });
    expect(steps[2]).toMatchObject({ targetAction: 'noop', isSkippable: false });
    expect(steps[2]!.lazyRender).toBeUndefined();
    expect(steps[2]!.scrollContainer).toBeUndefined();
  });

  it.each([30_000, 45_000, 60_000, undefined])('preserves the %s millisecond budget', (stepTimeout) => {
    const props = parseGuided({
      type: 'guided',
      content: 'Continue.',
      stepTimeout,
      steps: [{ action: 'noop', description: 'Read the instruction.' }],
    });
    expect(props.stepTimeout).toBe(stepTimeout ?? 120_000);
  });
});
